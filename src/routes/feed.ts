import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { idParam } from '../lib/validation';
import { validate } from '../middleware/validate';
import * as stock from '../services/feed/stock.service';
import * as plans from '../services/feed/plan.service';
import * as rounds from '../services/feed/round.service';
import { syncOwner } from '../services/reminders/task.service';

// ════════════════════════════════════════════════════════════════════
//  อาหารปู (P4) — /feed
//  สต็อก (ต่อเจ้าของ) · แผน (ต่อระบบ) · รอบให้อาหาร + ผลการกินรายตัว
//  ของคนอื่น = 404 · ทุกคำขอที่แก้ข้อมูลเรียก markDirty ของแจ้งเตือนเองจาก middleware ใน routes/index.ts
// ════════════════════════════════════════════════════════════════════

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องเป็น YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'เวลาต้องเป็น HH:mm');
const sysQuery = z.object({ systemId: z.coerce.number().int().positive() });
const sid = (q: unknown) => Number((q as { systemId: string }).systemId);

export const feedRouter = Router();

// ── สต็อก ──
feedRouter.get(
  '/items',
  asyncHandler(async (req, res) => {
    res.json(await stock.listItems(req.user!));
  }),
);

feedRouter.post(
  '/items',
  validate({ body: z.object({ name: z.string().trim().min(1, 'ตั้งชื่ออาหาร').max(40), emoji: z.string().max(16).nullable().optional(), unit: z.string().trim().max(16).optional() }) }),
  asyncHandler(async (req, res) => {
    const id = await stock.createItem(req.user!, req.body);
    res.status(201).json({ id });
  }),
);

feedRouter.patch(
  '/items/:id',
  validate({
    params: idParam,
    body: z.object({
      name: z.string().trim().min(1).max(40).optional(),
      emoji: z.string().max(16).nullable().optional(),
      unit: z.string().trim().max(16).optional(),
      active: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    await stock.updateItem(req.user!, Number(req.params.id), req.body);
    res.status(204).end();
  }),
);

feedRouter.post(
  '/items/:id/buy',
  validate({
    params: idParam,
    body: z.object({ qty: z.number().positive().max(100000), priceTHB: z.number().min(0).max(10_000_000).nullable().optional(), note: z.string().max(200).nullable().optional() }),
  }),
  asyncHandler(async (req, res) => {
    await stock.buy(req.user!, Number(req.params.id), req.body);
    res.status(204).end();
  }),
);

feedRouter.post(
  '/items/:id/count',
  validate({ params: idParam, body: z.object({ qty: z.number().min(0).max(100000) }) }),
  asyncHandler(async (req, res) => {
    await stock.recount(req.user!, Number(req.params.id), req.body.qty);
    res.status(204).end();
  }),
);

feedRouter.get(
  '/items/:id/moves',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(await stock.listMoves(req.user!, Number(req.params.id)));
  }),
);

// ── แผน ──
feedRouter.get(
  '/plan',
  validate({ query: sysQuery }),
  asyncHandler(async (req, res) => {
    res.json(await plans.getPlan(req.user!, sid(req.query)));
  }),
);

feedRouter.put(
  '/plan',
  validate({
    body: z.object({
      systemId: z.number().int().positive(),
      active: z.boolean().optional(),
      onDays: z.number().int().min(1).max(14),
      offDays: z.number().int().min(0).max(14),
      anchorDate: ymd.optional(),
      timeOfDay: hhmm,
      pattern: z.enum(['SINGLE', 'ALTERNATE']),
      itemId: z.number().int().positive(),
      altItemId: z.number().int().positive().nullable().optional(),
      piecesPerCrab: z.number().positive().max(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await plans.savePlan(req.user!, req.body));
  }),
);

feedRouter.put(
  '/plan/day',
  validate({ body: z.object({ systemId: z.number().int().positive(), date: ymd, skip: z.boolean(), itemId: z.number().int().positive().nullable() }) }),
  asyncHandler(async (req, res) => {
    res.json(await plans.setPlanDay(req.user!, req.body));
  }),
);

// ── รอบให้อาหาร ──
feedRouter.get(
  '/current',
  validate({ query: sysQuery }),
  asyncHandler(async (req, res) => {
    await syncOwner(req.user!.id); // เปิดรอบที่ถึงเวลา / ปิดรอบที่ลืมปิด
    res.json(await rounds.getCurrent(req.user!, sid(req.query)));
  }),
);

feedRouter.get(
  '/rounds',
  validate({ query: sysQuery.extend({ take: z.coerce.number().int().min(1).max(60).optional() }) }),
  asyncHandler(async (req, res) => {
    res.json(await rounds.listRounds(req.user!, sid(req.query), req.query.take ? Number(req.query.take) : 10));
  }),
);

feedRouter.get(
  '/rounds/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(await rounds.getRound(req.user!, Number(req.params.id)));
  }),
);

feedRouter.post(
  '/rounds/start',
  validate({ body: z.object({ systemId: z.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ id: await rounds.startRound(req.user!, req.body.systemId) });
  }),
);

feedRouter.post(
  '/rounds/:id/fed',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await rounds.markFed(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);

feedRouter.post(
  '/rounds/:id/close',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await rounds.closeRound(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);

feedRouter.post(
  '/rounds/:id/review',
  validate({ params: idParam, body: z.object({ action: z.enum(['ok', 'not_fed']) }) }),
  asyncHandler(async (req, res) => {
    await rounds.reviewRound(req.user!, Number(req.params.id), req.body.action);
    res.status(204).end();
  }),
);

feedRouter.patch(
  '/rounds/:id/entries',
  validate({
    params: idParam,
    body: z
      .object({
        crabIds: z.array(z.number().int().positive()).max(2000).optional(),
        fromItemId: z.number().int().positive().optional(),
        result: z.enum(['ATE', 'LITTLE', 'NONE']).optional(),
        itemId: z.number().int().positive().nullable().optional(),
        pieces: z.number().min(0).max(20).optional(),
      })
      .refine((b) => !!b.crabIds?.length !== !!b.fromItemId, 'ระบุ crabIds หรือ fromItemId อย่างใดอย่างหนึ่ง'),
  }),
  asyncHandler(async (req, res) => {
    await rounds.updateEntries(req.user!, Number(req.params.id), req.body);
    res.status(204).end();
  }),
);
