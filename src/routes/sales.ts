import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import { validate } from '../middleware/validate';
import * as sales from '../services/sales/sale.service';
import * as ledger from '../services/sales/ledger.service';

// ════════════════════════════════════════════════════════════════════
//  ขาย & บัญชี (P6) — อยู่ใต้ requireActiveSubscription · เห็นเฉพาะของตัวเอง
// ════════════════════════════════════════════════════════════════════

const money = z.number().min(0).max(100_000_000);
const optText = (max = 500) => z.string().trim().max(max).nullable().optional();
/** "YYYY-MM-DD" (วันไทย) → เวลาเริ่มวันนั้น */
const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD')
  .transform((s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  });
const nextDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

// ── ใบขาย ─────────────────────────────────────────────────────────────
export const saleRouter = Router();

const itemsBody = z
  .array(
    z.object({
      crabId: z.number().int().positive(),
      price: money,
      pricePerKg: money.nullable().optional(),
    }),
  )
  .min(1, 'เลือกปูอย่างน้อย 1 ตัว')
  .max(500);

/** ใบจองทั้งหมด + ใบที่ขาย/ยกเลิกในช่วง from..to (รวมวัน to) */
saleRouter.get(
  '/',
  validate({ query: z.object({ from: ymd.optional(), to: ymd.optional(), status: z.enum(['RESERVED', 'DONE', 'CANCELLED']).optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { from?: Date; to?: Date; status?: 'RESERVED' | 'DONE' | 'CANCELLED' };
    res.json(await sales.listSales(req.user!, { from: q.from, to: q.to ? nextDay(q.to) : undefined, status: q.status }));
  }),
);

saleRouter.post(
  '/',
  validate({
    body: z.object({
      systemId: z.number().int().positive(),
      status: z.enum(['RESERVED', 'DONE']),
      customerId: z.number().int().positive().nullable().optional(),
      soldAt: z.coerce.date().optional(),
      note: optText(),
      items: itemsBody,
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await sales.createSale(req.user!, req.body)));
  }),
);

saleRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await sales.getSale(req.user!, Number(req.params.id))));
  }),
);

saleRouter.patch(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      customerId: z.number().int().positive().nullable().optional(),
      soldAt: z.coerce.date().optional(),
      note: optText(),
      items: itemsBody.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await sales.updateSale(req.user!, Number(req.params.id), req.body)));
  }),
);

/** ใบจอง → ขายแล้ว */
saleRouter.post(
  '/:id/done',
  validate({ params: idParam, body: z.object({ soldAt: z.coerce.date().optional() }) }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await sales.markDone(req.user!, Number(req.params.id), req.body.soldAt)));
  }),
);

/** ยกเลิกใบ (จอง/ขายแล้ว) → ปูกลับเข้าผัง */
saleRouter.post(
  '/:id/cancel',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await sales.cancelSale(req.user!, Number(req.params.id))));
  }),
);

// ── บัญชี ─────────────────────────────────────────────────────────────
export const ledgerRouter = Router();

const category = z.enum(['FEED', 'SUBSTANCE', 'ELECTRIC', 'WATER', 'EQUIPMENT', 'LABOR', 'OTHER', 'INCOME']);
const amount = z.number().positive('ใส่จำนวนเงิน').max(100_000_000);

/** รายการบัญชีช่วง from..to (รวมวัน to) — ซื้อปู/ซื้ออาหาร/ขายปู ระบบลงให้ + ที่ลงเอง */
ledgerRouter.get(
  '/',
  validate({ query: z.object({ from: ymd, to: ymd }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { from: Date; to: Date };
    res.json(await ledger.listLedger(req.user!, q.from, nextDay(q.to)));
  }),
);

ledgerRouter.post(
  '/',
  validate({ body: z.object({ category, amount, at: z.coerce.date(), note: optText(200) }) }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await ledger.createEntry(req.user!, req.body));
  }),
);

/** กำไรรายล็อต */
ledgerRouter.get(
  '/lots',
  asyncHandler(async (req, res) => {
    res.json(await ledger.lotProfits(req.user!));
  }),
);

/** ตัวช่วยค่าไฟ (null = ยังไม่เคยตั้ง) */
ledgerRouter.get(
  '/electric',
  asyncHandler(async (req, res) => {
    res.json(await ledger.getElectric(req.user!));
  }),
);

ledgerRouter.put(
  '/electric',
  validate({
    body: z.object({
      devices: z
        .array(
          z.object({
            key: z.string().trim().min(1).max(24),
            name: z.string().trim().min(1, 'ตั้งชื่ออุปกรณ์').max(40),
            watts: z.number().min(0).max(20_000),
            qty: z.number().int().min(1).max(500),
            hours: z.number().min(0).max(24),
          }),
        )
        .max(30),
      rate: z.number().min(0).max(50),
      active: z.boolean(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await ledger.saveElectric(req.user!, req.body));
  }),
);

ledgerRouter.patch(
  '/:id',
  validate({ params: idParam, body: z.object({ category: category.optional(), amount: amount.optional(), at: z.coerce.date().optional(), note: optText(200) }) }),
  asyncHandler(async (req, res) => {
    await ledger.updateEntry(req.user!, Number(req.params.id), req.body);
    res.status(204).end();
  }),
);

ledgerRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await ledger.deleteEntry(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);
