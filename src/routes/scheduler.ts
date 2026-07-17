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
import { requireSystemEdit, systemIdFromParam } from '../middleware/auth';

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
  'CRAB_CHECK',
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
    res.json(serialize(await reminders.listReminderRules(req.user!, systemId)));
  }),
);

reminderRuleRouter.post(
  '/',
  validate({ body: reminderRuleBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await reminders.createReminderRule(req.user!, req.body)));
  }),
);

reminderRuleRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await reminders.getReminderRule(Number(req.params.id), req.user!)));
  }),
);

reminderRuleRouter.patch(
  '/:id',
  validate({ params: idParam, body: reminderRuleBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await reminders.updateReminderRule(Number(req.params.id), req.user!, req.body)));
  }),
);

reminderRuleRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await reminders.deleteReminderRule(Number(req.params.id), req.user!);
    res.status(204).end();
  }),
);

// ── /tasks — งานจริง (อ่าน + เปลี่ยนสถานะ manual + บังคับส่งเตือน) ──────
export const taskRouter = Router();

// ข้อ 5.4: สร้าง "งานเตือนครั้งเดียว" — กรอกข้อความ + วันครบกำหนดเอง (ไม่มีประเภท/รอบ)
taskRouter.post(
  '/',
  validate({
    body: z.object({
      title: z.string().min(1),
      dueAt: z.string().datetime(),
      systemId: z.number().int().positive().nullable().optional(),
      detail: z.string().nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const created = await tasks.createManualTask(req.user!, {
      title: req.body.title,
      dueAt: new Date(req.body.dueAt),
      systemId: req.body.systemId ?? null,
      detail: req.body.detail ?? null,
    });
    res.status(201).json(serialize(created));
  }),
);

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
        await tasks.listTasks(req.user!, {
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
    res.json(serialize(await tasks.getTask(Number(req.params.id), req.user!)));
  }),
);

// ประวัติรอบที่ผ่านมาของงานตามรอบ (ข้อ 1.4 / 2.3) — คืนงานพี่น้องที่ปิด/ข้ามแล้ว
taskRouter.get(
  '/:id/history',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await tasks.listTaskHistory(Number(req.params.id), req.user!)));
  }),
);

// เปลี่ยนสถานะ manual — ข้าม/ยกเลิก (DONE ต้องมาจาก record จริงเท่านั้น)
taskRouter.patch(
  '/:id',
  validate({ params: idParam, body: z.object({ status: taskStatus }) }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await tasks.updateTaskStatus(Number(req.params.id), req.user!, req.body.status)));
  }),
);

// กดปุ่ม "ทำเสร็จแล้ว" — ปิดงานตามรอบที่ไม่มี record มาปิด (ให้อาหาร/เติมน้ำจืด/ล้างกรอง ฯลฯ)
// งานวัดน้ำ/ปรุงน้ำ/ของใกล้หมด จะถูกบล็อก (ต้องปิดจากการบันทึกข้อมูลจริง)
taskRouter.post(
  '/:id/complete',
  validate({ params: idParam, body: z.object({ doneAt: z.string().datetime().optional() }).optional() }),
  asyncHandler(async (req, res) => {
    const doneAt = req.body?.doneAt ? new Date(req.body.doneAt) : undefined;
    res.json(serialize(await tasks.completeTaskManually(Number(req.params.id), req.user!, doneAt)));
  }),
);

// บังคับส่งแจ้งเตือนทันที (debug / ทดสอบเมล) — เฉพาะงานของตัวเอง
taskRouter.post(
  '/:id/notify',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await tasks.getTask(Number(req.params.id), req.user!); // assert เจ้าของก่อนสั่งส่งเมล
    const ok = await notifyTask(Number(req.params.id));
    res.json({ sent: ok });
  }),
);

// ── /systems/:id/fire-event — ยิง event chain แบบ manual (เช่น หลังเติมน้ำจืด) ──
export const systemEventRouter = Router();

systemEventRouter.post(
  '/:id/fire-event',
  validate({ params: idParam, body: z.object({ event: triggerEvent }) }),
  requireSystemEdit(systemIdFromParam()),
  asyncHandler(async (req, res) => {
    const created = await reminders.fireEvent(req.body.event, Number(req.params.id));
    res.status(201).json({ event: req.body.event, tasksCreated: created });
  }),
);
