import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../lib/http';
import { idParam } from '../lib/validation';
import { validate } from '../middleware/validate';
import { env } from '../config/env';
import * as rules from '../services/reminders/rule.service';
import * as tasks from '../services/reminders/task.service';
import { runDigests, sendTestDigest } from '../services/reminders/digest.service';
import { parseYmd } from '../services/reminders/schedule';

// ════════════════════════════════════════════════════════════════════
//  แจ้งเตือน (P3) — หน้าเดียว 3 แท็บ: วันนี้ · ปฏิทิน · ตั้งค่าเตือน
//  + /scheduler/tick (public + secret) ให้ Plesk Scheduled Task เรียกทุก 15 นาที → ส่งอีเมลตามเวลา
// ════════════════════════════════════════════════════════════════════

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องเป็น YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'เวลาต้องเป็น HH:mm');
const priority = z.enum(['HIGH', 'MEDIUM', 'LOW']);

const ruleFields = {
  title: z.string().trim().min(1, 'ตั้งชื่อเรื่องด้วย').max(60),
  icon: z.string().trim().max(16).nullable().optional(),
  priority,
  repeat: z.enum(['EVERY_DAYS', 'WEEKDAYS', 'ONCE']),
  everyDays: z.number().int().min(1).max(365).nullable().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  timeOfDay: hhmm.optional(),
  active: z.boolean().optional(),
  startDate: ymd.nullable().optional(),
};

export const reminderRouter = Router();

// ── วันนี้ ──
reminderRouter.get(
  '/today',
  asyncHandler(async (req, res) => {
    res.json(await tasks.listToday(req.user!));
  }),
);

// ── ปฏิทิน ──
reminderRouter.get(
  '/calendar',
  validate({ query: z.object({ from: ymd, to: ymd, systemId: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => {
    const from = parseYmd(String(req.query.from));
    const to = parseYmd(String(req.query.to));
    if (to < from || +to - +from > 62 * 86_400_000) throw new AppError(400, 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 2 เดือน)');
    res.json(await tasks.calendar(req.user!, { from, to, systemId: req.query.systemId ? Number(req.query.systemId) : undefined }));
  }),
);

// ── งาน: เสร็จแล้ว / ข้าม ──
reminderRouter.post(
  '/tasks/:id/done',
  validate({ params: idParam, body: z.object({ doneAt: z.string().datetime({ offset: true }).optional() }).optional() }),
  asyncHandler(async (req, res) => {
    const doneAt = req.body?.doneAt ? new Date(req.body.doneAt) : undefined;
    await tasks.completeTask(req.user!, Number(req.params.id), doneAt);
    res.status(204).end();
  }),
);

reminderRouter.post(
  '/tasks/:id/skip',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await tasks.skipTask(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);

// ── กฎ (ตั้งค่าเตือน) ──
reminderRouter.get(
  '/rules',
  validate({ query: z.object({ systemId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    res.json(await rules.listRules(req.user!, Number(req.query.systemId)));
  }),
);

reminderRouter.post(
  '/rules',
  validate({ body: z.object({ systemId: z.number().int().positive(), ...ruleFields }) }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await rules.createRule(req.user!, req.body));
  }),
);

reminderRouter.patch(
  '/rules/:id',
  validate({ params: idParam, body: z.object(ruleFields).partial() }),
  asyncHandler(async (req, res) => {
    res.json(await rules.updateRule(req.user!, Number(req.params.id), req.body));
  }),
);

reminderRouter.delete(
  '/rules/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await rules.deleteRule(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);

reminderRouter.get(
  '/rules/:id/history',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(await tasks.ruleHistory(req.user!, Number(req.params.id)));
  }),
);

/** ทำก่อนกำหนด (จากรายการ "เร็วๆ นี้") */
reminderRouter.post(
  '/rules/:id/done',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await tasks.doRuleNow(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);

// ── ส่งอีเมลทดสอบ (หน้าโปรไฟล์) ──
reminderRouter.post(
  '/test-email',
  asyncHandler(async (req, res) => {
    res.json(await sendTestDigest(req.user!.id));
  }),
);

// ════════════════════════════════════════════════════════════════════
//  /scheduler/tick — Plesk Scheduled Task (ทุก 15 นาที) · ใส่ secret ทาง header หรือ ?secret=
// ════════════════════════════════════════════════════════════════════

function requireSchedulerSecret(req: Request, _res: Response, next: NextFunction) {
  const provided = req.get('x-scheduler-secret') ?? (req.query.secret as string | undefined);
  if (provided !== env.SCHEDULER_SECRET) return next(new AppError(401, 'scheduler secret ไม่ถูกต้อง'));
  next();
}

export async function tick(now = new Date()) {
  const digest = await runDigests(now);
  return { now: now.toISOString(), ...digest };
}

export const schedulerRouter = Router();
const runTick = asyncHandler(async (_req, res) => {
  res.json(await tick());
});
schedulerRouter.get('/tick', requireSchedulerSecret, runTick);
schedulerRouter.post('/tick', requireSchedulerSecret, runTick);
