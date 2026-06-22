import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import {
  requireSystemEdit,
  systemIdFromParam,
  systemIdFromDosingCalibration,
  requireDosingRuleEdit,
} from '../middleware/auth';
import * as svc from '../services/dosing.service';

// ════════════════════════════════════════════════════════════════════
//  โมดูล C — Substance / DosingCalibration / DosingRule
// ════════════════════════════════════════════════════════════════════

const waterParam = z.enum([
  'PH',
  'ALKALINITY',
  'MAGNESIUM',
  'CALCIUM',
  'SALINITY',
  'AMMONIA',
  'NITRITE',
]);

const substanceBody = z.object({
  name: z.string().min(1),
  category: z.enum(['MINERAL', 'MICROORGANISM', 'OTHER']),
  unit: z.string().min(1),
  needsPrep: z.boolean().optional(),
  prepLeadDays: z.number().int().positive().nullable().optional(),
  needsRepurchase: z.boolean().optional(),
  note: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

const calibrationBody = z.object({
  substanceId: z.number().int().positive(),
  parameter: waterParam,
  effectPerUnit: z.number().positive(),
  unit: z.string().min(1),
  note: z.string().nullable().optional(),
});

const ruleBody = z.object({
  systemId: z.number().int().positive().nullable().optional(),
  parameter: waterParam,
  condition: z.enum(['BELOW_MIN', 'ABOVE_MAX']),
  actionType: z.enum(['DOSE', 'MEASURE_NEXT', 'NOTE']),
  substanceId: z.number().int().positive().nullable().optional(),
  fixedDose: z.number().positive().nullable().optional(),
  message: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

// ── /substances (master list) ─────────────────────────────────────────
export const substanceRouter = Router();

const listSubstanceQuery = z.object({ all: z.coerce.boolean().optional() });

substanceRouter.get(
  '/',
  validate({ query: listSubstanceQuery }),
  asyncHandler(async (req, res) => {
    const { all } = req.query as z.infer<typeof listSubstanceQuery>;
    res.json(serialize(await svc.listSubstances(req.user!, all === true)));
  }),
);

substanceRouter.post(
  '/',
  validate({ body: substanceBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await svc.createSubstance(req.user!, req.body)));
  }),
);

substanceRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getSubstance(Number(req.params.id), req.user!)));
  }),
);

substanceRouter.patch(
  '/:id',
  validate({ params: idParam, body: substanceBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateSubstance(Number(req.params.id), req.user!, req.body)));
  }),
);

substanceRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await svc.deleteSubstance(Number(req.params.id), req.user!);
    res.status(204).end();
  }),
);

// ── nested ใต้ /systems/:id — calibration + rules ─────────────────────
export const dosingSystemRouter = Router();

dosingSystemRouter.get(
  '/:id/dosing-calibrations',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.listCalibrations(Number(req.params.id), req.user!)));
  }),
);

// upsert calibration (unique ที่ systemId+substanceId+parameter)
dosingSystemRouter.put(
  '/:id/dosing-calibrations',
  validate({ params: idParam, body: calibrationBody }),
  requireSystemEdit(systemIdFromParam()),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.upsertCalibration(Number(req.params.id), req.body)));
  }),
);

dosingSystemRouter.get(
  '/:id/dosing-rules',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.listRules(req.user!, Number(req.params.id))));
  }),
);

dosingSystemRouter.post(
  '/:id/dosing-rules',
  validate({ params: idParam, body: ruleBody.omit({ systemId: true }) }),
  requireSystemEdit(systemIdFromParam()),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      serialize(await svc.createRule(req.user!, { ...req.body, systemId: Number(req.params.id) })),
    );
  }),
);

// ── /dosing-calibrations/:id (ลบรายตัว) ──────────────────────────────
export const calibrationRouter = Router();

calibrationRouter.delete(
  '/:id',
  validate({ params: idParam }),
  requireSystemEdit(systemIdFromDosingCalibration),
  asyncHandler(async (req, res) => {
    await svc.deleteCalibration(Number(req.params.id));
    res.status(204).end();
  }),
);

// ── /dosing-rules/:id (รายตัว) + rule กลาง (systemId null) ────────────
export const ruleRouter = Router();

// สร้าง rule กลาง (ไม่ผูกระบบ) ผ่าน POST /dosing-rules
ruleRouter.post(
  '/',
  validate({ body: ruleBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await svc.createRule(req.user!, req.body)));
  }),
);

ruleRouter.patch(
  '/:id',
  validate({ params: idParam, body: ruleBody.partial() }),
  requireDosingRuleEdit,
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateRule(Number(req.params.id), req.body)));
  }),
);

ruleRouter.delete(
  '/:id',
  validate({ params: idParam }),
  requireDosingRuleEdit,
  asyncHandler(async (req, res) => {
    await svc.deleteRule(Number(req.params.id));
    res.status(204).end();
  }),
);
