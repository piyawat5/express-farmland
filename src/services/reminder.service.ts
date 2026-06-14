import { Prisma, ReminderRule, ScheduleKind, TriggerEvent } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';
import { nextCronAfter } from '../lib/cron';
import { createTaskFromRule } from './task.service';

// ── โมดูล D: ReminderRule = กฎแจ้งเตือน (อะไร/เมื่อไร/ตามจิกทุกกี่นาที) ──

const addDays = (d: Date, n: number) => {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + n);
  return out;
};
const addMonths = (d: Date, n: number) => {
  const out = new Date(d.getTime());
  out.setMonth(out.getMonth() + n);
  return out;
};

/** ตั้งเวลาในวัน (เช่น "20:00") ลงบน date — ถ้าไม่ระบุ คงเวลาเดิม */
function applyTimeOfDay(d: Date, timeOfDay?: string | null): Date {
  const out = new Date(d.getTime());
  if (timeOfDay) {
    const [hh, mm] = timeOfDay.split(':').map((v) => parseInt(v, 10));
    out.setHours(hh, mm || 0, 0, 0);
  }
  return out;
}

type ScheduleFields = Pick<
  ReminderRule,
  'scheduleKind' | 'intervalValue' | 'cronExpr' | 'timeOfDay'
>;

/**
 * คำนวณเวลา generate Task รอบถัดไป (นับจาก `after`)
 * - INTERVAL_DAYS/MONTHS: ยึด timeOfDay ถ้ามี ไม่งั้น +interval จาก after ตรงๆ
 * - CRON: หานาทีถัดไปที่ตรง expression
 * - EVENT: null (ถูกสร้างจาก event ไม่ใช่ตามเวลา)
 */
export function computeNextRunAt(rule: ScheduleFields, after: Date): Date | null {
  const interval = rule.intervalValue ?? 1;

  switch (rule.scheduleKind) {
    case 'CRON':
      return rule.cronExpr ? nextCronAfter(rule.cronExpr, after) : null;

    case 'INTERVAL_DAYS': {
      if (rule.timeOfDay) {
        let c = applyTimeOfDay(after, rule.timeOfDay);
        while (c <= after) c = addDays(c, interval);
        return c;
      }
      return addDays(after, interval);
    }

    case 'INTERVAL_MONTHS': {
      if (rule.timeOfDay) {
        let c = applyTimeOfDay(after, rule.timeOfDay);
        while (c <= after) c = addMonths(c, interval);
        return c;
      }
      return addMonths(after, interval);
    }

    case 'EVENT':
    default:
      return null;
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────

export function listReminderRules(systemId?: number) {
  return prisma.reminderRule.findMany({
    where: systemId == null ? undefined : { OR: [{ systemId }, { systemId: null }] },
    orderBy: { id: 'asc' },
  });
}

export async function getReminderRule(id: number) {
  const rule = await prisma.reminderRule.findUnique({ where: { id } });
  if (!rule) throw notFound('ไม่พบกฎแจ้งเตือนนี้');
  return rule;
}

/** สร้างกฎ — คำนวณ nextRunAt ให้เลยถ้าเป็นแบบตามเวลา + active */
export async function createReminderRule(data: Prisma.ReminderRuleUncheckedCreateInput) {
  const active = data.active ?? true;
  const nextRunAt =
    active && data.scheduleKind !== 'EVENT'
      ? computeNextRunAt(
          {
            scheduleKind: data.scheduleKind as ScheduleKind,
            intervalValue: data.intervalValue ?? null,
            cronExpr: data.cronExpr ?? null,
            timeOfDay: data.timeOfDay ?? null,
          },
          new Date(),
        )
      : null;
  return prisma.reminderRule.create({ data: { ...data, nextRunAt } });
}

/** แก้กฎ — ถ้าแตะฟิลด์ตารางเวลา/active → คำนวณ nextRunAt ใหม่ */
export async function updateReminderRule(id: number, data: Prisma.ReminderRuleUncheckedUpdateInput) {
  const current = await getReminderRule(id);
  const merged = { ...current, ...data } as ReminderRule;

  const scheduleTouched =
    ['scheduleKind', 'intervalValue', 'cronExpr', 'timeOfDay', 'active'].some(
      (k) => k in data,
    );

  let nextRunAt: Date | null | undefined;
  if (scheduleTouched) {
    nextRunAt =
      merged.active && merged.scheduleKind !== 'EVENT'
        ? computeNextRunAt(merged, new Date())
        : null;
  }

  return prisma.reminderRule.update({
    where: { id },
    data: { ...data, ...(nextRunAt !== undefined ? { nextRunAt } : {}) },
  });
}

export async function deleteReminderRule(id: number) {
  await getReminderRule(id);
  await prisma.reminderRule.delete({ where: { id } });
}

// ── Event chain — สร้าง Task จากกฎแบบ EVENT เมื่อเกิดเหตุการณ์ ──────────
//
// เช่น หลังเติมน้ำจืด (AFTER_FRESHWATER) → สร้าง Task วัดค่าน้ำ
// dueAt = ตอนนี้ + leadDays (ถ้าตั้งไว้)

export async function fireEvent(event: TriggerEvent, systemId: number): Promise<number> {
  const rules = await prisma.reminderRule.findMany({
    where: {
      active: true,
      scheduleKind: 'EVENT',
      triggerEvent: event,
      OR: [{ systemId }, { systemId: null }],
    },
  });

  let created = 0;
  const now = new Date();
  for (const rule of rules) {
    const dueAt = rule.leadDays ? new Date(now.getTime() + rule.leadDays * 86400_000) : now;
    // ใช้ systemId ของ event เสมอ (rule กลางอาจ systemId=null)
    await createTaskFromRule({ ...rule, systemId }, dueAt);
    created++;
  }
  return created;
}
