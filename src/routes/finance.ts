import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import * as ledgerSvc from '../services/ledger.service';
import * as dashboardSvc from '../services/dashboard.service';

// ════════════════════════════════════════════════════════════════════
//  โมดูล F — การเงิน: LedgerEntry (สมุดบัญชี) + Dashboard/analytics
// ════════════════════════════════════════════════════════════════════

const ledgerKind = z.enum(['INCOME', 'EXPENSE']);
const ledgerCategory = z.enum(ledgerSvc.LEDGER_CATEGORIES);

// ── LedgerEntry CRUD ───────────────────────────────────────────────────
export const ledgerRouter = Router();

const ledgerBody = z.object({
  systemId: z.number().int().positive().nullable().optional(),
  kind: ledgerKind,
  category: ledgerCategory,
  amount: z.number().nonnegative(),
  occurredAt: z.coerce.date(),
  note: z.string().nullable().optional(),
});

const ledgerQuery = z.object({
  systemId: z.coerce.number().int().positive().optional(),
  kind: ledgerKind.optional(),
  category: ledgerCategory.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

ledgerRouter.get(
  '/',
  validate({ query: ledgerQuery }),
  asyncHandler(async (req, res) => {
    const { systemId, kind, category, from, to } = req.query as z.infer<typeof ledgerQuery>;
    res.json(serialize(await ledgerSvc.listLedger({ systemId, kind, category, from, to })));
  }),
);

ledgerRouter.post(
  '/',
  validate({ body: ledgerBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await ledgerSvc.createLedger(req.body)));
  }),
);

ledgerRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await ledgerSvc.getLedger(Number(req.params.id))));
  }),
);

ledgerRouter.patch(
  '/:id',
  validate({ params: idParam, body: ledgerBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await ledgerSvc.updateLedger(Number(req.params.id), req.body)));
  }),
);

ledgerRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await ledgerSvc.deleteLedger(Number(req.params.id));
    res.status(204).end();
  }),
);

// ── Dashboard / analytics (read-only) ──────────────────────────────────
export const dashboardRouter = Router();

const financeQuery = z.object({
  systemId: z.coerce.number().int().positive().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const systemQuery = z.object({
  systemId: z.coerce.number().int().positive().optional(),
});

dashboardRouter.get(
  '/overview',
  validate({ query: systemQuery }),
  asyncHandler(async (req, res) => {
    const { systemId } = req.query as z.infer<typeof systemQuery>;
    res.json(serialize(await dashboardSvc.overview({ systemId })));
  }),
);

dashboardRouter.get(
  '/finance',
  validate({ query: financeQuery }),
  asyncHandler(async (req, res) => {
    const { systemId, from, to } = req.query as z.infer<typeof financeQuery>;
    res.json(serialize(await dashboardSvc.financeSummary({ systemId, from, to })));
  }),
);

dashboardRouter.get(
  '/crabs',
  validate({ query: systemQuery }),
  asyncHandler(async (req, res) => {
    const { systemId } = req.query as z.infer<typeof systemQuery>;
    res.json(serialize(await dashboardSvc.crabAnalytics({ systemId })));
  }),
);
