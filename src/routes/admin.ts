import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import { validate } from '../middleware/validate';
import * as subs from '../services/subscription.service';
import { getShopSettings, updateShopSettings } from '../services/settings.service';

// ════════════════════════════════════════════════════════════════════
//  /api/admin — หลังบ้าน (requireAdmin ครอบทั้ง router ที่ routes/index.ts)
//  P1: ภาพรวม · ผู้ใช้ & สิทธิ์ · สลิป · แพ็กเกจ · ตั้งค่าร้าน
//  P8 จะเพิ่ม: บัค · ไอเดีย · ประกาศ · คลิปสอน
// ════════════════════════════════════════════════════════════════════

const router = Router();

const paging = {
  skip: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
};

router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    res.json(await subs.adminOverview());
  }),
);

// ── ผู้ใช้ & สิทธิ์ ────────────────────────────────────────────────────

router.get(
  '/users',
  validate({
    query: z.object({
      q: z.string().trim().min(1).optional(),
      access: z.enum(['active', 'none', 'expired', 'pending']).optional(),
      ...paging,
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await subs.listUsers(req.query as subs.UserListFilter)));
  }),
);

router.get(
  '/users/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await subs.getUserDetail(Number(req.params.id))));
  }),
);

router.patch(
  '/users/:id',
  validate({
    params: idParam,
    body: z.object({
      active: z.boolean().optional(),
      role: z.enum(['ADMIN', 'USER']).optional(),
      name: z.string().max(100).nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await subs.updateUserByAdmin(req.user!.id, Number(req.params.id), req.body)));
  }),
);

/** ให้สิทธิ์เอง: เลือกแพ็กเกจ หรือกำหนดจำนวนวัน (ทดลองใช้) หรือให้ถาวร */
router.post(
  '/users/:id/subscriptions',
  validate({
    params: idParam,
    body: z
      .object({
        planId: z.number().int().positive().nullable().optional(),
        days: z.number().int().min(1).max(3650).nullable().optional(),
        lifetime: z.boolean().optional(),
        source: z.enum(['MANUAL', 'TRIAL']).default('MANUAL'),
        note: z.string().max(500).nullable().optional(),
      })
      .refine((b) => b.planId || b.days || b.lifetime, { message: 'ต้องเลือกแพ็กเกจ จำนวนวัน หรือให้ถาวร' }),
  }),
  asyncHandler(async (req, res) => {
    const sub = await subs.grantSubscription(Number(req.params.id), { ...req.body, grantedById: req.user!.id });
    res.status(201).json(serialize(sub));
  }),
);

router.post(
  '/subscriptions/:id/revoke',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await subs.revokeSubscription(Number(req.params.id))));
  }),
);

// ── สลิป ──────────────────────────────────────────────────────────────

router.get(
  '/slips',
  validate({ query: z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), ...paging }) }),
  asyncHandler(async (req, res) => {
    const [items, total] = await subs.listSlips(req.query as Parameters<typeof subs.listSlips>[0]);
    res.json(serialize({ items, total }));
  }),
);

router.post(
  '/slips/:id/approve',
  validate({ params: idParam, body: z.object({ note: z.string().max(500).nullable().optional() }) }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await subs.approveSlip(Number(req.params.id), req.user!.id, req.body.note)));
  }),
);

router.post(
  '/slips/:id/reject',
  validate({ params: idParam, body: z.object({ reason: z.string().trim().min(1, 'ใส่เหตุผลให้ลูกค้าด้วย').max(500) }) }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await subs.rejectSlip(Number(req.params.id), req.user!.id, req.body.reason)));
  }),
);

// ── แพ็กเกจ ───────────────────────────────────────────────────────────

const planBody = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).nullable().optional(),
  priceTHB: z.number().min(0),
  durationDays: z.number().int().min(1).nullable().optional(), // null = ซื้อขาด
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

router.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    res.json(serialize(await subs.listAllPlans()));
  }),
);

router.post(
  '/plans',
  validate({ body: planBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await subs.createPlan(req.body)));
  }),
);

router.patch(
  '/plans/:id',
  validate({ params: idParam, body: planBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await subs.updatePlan(Number(req.params.id), req.body)));
  }),
);

router.delete(
  '/plans/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await subs.deletePlan(Number(req.params.id));
    res.status(204).end();
  }),
);

// ── ตั้งค่าร้าน ───────────────────────────────────────────────────────

const optText = z.string().trim().max(200).nullable().optional();
// ลิงก์: เว้นว่าง = ลบลิงก์
const optUrl = z.union([z.string().url('ลิงก์ไม่ถูกต้อง'), z.literal('').transform(() => null), z.null()]).optional();

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json(await getShopSettings());
  }),
);

router.put(
  '/settings',
  validate({
    body: z.object({
      shopName: z.string().trim().min(1).max(100).optional(),
      promptPayId: z
        .string()
        .trim()
        .regex(/^(\d{10}|\d{13})$/, 'พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตร 13 หลัก')
        .nullable()
        .optional(),
      promptPayName: optText,
      phone: optText,
      facebookName: optText,
      facebookUrl: optUrl,
      lineOaUrl: optUrl,
      graceDays: z.number().int().min(0).max(30).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await updateShopSettings(req.body));
  }),
);

export default router;
