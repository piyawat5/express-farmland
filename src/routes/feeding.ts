import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import { requireSystemEdit, systemIdFromParam, systemIdFromFeedingRound } from '../middleware/auth';
import * as svc from '../services/feeding.service';
import { feedingAnalysis } from '../services/feedingAnalysis.service';
import { EAT_RESULTS, FOOD_TYPES } from '../lib/feedingCycle';

// ════════════════════════════════════════════════════════════════════
//  โมดูล B2 — แผนให้อาหาร + รอบให้อาหาร (Phase 21)
//  GET = แค่ต้อง login (service เช็คเจ้าของแล้ว throw 404) · เขียน = requireSystemEdit (403)
// ════════════════════════════════════════════════════════════════════

const timeOfDay = z.string().regex(/^\d{1,2}:\d{2}$/, 'รูปแบบเวลาต้องเป็น HH:mm');

const feedingPlanBody = z.object({
  onDays: z.number().int().min(1).max(30), // ให้อาหารติดกันกี่วัน
  offDays: z.number().int().min(0).max(30), // แล้วเว้นกี่วัน (0 = ทุกวัน)
  anchorDate: z.coerce.date(),
  timeOfDay,
  recordLeadHours: z.number().int().min(0).max(24).optional(),
  active: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
});

// ส่ง tags (ทางเดิมจาก popup ปู) หรือ result (ติ๊กทีเดียว — แปลงเป็นป้ายจากอาหารของรอบ) อย่างใดอย่างหนึ่ง
const entryItem = z
  .object({
    crabId: z.number().int().positive(),
    tags: z.array(z.string().min(1).max(60)).max(10).optional(),
    result: z.enum(EAT_RESULTS).optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((v) => v.tags != null || v.result != null, 'ต้องส่ง tags หรือ result');

const bulkEntryBody = z.object({ entries: z.array(entryItem).min(1).max(50) });

const foodBody = z
  .object({
    foodType: z.enum(FOOD_TYPES).nullable().optional(),
    foodGrams: z.number().int().min(0).max(1_000_000).nullable().optional(),
  })
  .refine((v) => v.foodType !== undefined || v.foodGrams !== undefined, 'ต้องส่ง foodType หรือ foodGrams');

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD');
const analysisQuery = z.object({ from: ymd.optional(), to: ymd.optional() });

const energyQuery = z.object({
  rounds: z.coerce.number().int().min(1).max(20).default(5),
});

const roundsQuery = z.object({
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

const crabIdParam = z.object({
  id: z.coerce.number().int().positive(),
  crabId: z.coerce.number().int().positive(),
});

// ── nested ใต้ /systems/:id ───────────────────────────────────────────
export const feedingSystemRouter = Router();

feedingSystemRouter.get(
  '/:id/feeding-plan',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getPlan(Number(req.params.id), req.user!)));
  }),
);

feedingSystemRouter.put(
  '/:id/feeding-plan',
  validate({ params: idParam, body: feedingPlanBody }),
  requireSystemEdit(systemIdFromParam()),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.upsertPlan(Number(req.params.id), req.user!, req.body)));
  }),
);

feedingSystemRouter.delete(
  '/:id/feeding-plan',
  validate({ params: idParam }),
  requireSystemEdit(systemIdFromParam()),
  asyncHandler(async (req, res) => {
    await svc.deletePlan(Number(req.params.id), req.user!);
    res.status(204).send();
  }),
);

/** รอบที่เปิดอยู่ + แผน — เปิดรอบให้แบบ lazy ถ้าถึงเวลาแล้วแต่ cron ยังไม่ยิง */
feedingSystemRouter.get(
  '/:id/feeding-round/current',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getCurrentRound(Number(req.params.id), req.user!)));
  }),
);

