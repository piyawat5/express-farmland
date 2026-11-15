import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { idParam } from '../lib/validation';
import { validate } from '../middleware/validate';
import * as water from '../services/water/water.service';

// ════════════════════════════════════════════════════════════════════
//  น้ำ (P5) — /water
//  ค่าที่วัด + เกณฑ์ (ต่อระบบ) · กฎปรุงน้ำ (ต่อค่า: ต่ำ/สูง) · สาร (ต่อเจ้าของ) · ผลวัด · "ทำแล้ว"
//  ของคนอื่น = 404 · บันทึกผลวัด = งาน "วัดค่าน้ำ" ปิดเอง
// ════════════════════════════════════════════════════════════════════

const sysQuery = z.object({ systemId: z.coerce.number().int().positive() });
const sid = (q: unknown) => Number((q as { systemId: string }).systemId);
const value = z.number().min(-100000).max(1_000_000);
const target = value.nullable();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'สีต้องเป็น #rrggbb');
const unit = z.string().trim().max(16);
const when = z.enum(['LOW', 'HIGH']);
const paramWhen = z.object({ id: z.coerce.number().int().positive(), when });

export const waterRouter = Router();

// ── หน้าน้ำ ──
waterRouter.get(
  '/',
  validate({ query: sysQuery }),
  asyncHandler(async (req, res) => {
    res.json(await water.getState(req.user!, sid(req.query)));
  }),
);

waterRouter.get(
  '/summary',
  validate({ query: sysQuery }),
  asyncHandler(async (req, res) => {
    res.json(await water.getSummary(req.user!, sid(req.query)));
  }),
);

// ── ผลวัด ──
waterRouter.get(
  '/tests',
  validate({ query: sysQuery.extend({ take: z.coerce.number().int().min(1).max(60).optional(), before: z.coerce.date().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { take?: number; before?: Date };
    res.json(await water.listTests(req.user!, sid(req.query), q.take ? Number(q.take) : 20, q.before ? new Date(q.before) : undefined));
  }),
);

waterRouter.post(
  '/tests',
  validate({
    body: z.object({
      systemId: z.number().int().positive(),
      testedAt: z.coerce.date().optional(),
      note: z.string().max(500).nullable().optional(),
      values: z.array(z.object({ paramId: z.number().int().positive(), value })).min(1, 'ใส่ค่าที่วัดได้อย่างน้อย 1 ค่า').max(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await water.recordTest(req.user!, req.body));
  }),
);

waterRouter.patch(
  '/tests/:id',
  validate({
    params: idParam,
    body: z.object({
      testedAt: z.coerce.date().optional(),
      note: z.string().max(500).nullable().optional(),
      values: z.array(z.object({ paramId: z.number().int().positive(), value: value.nullable() })).max(50).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    await water.updateTest(req.user!, Number(req.params.id), req.body);
    res.status(204).end();
  }),
);

waterRouter.delete(
  '/tests/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await water.deleteTest(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);

// ── ค่าที่วัด + เกณฑ์ ──
waterRouter.post(
  '/params',
  validate({
    body: z.object({
      systemId: z.number().int().positive(),
      name: z.string().trim().min(1, 'ตั้งชื่อค่าที่วัด').max(40),
      unit: unit.optional(),
      color,
      min: target.optional(),
      max: target.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ id: await water.addParam(req.user!, req.body) });
  }),
);

waterRouter.put(
  '/params/targets',
  validate({
    body: z.object({
      systemId: z.number().int().positive(),
      items: z.array(z.object({ id: z.number().int().positive(), min: target, max: target, unit: unit.optional(), active: z.boolean() })).min(1).max(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await water.saveTargets(req.user!, req.body));
  }),
);

waterRouter.patch(
  '/params/:id',
  validate({
    params: idParam,
    body: z.object({
      name: z.string().trim().min(1).max(40).optional(),
      unit: unit.optional(),
      color: color.optional(),
      min: target.optional(),
      max: target.optional(),
      active: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    await water.updateParam(req.user!, Number(req.params.id), req.body);
    res.status(204).end();
  }),
);

// ── กฎปรุงน้ำ ("ถ้า [Mg] ต่ำกว่า [1250] → ใส่ [แมกนีเซียม] [1] [ช้อน] ค่าจะขึ้น [20]") ──
waterRouter.put(
  '/params/:id/rules/:when',
  validate({
    params: paramWhen,
    body: z.object({
      action: z.enum(['DOSE', 'WARN', 'RETEST']),
      substanceId: z.number().int().positive().nullable().optional(),
      substanceName: z.string().trim().max(40).nullable().optional(),
      amount: z.number().positive().max(100000).nullable().optional(),
      doseUnit: unit.nullable().optional(),
      effect: z.number().min(0).max(1_000_000).nullable().optional(),
      note: z.string().max(200).nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    await water.saveRule(req.user!, Number(req.params.id), req.params.when as 'LOW' | 'HIGH', req.body);
    res.status(204).end();
  }),
);

waterRouter.delete(
  '/params/:id/rules/:when',
  validate({ params: paramWhen }),
  asyncHandler(async (req, res) => {
    await water.deleteRule(req.user!, Number(req.params.id), req.params.when as 'LOW' | 'HIGH');
    res.status(204).end();
  }),
);

// ── สาร ──
waterRouter.post(
  '/substances',
  validate({ body: z.object({ name: z.string().trim().min(1, 'ตั้งชื่อสาร').max(40) }) }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ id: await water.addSubstance(req.user!, req.body.name) });
  }),
);

waterRouter.patch(
  '/substances/:id',
  validate({ params: idParam, body: z.object({ name: z.string().trim().min(1).max(40).optional(), active: z.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    await water.updateSubstance(req.user!, Number(req.params.id), req.body);
    res.status(204).end();
  }),
);

// ── "ทำแล้ว ✓" ──
waterRouter.post(
  '/actions',
  validate({ body: z.object({ testId: z.number().int().positive(), paramId: z.number().int().positive(), amount: z.number().positive().max(100000).nullable().optional() }) }),
  asyncHandler(async (req, res) => {
    await water.act(req.user!, req.body);
    res.status(204).end();
  }),
);

waterRouter.delete(
  '/actions/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await water.undoAct(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);
