import { Prisma, ReminderRule, ScheduleKind, TriggerEvent } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';
import { nextCronAfter } from '../lib/cron';
import { createTaskFromRule } from './task.service';
import type { AuthUser } from './auth.service';
import { isAdmin, ownedSystemIds, assertOwnership } from '../lib/scope';

// ── โมดูล D: ReminderRule = กฎแจ้งเตือน (อะไร/เมื่อไร/ตามจิกทุกกี่นาที) ──

// เวลาเริ่มต้นของงานที่ตั้งแบบ "ทุก N วัน/เดือน" โดยไม่ระบุเวลา → ฟิกไว้ 08:00 น. (เวลาไทย)
// กันไม่ให้ dueAt ไปอิงเวลาตอนที่กดสร้างกฎ (เช่น 23:47) ซึ่งผู้ใช้ไม่ได้ตั้งใจ
const DEFAULT_TIME_OF_DAY = '08:00';

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
  // ถ้าไม่ระบุเวลา → ใช้ 08:00 (ผู้ใช้เลือกเวลาเองได้ผ่าน timeOfDay)
  const timeOfDay = rule.timeOfDay || DEFAULT_TIME_OF_DAY;

  switch (rule.scheduleKind) {
    case 'CRON':
      return rule.cronExpr ? nextCronAfter(rule.cronExpr, after) : null;

    case 'INTERVAL_DAYS': {
      let c = applyTimeOfDay(after, timeOfDay);
      while (c <= after) c = addDays(c, interval);
      return c;
    }

    case 'INTERVAL_MONTHS': {
      let c = applyTimeOfDay(after, timeOfDay);
      while (c <= after) c = addMonths(c, interval);
      return c;
    }

    case 'EVENT':
    default:
      return null;
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function listReminderRules(user: AuthUser, systemId?: number) {
  // มองเห็น = กฎของระบบที่ user เข้าถึง + กฎกลาง (systemId=null) ของ user เอง
  let where: Prisma.ReminderRuleWhereInput | undefined;
  if (isAdmin(user)) {
    where = systemId == null ? undefined : { OR: [{ systemId }, { systemId: null }] };
  } else {
    const owned = (await ownedSystemIds(user)) ?? [];
    const sysClause =
      systemId != null
        ? { systemId: { in: owned.includes(systemId) ? [systemId] : [] } }
        : { systemId: { in: owned } };
    where = { OR: [sysClause, { systemId: null, ownerId: user.id }] };
  }
  return prisma.reminderRule.findMany({ where, orderBy: { id: 'asc' } });
}

export async function getReminderRule(id: number, user?: AuthUser) {
  const rule = await prisma.reminderRule.findUnique({ where: { id } });
  if (!rule) throw notFound('ไม่พบกฎแจ้งเตือนนี้');
  if (user) assertOwnership(user, rule.ownerId);
  return rule;
}

/** สร้างกฎ — ownerId = เจ้าของระบบ (ถ้าผูกระบบ) ไม่งั้น = user; คำนวณ nextRunAt ถ้าตามเวลา + active */
export async function createReminderRule(
  user: AuthUser,
  data: Prisma.ReminderRuleUncheckedCreateInput,
) {
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
  let ownerId: number = user.id;
  if (data.systemId != null) {
    const sys = await prisma.crabSystem.findUnique({
      where: { id: Number(data.systemId) },
      select: { ownerId: true },
    });
    ownerId = sys?.ownerId ?? user.id;
  }
  return prisma.reminderRule.create({ data: { ...data, ownerId, nextRunAt } });
}

/** แก้กฎ — ถ้าแตะฟิลด์ตารางเวลา/active → คำนวณ nextRunAt ใหม่ */
export async function updateReminderRule(
  id: number,
  user: AuthUser,
  data: Prisma.ReminderRuleUncheckedUpdateInput,
) {
  const current = await getReminderRule(id, user);
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

export async function deleteReminderRule(id: number, user: AuthUser) {
  await getReminderRule(id, user);
  await prisma.reminderRule.delete({ where: { id } });
}

// ── Event chain — สร้าง Task จากกฎแบบ EVENT เมื่อเกิดเหตุการณ์ ──────────
//
// เช่น หลังเติมน้ำจืด (AFTER_FRESHWATER) → สร้าง Task วัดค่าน้ำ
// dueAt = ตอนนี้ + leadDays (ถ้าตั้งไว้)

export async function fireEvent(event: TriggerEvent, systemId: number): Promise<number> {
  // กฎกลาง (systemId=null) ใช้ได้เฉพาะของเจ้าของระบบนี้ — กันกฎข้าม user
  const sys = await prisma.crabSystem.findUnique({
    where: { id: systemId },
    select: { ownerId: true },
  });
  const rules = await prisma.reminderRule.findMany({
    where: {
      active: true,
      scheduleKind: 'EVENT',
      triggerEvent: event,
      OR: [{ systemId }, { systemId: null, ownerId: sys?.ownerId ?? undefined }],
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