/** เปิดรอบเอง (นอกแผน เช่นให้อาหารนอกรอบ) */
feedingSystemRouter.post(
  '/:id/feeding-round/open',
  validate({ params: idParam, body: z.object({ at: z.coerce.date().optional() }).optional() }),
  requireSystemEdit(systemIdFromParam()),
  asyncHandler(async (req, res) => {
    const at = (req.body as { at?: Date } | undefined)?.at;
    res.status(201).json(serialize(await svc.openRoundManually(Number(req.params.id), req.user!, at)));
  }),
);

feedingSystemRouter.get(
  '/:id/feeding-rounds',
  validate({ params: idParam, query: roundsQuery }),
  asyncHandler(async (req, res) => {
    const { take, skip } = req.query as unknown as z.infer<typeof roundsQuery>;
    res.json(serialize(await svc.listRounds(Number(req.params.id), req.user!, take, skip)));
  }),
);

/** หลอดพลัง — คะแนนการกินเฉลี่ยต่อปูจาก N รอบล่าสุด */
feedingSystemRouter.get(
  '/:id/feeding-energy',
  validate({ params: idParam, query: energyQuery }),
  asyncHandler(async (req, res) => {
    const { rounds } = req.query as unknown as z.infer<typeof energyQuery>;
    res.json(serialize(await svc.crabEnergy(Number(req.params.id), req.user!, rounds)));
  }),
);

/** วิเคราะห์อาหาร — ให้ปลา/หอยไปเท่าไร + %ไข่ที่เพิ่มต่อสัปดาห์เมื่อกินปลา vs หอย */
feedingSystemRouter.get(
  '/:id/feeding-analysis',
  validate({ params: idParam, query: analysisQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof analysisQuery>;
    res.json(serialize(await feedingAnalysis(Number(req.params.id), req.user!, q)));
  }),
);

// ── /feeding-rounds/:id ───────────────────────────────────────────────
export const feedingRoundRouter = Router();

feedingRoundRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getRound(Number(req.params.id), req.user!)));
  }),
);

/** บันทึกการกินของปู 1 ตัว — คืน snapshot รอบเต็ม + celebrated (ตัวสุดท้ายหรือยัง) */
feedingRoundRouter.post(
  '/:id/entries',
  validate({ params: idParam, body: entryItem }),
  requireSystemEdit(systemIdFromFeedingRound),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.recordEntry(Number(req.params.id), req.user!, req.body)));
  }),
);

/** บันทึกหลายตัวทีเดียว (กินหมดทั้งกล่อง) — 1 ทรานแซกชัน, ส่ง WS ครั้งเดียว */
feedingRoundRouter.post(
  '/:id/entries/bulk',
  validate({ params: idParam, body: bulkEntryBody }),
  requireSystemEdit(systemIdFromFeedingRound),
  asyncHandler(async (req, res) => {
    const { entries } = req.body as z.infer<typeof bulkEntryBody>;
    res.json(serialize(await svc.recordEntries(Number(req.params.id), req.user!, entries)));
  }),
);

/** ตั้งอาหารของรอบ (ปลา/หอย/ผสม) + กรัม — รอบเก่าก็แก้ได้ (กรอกย้อนหลังจากหน้าวิเคราะห์) */
feedingRoundRouter.patch(
  '/:id/food',
  validate({ params: idParam, body: foodBody }),
  requireSystemEdit(systemIdFromFeedingRound),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.setRoundFood(Number(req.params.id), req.user!, req.body)));
  }),
);

feedingRoundRouter.delete(
  '/:id/entries/:crabId',
  validate({ params: crabIdParam }),
  requireSystemEdit(systemIdFromFeedingRound),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.deleteEntry(Number(req.params.id), Number(req.params.crabId), req.user!)));
  }),
);

feedingRoundRouter.post(
  '/:id/close',
  validate({ params: idParam }),
  requireSystemEdit(systemIdFromFeedingRound),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.closeRound(Number(req.params.id), req.user!)));
  }),
);

feedingRoundRouter.post(
  '/:id/skip',
  validate({ params: idParam }),
  requireSystemEdit(systemIdFromFeedingRound),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.skipRound(Number(req.params.id), req.user!)));
  }),
);
