import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import * as contactSvc from '../services/contact.service';
import * as txnSvc from '../services/transaction.service';
import * as outreachSvc from '../services/outreach.service';

// ════════════════════════════════════════════════════════════════════
//  โมดูล E — คู่ค้า & การซื้อขาย (Contact / Transaction / OutreachLog)
// ════════════════════════════════════════════════════════════════════

const contactType = z.enum(['BUYER', 'SELLER', 'BOTH']);
const txnKind = z.enum(['BUY', 'SELL']);
const txnStatus = z.enum(['QUOTE', 'CONFIRMED', 'DONE', 'CANCELLED']);
const outreachStatus = z.enum(['PENDING', 'CONTACTED', 'HAS_STOCK', 'NO_STOCK', 'DEALT']);

// boolean จาก query string — "true"/"false" เท่านั้น (z.coerce.boolean จะมอง "false" เป็น true)
const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

// ── Contact ───────────────────────────────────────────────────────────
export const contactRouter = Router();

const contactBody = z.object({
  name: z.string().min(1),
  type: contactType,
  phone: z.string().nullable().optional(),
  lineId: z.string().nullable().optional(),
  isRegular: z.boolean().optional(),
  note: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

const contactQuery = z.object({
  type: contactType.optional(),
  isRegular: boolQuery.optional(),
  active: boolQuery.optional(),
});

contactRouter.get(
  '/',
  validate({ query: contactQuery }),
  asyncHandler(async (req, res) => {
    const { type, isRegular, active } = req.query as z.infer<typeof contactQuery>;
    res.json(serialize(await contactSvc.listContacts(req.user!, { type, isRegular, active })));
  }),
);

contactRouter.post(
  '/',
  validate({ body: contactBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await contactSvc.createContact(req.user!, req.body)));
  }),
);

contactRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await contactSvc.getContact(Number(req.params.id), req.user!)));
  }),
);

contactRouter.patch(
  '/:id',
  validate({ params: idParam, body: contactBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await contactSvc.updateContact(Number(req.params.id), req.user!, req.body)));
  }),
);

contactRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await contactSvc.deleteContact(Number(req.params.id), req.user!);
    res.status(204).end();
  }),
);

// ── Transaction ───────────────────────────────────────────────────────
export const transactionRouter = Router();

const txnBody = z.object({
  contactId: z.number().int().positive(),
  kind: txnKind,
  status: txnStatus.optional(),
  crabId: z.number().int().positive().nullable().optional(),
  qty: z.number().int().positive().optional(),
  pricePerUnit: z.number().nonnegative(),
  costBasis: z.number().nonnegative().nullable().optional(),
  round: z.number().int().positive().nullable().optional(),
  occurredAt: z.coerce.date().nullable().optional(),
  note: z.string().nullable().optional(),
});

// preview ไม่ต้องมี contact จริง — แค่คำนวณกำไรล่วงหน้า (ข้อ 4.5)
const txnPreviewBody = z.object({
  kind: txnKind,
  qty: z.number().int().positive().default(1),
  pricePerUnit: z.number().nonnegative(),
  costBasis: z.number().nonnegative().nullable().optional(),
  crabId: z.number().int().positive().nullable().optional(),
});

const txnQuery = z.object({
  contactId: z.coerce.number().int().positive().optional(),
  kind: txnKind.optional(),
  status: txnStatus.optional(),
  crabId: z.coerce.number().int().positive().optional(),
});

transactionRouter.get(
  '/',
  validate({ query: txnQuery }),
  asyncHandler(async (req, res) => {
    const { contactId, kind, status, crabId } = req.query as z.infer<typeof txnQuery>;
    res.json(serialize(await txnSvc.listTransactions(req.user!, { contactId, kind, status, crabId })));
  }),
);

// คำนวณกำไรล่วงหน้าโดยไม่บันทึก
transactionRouter.post(
  '/preview',
  validate({ body: txnPreviewBody }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await txnSvc.previewFinancials(req.user!, req.body)));
  }),
);

transactionRouter.post(
  '/',
  validate({ body: txnBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await txnSvc.createTransaction(req.user!, req.body)));
  }),
);

transactionRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await txnSvc.getTransaction(Number(req.params.id), req.user!)));
  }),
);

transactionRouter.patch(
  '/:id',
  validate({ params: idParam, body: txnBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await txnSvc.updateTransaction(Number(req.params.id), req.user!, req.body)));
  }),
);

transactionRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await txnSvc.deleteTransaction(Number(req.params.id), req.user!);
    res.status(204).end();
  }),
);

// ── OutreachLog ───────────────────────────────────────────────────────
export const outreachRouter = Router();

const outreachQuery = z.object({
  round: z.coerce.number().int().positive().optional(),
  kind: txnKind.optional(),
  status: outreachStatus.optional(),
  contactId: z.coerce.number().int().positive().optional(),
});

const startRoundBody = z.object({
  round: z.number().int().positive(),
  kind: txnKind,
  contactIds: z.array(z.number().int().positive()).optional(),
});

const outreachBody = z.object({
  contactId: z.number().int().positive(),
  round: z.number().int().positive(),
  kind: txnKind,
  status: outreachStatus.optional(),
  contactedAt: z.coerce.date().nullable().optional(),
  note: z.string().nullable().optional(),
});

const outreachPatchBody = z.object({
  status: outreachStatus.optional(),
  contactedAt: z.coerce.date().nullable().optional(),
  note: z.string().nullable().optional(),
});

outreachRouter.get(
  '/',
  validate({ query: outreachQuery }),
  asyncHandler(async (req, res) => {
    const { round, kind, status, contactId } = req.query as z.infer<typeof outreachQuery>;
    res.json(serialize(await outreachSvc.listOutreach(req.user!, { round, kind, status, contactId })));
  }),
);

// เปิดรอบใหม่ → สร้าง log PENDING ให้คู่ค้าที่เกี่ยวข้องทุกเจ้า
outreachRouter.post(
  '/start-round',
  validate({ body: startRoundBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await outreachSvc.startRound(req.user!, req.body)));
  }),
);

outreachRouter.post(
  '/',
  validate({ body: outreachBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await outreachSvc.createOutreach(req.user!, req.body)));
  }),
);

outreachRouter.patch(
  '/:id',
  validate({ params: idParam, body: outreachPatchBody }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await outreachSvc.updateOutreach(Number(req.params.id), req.user!, req.body)));
  }),
);

outreachRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await outreachSvc.deleteOutreach(Number(req.params.id), req.user!);
    res.status(204).end();
  }),
);
