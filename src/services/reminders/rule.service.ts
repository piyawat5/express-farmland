import type { Prisma, Priority, RepeatType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import type { AuthUser } from '../auth.service';
import { DEFAULT_CHECK_DAYS, DEFAULT_ORDER, KIND_ICON } from './defaults';
import { firstDueFrom, firstDueOn, isTimeBased, nextDueAfter, parseWeekdays, parseYmd } from './schedule';
import { markDirty, syncOwner } from './task.service';

// ════════════════════════════════════════════════════════════════════
//  กฎแจ้งเตือน (แท็บ "ตั้งค่าเตือน") — ต่อระบบปู
//  ค่าเริ่มต้น 6 เรื่อง (defaultKey) 🔒: แก้ชื่อ/ลบไม่ได้ · ให้อาหาร = ตามแผนให้อาหาร · เช็คปู = ปรับได้แค่จำนวนวัน
// ════════════════════════════════════════════════════════════════════

export const MAX_CUSTOM_RULES = 30;

const RULE_SELECT = {
  id: true,
  systemId: true,
  kind: true,
  defaultKey: true,
  title: true,
  icon: true,
  priority: true,
  repeat: true,
  everyDays: true,
  weekdays: true,
  timeOfDay: true,
  active: true,
  nextDueAt: true,
  lastDoneAt: true,
  createdAt: true,
} satisfies Prisma.ReminderRuleSelect;

type RuleRow = Prisma.ReminderRuleGetPayload<{ select: typeof RULE_SELECT }>;

const shapeRule = (r: RuleRow) => ({
  ...r,
  icon: r.icon ?? KIND_ICON[r.kind],
  weekdays: parseWeekdays(r.weekdays),
  locked: r.defaultKey != null,
});

async function ownedSystem(user: AuthUser, systemId: number) {
  return assertOwned(await prisma.crabSystem.findUnique({ where: { id: systemId }, select: { id: true, ownerId: true } }), user, 'ระบบปูนี้');
}

export async function listRules(user: AuthUser, systemId: number) {
  await ownedSystem(user, systemId);
  await syncOwner(user.id); // เติมค่าเริ่มต้นให้ระบบเก่า
  const rows = await prisma.reminderRule.findMany({ where: { systemId }, select: RULE_SELECT, orderBy: { id: 'asc' } });
  const rank = (r: RuleRow) => (r.defaultKey ? DEFAULT_ORDER.indexOf(r.defaultKey) : 100);
  return rows.sort((a, b) => rank(a) - rank(b) || a.id - b.id).map(shapeRule);
}

export type RuleInput = {
  title?: string;
  icon?: string | null;
  priority?: Priority;
  repeat?: RepeatType;
  everyDays?: number | null;
  weekdays?: number[];
  timeOfDay?: string;
  active?: boolean;
  /** "YYYY-MM-DD" — วันเริ่ม (ครั้งเดียว = วันที่เตือน) */
  startDate?: string | null;
};

function checkSchedule(repeat: RepeatType, everyDays: number | null | undefined, weekdays: number[], startDate?: string | null) {
  if (repeat === 'EVERY_DAYS' && !(everyDays && everyDays >= 1 && everyDays <= 365)) throw badRequest('ใส่จำนวนวัน 1-365');
  if (repeat === 'WEEKDAYS' && !weekdays.length) throw badRequest('เลือกวันอย่างน้อย 1 วัน');
  if (repeat === 'ONCE' && !startDate) throw badRequest('เลือกวันที่จะให้เตือน');
}

export async function createRule(user: AuthUser, input: RuleInput & { systemId: number; title: string; priority: Priority; repeat: RepeatType }) {
  await ownedSystem(user, input.systemId);
  if (input.repeat === 'FEEDING_PLAN') throw badRequest('เรื่องให้อาหารตั้งในเมนูอาหารปู');
  const custom = await prisma.reminderRule.count({ where: { systemId: input.systemId, defaultKey: null } });
  if (custom >= MAX_CUSTOM_RULES) throw badRequest(`เพิ่มได้สูงสุด ${MAX_CUSTOM_RULES} เรื่องต่อระบบ`);

  const weekdays = input.weekdays ?? [];
  checkSchedule(input.repeat, input.everyDays, weekdays, input.startDate);
  const sched = {
    repeat: input.repeat,
    everyDays: input.repeat === 'EVERY_DAYS' ? input.everyDays! : null,
    weekdays: input.repeat === 'WEEKDAYS' ? weekdays.join(',') : null,
    timeOfDay: input.timeOfDay ?? '08:00',
  };
  const nextDueAt = input.startDate ? firstDueOn(sched, parseYmd(input.startDate)) : firstDueFrom(sched, new Date());

  const row = await prisma.reminderRule.create({
    data: {
      ownerId: user.id,
      systemId: input.systemId,
      kind: 'CUSTOM',
      title: input.title.trim(),
      icon: input.icon || null,
      priority: input.priority,
      ...sched,
      active: input.active ?? true,
      nextDueAt: input.active === false ? null : nextDueAt,
    },
    select: RULE_SELECT,
  });
  markDirty(user.id);
  return shapeRule(row);
}

export async function updateRule(user: AuthUser, id: number, input: RuleInput) {
  const now = new Date();
  const rule = assertOwned(await prisma.reminderRule.findUnique({ where: { id } }), user, 'แจ้งเตือนนี้');
  const locked = rule.defaultKey != null;
  const schedTouched =
    input.repeat !== undefined || input.everyDays !== undefined || input.weekdays !== undefined || input.timeOfDay !== undefined || input.startDate !== undefined;

  if (locked && input.title !== undefined && input.title.trim() !== rule.title) throw badRequest('ชื่อเรื่องเริ่มต้นแก้ไม่ได้');
  if (rule.kind === 'FEEDING' && (input.repeat !== undefined || input.everyDays !== undefined || input.weekdays !== undefined)) {
    throw badRequest('รอบให้อาหารตั้งในเมนูอาหารปู');
  }
  if (rule.kind === 'CRAB_CHECK' && (input.repeat !== undefined || input.weekdays !== undefined)) throw badRequest('เช็คปูปรับได้แค่จำนวนวัน');
  if (input.repeat === 'FEEDING_PLAN' && rule.kind !== 'FEEDING') throw badRequest('รูปแบบรอบไม่ถูกต้อง');
  if (locked && input.repeat === 'ONCE') throw badRequest('เรื่องเริ่มต้นตั้งเป็นครั้งเดียวไม่ได้');

  const merged = {
    repeat: input.repeat ?? rule.repeat,
    everyDays: input.everyDays !== undefined ? input.everyDays : rule.everyDays,
    weekdays: input.weekdays !== undefined ? input.weekdays.join(',') : rule.weekdays,
    timeOfDay: input.timeOfDay ?? rule.timeOfDay,
  };
  if (schedTouched) checkSchedule(merged.repeat, merged.everyDays, parseWeekdays(merged.weekdays), input.startDate ?? (merged.repeat === 'ONCE' ? 'keep' : null));

  const active = input.active ?? rule.active;
  const reactivated = active && !rule.active;
  if (reactivated && merged.repeat === 'ONCE' && !input.startDate) throw badRequest('เลือกวันที่จะให้เตือน');

  const data: Prisma.ReminderRuleUpdateInput = {
    title: input.title?.trim() || undefined,
    icon: input.icon !== undefined ? input.icon || null : undefined,
    priority: input.priority,
    repeat: merged.repeat,
    everyDays: merged.repeat === 'EVERY_DAYS' ? merged.everyDays : null,
    weekdays: merged.repeat === 'WEEKDAYS' ? merged.weekdays : null,
    timeOfDay: merged.timeOfDay,
    active,
  };

  await prisma.$transaction(async (tx) => {
    if (!active) {
      // ปิดเรื่องนี้ = งานที่ค้างของเรื่องนี้หายไปด้วย
      await tx.task.deleteMany({ where: { ruleId: id, status: 'OPEN' } });
      data.nextDueAt = null;
    } else if (rule.kind === 'CRAB_CHECK') {
      if (reactivated) data.nextDueAt = null; // เปิดใหม่ = ไม่พักเตือน
    } else if (isTimeBased(merged) && (schedTouched || reactivated)) {
      // งานที่ยังไม่ถึงเวลาลบทิ้งแล้วคิดรอบใหม่ · งานที่เลยกำหนดแล้วคงไว้ (ยังต้องทำอยู่)
      await tx.task.deleteMany({ where: { ruleId: id, status: 'OPEN', dueAt: { gt: now } } });
      const overdue = await tx.task.findFirst({ where: { ruleId: id, status: 'OPEN' }, select: { id: true } });
      if (!overdue) {
        if (input.startDate) data.nextDueAt = firstDueOn(merged, parseYmd(input.startDate));
        else if (merged.repeat === 'ONCE') data.nextDueAt = rule.nextDueAt ? firstDueOn(merged, rule.nextDueAt) : null;
        else if (rule.lastDoneAt && !reactivated) data.nextDueAt = nextDueAfter(merged, rule.lastDoneAt);
        else data.nextDueAt = firstDueFrom(merged, now);
      }
    }
    await tx.reminderRule.update({ where: { id }, data });
    // งานที่เปิดอยู่ใช้ชื่อ/ความสำคัญล่าสุด (ลดความสำคัญ = ป๊อปอัปด่วนหยุดทันที)
    if (input.priority || input.title) {
      await tx.task.updateMany({
        where: { ruleId: id, status: 'OPEN' },
        data: { priority: input.priority, title: input.title?.trim() || undefined },
      });
    }
  });
  markDirty(user.id);
  const row = await prisma.reminderRule.findUniqueOrThrow({ where: { id }, select: RULE_SELECT });
  return shapeRule(row);
}

export async function deleteRule(user: AuthUser, id: number) {
  const rule = assertOwned(await prisma.reminderRule.findUnique({ where: { id } }), user, 'แจ้งเตือนนี้');
  if (rule.defaultKey) throw badRequest('เรื่องเริ่มต้นลบไม่ได้ ปิดสวิตช์แทนได้');
  await prisma.reminderRule.delete({ where: { id } }); // งานของเรื่องนี้ลบตาม (cascade)
  markDirty(user.id);
}

/** รอบเช็คปูของระบบ (ผังกล่องใช้วาด ⚠ ถึงรอบเช็ค) — ปิดเรื่องเช็คปูไว้ = null (ไม่ขึ้น ⚠) */
export async function checkEveryDays(systemId: number): Promise<number | null> {
  const r = await prisma.reminderRule.findUnique({
    where: { systemId_defaultKey: { systemId, defaultKey: 'CRAB_CHECK' } },
    select: { active: true, everyDays: true },
  });
  if (!r) return DEFAULT_CHECK_DAYS;
  return r.active ? (r.everyDays ?? DEFAULT_CHECK_DAYS) : null;
}
