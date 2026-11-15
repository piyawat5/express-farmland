import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import { validate } from '../middleware/validate';
import * as systems from '../services/farm/system.service';
import * as contacts from '../services/farm/contact.service';
import * as lots from '../services/farm/lot.service';
import * as crabs from '../services/farm/crab.service';
import * as eggAi from '../services/farm/eggEstimate.service';
import * as history from '../services/farm/history.service';

// ════════════════════════════════════════════════════════════════════
//  ฟาร์ม (P2) — ระบบปู · คู่ค้า · ล็อต · ปู · การเช็คปู · AI % ไข่
//  ทั้งหมดอยู่ใต้ requireActiveSubscription · เห็นได้เฉพาะของตัวเอง (ไม่ใช่ของเรา = 404)
// ════════════════════════════════════════════════════════════════════

const id = () => idParam;
const optText = (max = 500) => z.string().trim().max(max).nullable().optional();

// ── ระบบปู ────────────────────────────────────────────────────────────
export const systemRouter = Router();

systemRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await systems.listSystems(req.user!));
  }),
);

systemRouter.post(
  '/',
  validate({
    body: z.object({
      name: z.string().trim().min(1, 'ตั้งชื่อระบบด้วย').max(60),
      layout: z.enum(['BASKET', 'CONDO_SINGLE', 'CONDO_DOUBLE']),
      rows: z.number().int().min(1).max(systems.MAX_ROWS),
      cols: z.number().int().min(1).max(systems.MAX_COLS),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await systems.createSystem(req.user!, req.body));
  }),
);

systemRouter.patch(
  '/:id',
  validate({
    params: id(),
    body: z.object({
      name: z.string().trim().min(1).max(60).optional(),
      rows: z.number().int().min(1).max(systems.MAX_ROWS).optional(),
      cols: z.number().int().min(1).max(systems.MAX_COLS).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await systems.updateSystem(req.user!, Number(req.params.id), req.body));
  }),
);

systemRouter.delete(
  '/:id',
  validate({ params: id() }),
  asyncHandler(async (req, res) => {
    await systems.deleteSystem(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);

/** ข้อมูลวาดหน้ากล่องปู */
systemRouter.get(
  '/:id/grid',
  validate({ params: id() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await systems.getSystemGrid(req.user!, Number(req.params.id))));
  }),
);

// ── คู่ค้า ────────────────────────────────────────────────────────────
export const contactRouter = Router();
const contactType = z.enum(['SELLER', 'CUSTOMER']);

contactRouter.get(
  '/',
  validate({ query: z.object({ type: contactType.optional() }) }),
  asyncHandler(async (req, res) => {
    res.json(await contacts.listContacts(req.user!, req.query.type as 'SELLER' | 'CUSTOMER' | undefined));
  }),
);

contactRouter.post(
  '/',
  validate({
    body: z.object({ type: contactType, name: z.string().trim().min(1, 'ใส่ชื่อด้วย').max(100), phone: optText(30), note: optText() }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await contacts.createContact(req.user!, req.body));
  }),
);

contactRouter.patch(
  '/:id',
  validate({ params: id(), body: z.object({ name: z.string().trim().min(1).max(100).optional(), phone: optText(30), note: optText() }) }),
  asyncHandler(async (req, res) => {
    res.json(await contacts.updateContact(req.user!, Number(req.params.id), req.body));
  }),
);

// ── ล็อต ──────────────────────────────────────────────────────────────
export const lotRouter = Router();
const money = z.number().min(0).max(100_000_000);

lotRouter.get(
  '/',
  validate({
    query: z.object({
      systemId: z.coerce.number().int().positive().optional(),
      costMissing: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { systemId?: number; costMissing?: boolean };
    res.json(serialize(await lots.listLots(req.user!, q)));
  }),
);

lotRouter.post(
  '/',
  validate({
    body: z.object({
      systemId: z.number().int().positive(),
      sellerId: z.number().int().positive().nullable().optional(),
      receivedAt: z.coerce.date().optional(),
      totalCost: money.nullable().optional(),
      note: optText(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await lots.createLot(req.user!, req.body)));
  }),
);

lotRouter.get(
  '/:id',
  validate({ params: id() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await lots.getLot(req.user!, Number(req.params.id))));
  }),
);

lotRouter.patch(
  '/:id',
  validate({
    params: id(),
    body: z.object({
      sellerId: z.number().int().positive().nullable().optional(),
      receivedAt: z.coerce.date().optional(),
      totalCost: money.nullable().optional(),
      note: optText(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await lots.updateLot(req.user!, Number(req.params.id), req.body)));
  }),
);

lotRouter.delete(
  '/:id',
  validate({ params: id() }),
  asyncHandler(async (req, res) => {
    await lots.deleteLot(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);

// ── ปู + การเช็ค ──────────────────────────────────────────────────────
export const crabRouter = Router();

const checkBody = z.object({
  checkedAt: z.coerce.date().optional(),
  weightG: z.number().positive().max(5000).nullable().optional(),
  pct: z.number().int().min(0).max(100).nullable().optional(),
  aiPct: z.number().int().min(0).max(100).nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  photoPublicId: z.string().max(300).nullable().optional(),
  note: optText(),
});
const crabType = z.enum(['EGG', 'MEAT', 'SOFT']);
const crabSex = z.enum(['MALE', 'FEMALE', 'INTERSEX']).nullable().optional();
const crabGrade = z.enum(['A', 'B']).nullable().optional();
const tieColor = z.string().trim().max(20).nullable().optional();

crabRouter.post(
  '/',
  validate({
    body: z
      .object({
        boxId: z.number().int().positive(),
        lotId: z.number().int().positive().optional(),
        newLot: z
          .object({
            sellerId: z.number().int().positive().nullable().optional(),
            receivedAt: z.coerce.date().optional(),
            totalCost: money.nullable().optional(),
          })
          .optional(),
        name: z.string().trim().max(60).nullable().optional(),
        type: crabType,
        sex: crabSex,
        grade: crabGrade,
        cableTieColor: tieColor,
        note: optText(),
        check: checkBody.optional(),
      })
      .refine((b) => b.lotId || b.newLot, { message: 'ต้องเลือกว่าปูตัวนี้มาจากล็อตไหน' }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await crabs.createCrab(req.user!, req.body)));
  }),
);

// ── ประวัติปู (P7) — ต้องอยู่ก่อน /:id ──
crabRouter.get(
  '/history',
  validate({
    query: z.object({
      systemId: z.coerce.number().int().positive().optional(),
      status: z.enum(['ALIVE', 'SOLD', 'DEAD', 'DELETED']).optional(),
      type: crabType.optional(),
      q: z.string().trim().max(60).optional(),
      skip: z.coerce.number().int().min(0).optional(),
      take: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await history.crabHistory(req.user!, req.query as unknown as history.HistoryQuery)));
  }),
);

crabRouter.get(
  '/compare',
  validate({ query: z.object({ systemId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await history.crabCompare(req.user!, Number((req.query as { systemId: unknown }).systemId))));
  }),
);

crabRouter.get(
  '/:id',
  validate({ params: id() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await crabs.getCrab(req.user!, Number(req.params.id))));
  }),
);

crabRouter.patch(
  '/:id',
  validate({
    params: id(),
    body: z.object({
      name: z.string().trim().min(1).max(60).optional(),
      type: crabType.optional(),
      sex: crabSex,
      grade: crabGrade,
      cableTieColor: tieColor,
      note: optText(),
      boxId: z.number().int().positive().optional(),
      lotId: z.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await crabs.updateCrab(req.user!, Number(req.params.id), req.body)));
  }),
);

/** ปูตาย (dead:true) / กดผิด เอากลับ (dead:false) */
crabRouter.post(
  '/:id/dead',
  validate({ params: id(), body: z.object({ dead: z.boolean(), diedAt: z.coerce.date().optional() }) }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await crabs.setCrabDead(req.user!, Number(req.params.id), req.body.dead, req.body.diedAt)));
  }),
);

/** ลบเพราะบันทึกผิด (ซ่อน ไม่ลบจริง) */
crabRouter.delete(
  '/:id',
  validate({ params: id() }),
  asyncHandler(async (req, res) => {
    await crabs.deleteCrab(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);

/** "เช็ควันนี้" = เพิ่มรอบใหม่ */
crabRouter.post(
  '/:id/checks',
  validate({ params: id(), body: checkBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await crabs.addCheck(req.user!, Number(req.params.id), req.body)));
  }),
);

export const crabCheckRouter = Router();

/** "แก้รอบนี้" */
crabCheckRouter.patch(
  '/:id',
  validate({ params: id(), body: checkBody }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await crabs.updateCheck(req.user!, Number(req.params.id), req.body)));
  }),
);

crabCheckRouter.delete(
  '/:id',
  validate({ params: id() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await crabs.deleteCheck(req.user!, Number(req.params.id))));
  }),
);

// ── AI ประเมิน % ไข่ ──────────────────────────────────────────────────
export const eggAiRouter = Router();

eggAiRouter.get('/', (_req, res) => {
  res.json(eggAi.eggAiStatus());
});

eggAiRouter.post(
  '/estimate',
  validate({ body: z.object({ imageUrl: z.string().url(), crabId: z.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => {
    res.json(await eggAi.estimateEggForUser(req.user!, req.body));
  }),
);
