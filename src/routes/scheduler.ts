import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError } from '../lib/http';
import { validate } from '../middleware/validate';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import { env } from '../config/env';
import { tick } from '../services/scheduler.service';
import { notifyTask } from '../lib/notify';
import * as reminders from '../services/reminder.service';
import * as tasks from '../services/task.service';

// ════════════════════════════════════════════════════════════════════
//  โมดูล D — Scheduler tick / ReminderRule / Task
// ════════════════════════════════════════════════════════════════════

const reminderType = z.enum([
  'WATER_TEST',
  'DOSING',
  'FRESHWATER_TOPUP',
  'FEEDING',
  'SCRAP_COLLECT',
  'FILTER_CLEAN',
  'SUBSTANCE_PREP',
  'RESTOCK',
  'CUSTOM',
]);
const scheduleKind = z.enum(['INTERVAL_DAYS', 'INTERVAL_MONTHS', 'CRON', 'EVENT']);
const triggerEvent = z.enum(['AFTER_FRESHWATER', 'AFTER_WATER_TEST', 'AFTER_FEEDING']);
const taskStatus = z.enum(['PENDING', 'DONE', 'SKIPPED', 'CANCELLED']);

// ── /scheduler/tick — ป้องกันด้วย header x-scheduler-secret ────────────
export const schedulerRouter = Router();

// รับ secret ได้ทั้ง header `x-scheduler-secret` และ query `?secret=` (Plesk cron เรียกผ่าน GET ง่ายๆ)
function requireSchedulerSecret(req: Request, _res: Response, next: NextFunction) {
  const provided = req.get('x-scheduler-secret') ?? (req.query.secret as string | undefined);
  if (provided !== env.SCHEDULER_SECRET) {
    return next(new AppError(401, 'scheduler secret ไม่ถูกต้อง'));
  }
  next();
}

// cron จาก Plesk เรียกได้ทั้ง GET (สะดวก curl) และ POST — ทำงานเหมือนกัน:
// generate งานถึงรอบ → ถ้ามีงานค้าง ส่งเมลสรุป "คุณมีงานค้าง N รายการ" ฉบับเดียว
const runTick = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await tick());
});

schedulerRouter.get('/tick', requireSchedulerSecret, runTick);
schedulerRouter.post('/tick', requireSchedulerSecret, runTick);

// ── /reminder-rules — CRUD กฎแจ้งเตือน ────────────────────────────────
const reminderRuleBody = z.object({
  systemId: z.number().int().positive().nullable().optional(),
  type: reminderType,
  title: z.string().min(1),
  scheduleKind,
  intervalValue: z.number().int().positive().nullable().optional(),
  cronExpr: z.string().nullable().optional(),
  triggerEvent: triggerEvent.nullable().optional(),
  timeOfDay: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/, 'รูปแบบเวลาต้องเป็น HH:mm')
    .nullable()
    .optional(),
  leadDays: z.number().int().nullable().optional(),
  reNotifyEveryMin: z.number().int().min(1).optional(),
  payload: z.record(z.unknown()).nullable().optional(),
  active: z.boolean().optional(),
});

export const reminderRuleRouter = Router();

reminderRuleRouter.get(
  '/',
  validate({ query: z.object({ systemId: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => {
    const systemId = req.query.systemId ? Number(req.query.systemId) : undefined;
    res.json(serialize(await reminders.listReminderRules(systemId)));
  }),
);

reminderRuleRouter.post(
  '/',
  validate({ body: reminderRuleBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await reminders.createReminderRule(req.body)));
  }),
);

reminderRuleRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await reminders.getReminderRule(Number(req.params.id))));
  }),
);

reminderRuleRouter.patch(
  '/:id',
  validate({ params: idParam, body: reminderRuleBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await reminders.updateReminderRule(Number(req.params.id), req.body)));
  }),
);

reminderRuleRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await reminders.deleteReminderRule(Number(req.params.id));
    res.status(204).end();
  }),
);

// ── /tasks — งานจริง (อ่าน + เปลี่ยนสถานะ manual + บังคับส่งเตือน) ──────
export const taskRouter = Router();

taskRouter.get(
  '/',
  validate({
    query: z.object({
      systemId: z.coerce.number().int().positive().optional(),
      status: taskStatus.optional(),
      type: reminderType.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(
      serialize(
        await tasks.listTasks({
          systemId: req.query.systemId ? Number(req.query.systemId) : undefined,
          status: req.query.status as z.infer<typeof taskStatus> | undefined,
          type: req.query.type as z.infer<typeof reminderType> | undefined,
        }),
      ),
    );
  }),
);

taskRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await tasks.getTask(Number(req.params.id))));
  }),
);

// เปลี่ยนสถานะ manual — ข้าม/ยกเลิก (DONE ต้องมาจาก record จริงเท่านั้น)
taskRouter.patch(
  '/:id',
  validate({ params: idParam, body: z.object({ status: taskStatus }) }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await tasks.updateTaskStatus(Number(req.params.id), req.body.status)));
  }),
);

// บังคับส่งแจ้งเตือนทันที (debug / ทดสอบเมล)
taskRouter.post(
  '/:id/notify',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const ok = await notifyTask(Number(req.params.id));
    res.json({ sent: ok });
  }),
);

// ── /systems/:id/fire-event — ยิง event chain แบบ manual (เช่น หลังเติมน้ำจืด) ──
export const systemEventRouter = Router();

systemEventRouter.post(
  '/:id/fire-event',
  validate({ params: idParam, body: z.object({ event: triggerEvent }) }),
  asyncHandler(async (req, res) => {
    const created = await reminders.fireEvent(req.body.event, Number(req.params.id));
    res.status(201).json({ event: req.body.event, tasksCreated: created });
  }),
);
