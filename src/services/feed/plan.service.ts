import type { FeedPattern, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import { addDays, feedIndex, feedTimeOn, isFeedDay, parseYmdLocal, startOfLocalDay, ymdLocal } from '../../lib/feedingCycle';
import { publishFeeding } from '../../lib/realtime';
import type { AuthUser } from '../auth.service';
import { ensureFeedItems } from './items';

// ════════════════════════════════════════════════════════════════════
//  แผนให้อาหาร (ข้อ 4.6.8.4) — 1 ระบบ 1 แผน
//  วงรอบ: ให้ N วัน เว้น M วัน · อาหาร: อย่างเดียว / สลับ 2 อย่างทีละรอบ · ปรับรายวัน: เปลี่ยนอาหาร / วันนี้ไม่ให้
// ════════════════════════════════════════════════════════════════════

export type PlanLike = {
  onDays: number;
  offDays: number;
  anchorDate: Date;
  timeOfDay: string;
  pattern: FeedPattern;
  itemId: number | null;
  altItemId: number | null;
};
export type DayOverride = { skip: boolean; itemId: number | null };

/** วันนั้นตามแผน: ให้ไหม / ข้ามไหม / อาหารอะไร */
export function dayPlan(plan: PlanLike, overrides: Map<string, DayOverride>, day: Date) {
  const date = ymdLocal(day);
  const o = overrides.get(date);
  const feed = isFeedDay(plan, day);
  let itemId = plan.itemId;
  if (plan.pattern === 'ALTERNATE' && plan.altItemId) {
    const idx = feedIndex(plan, day);
    itemId = ((idx % 2) + 2) % 2 === 0 ? plan.itemId : plan.altItemId;
  }
  if (o?.itemId) itemId = o.itemId;
  return { date, feed, skip: feed && !!o?.skip, itemId, override: !!o };
}

export const overridesOf = (days: { date: string; skip: boolean; itemId: number | null }[]) =>
  new Map(days.map((d) => [d.date, { skip: d.skip, itemId: d.itemId }]));

const PLAN_SELECT = {
  id: true,
  systemId: true,
  active: true,
  onDays: true,
  offDays: true,
  anchorDate: true,
  timeOfDay: true,
  pattern: true,
  itemId: true,
  altItemId: true,
  piecesPerCrab: true,
  createdAt: true,
} satisfies Prisma.FeedingPlanSelect;

async function ownedSystem(user: AuthUser, systemId: number) {
  return assertOwned(await prisma.crabSystem.findUnique({ where: { id: systemId }, select: { id: true, ownerId: true } }), user, 'ระบบปูนี้');
}

export const aliveCount = (systemId: number) => prisma.crab.count({ where: { systemId, status: 'ALIVE', deletedAt: null } });

/** แผน + พรีวิว 14 วัน (แตะวันไหนก็เปลี่ยนได้) */
export async function getPlan(user: AuthUser, systemId: number, now = new Date()) {
  await ownedSystem(user, systemId);
  await ensureFeedItems(user.id);
  const plan = await prisma.feedingPlan.findUnique({ where: { systemId }, select: { ...PLAN_SELECT, days: true } });
  if (!plan) return { plan: null, preview: [] };
  const crabs = await aliveCount(systemId);
  const overrides = overridesOf(plan.days);
  const pieces = plan.piecesPerCrab.toNumber();
  const today = startOfLocalDay(now);
  const preview = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(today, i);
    const d = dayPlan(plan, overrides, day);
    return {
      date: d.date,
      feed: d.feed,
      skip: d.skip,
      itemId: d.feed && !d.skip ? d.itemId : null,
      override: d.override,
      dueAt: feedTimeOn(plan, day),
      need: d.feed && !d.skip ? crabs * pieces : 0,
    };
  });
  const { days: _d, ...rest } = plan;
  return { plan: { ...rest, piecesPerCrab: pieces }, crabs, preview };
}

export type PlanInput = {
  systemId: number;
  active?: boolean;
  onDays: number;
  offDays: number;
  /** "YYYY-MM-DD" — วันแรกที่ให้ (ค่าเริ่มต้น = วันนี้) */
  anchorDate?: string;
  timeOfDay: string;
  pattern: FeedPattern;
  itemId: number;
  altItemId?: number | null;
  piecesPerCrab: number;
};

async function assertItems(user: AuthUser, ids: (number | null | undefined)[]) {
  const want = ids.filter((x): x is number => x != null);
  if (!want.length) return;
  const n = await prisma.feedItem.count({ where: { id: { in: want }, ownerId: user.id } });
  if (n !== new Set(want).size) throw badRequest('ไม่พบอาหารที่เลือก');
}

export async function savePlan(user: AuthUser, input: PlanInput) {
  await ownedSystem(user, input.systemId);
  if (input.onDays < 1 || input.onDays > 14 || input.offDays < 0 || input.offDays > 14) throw badRequest('วงรอบไม่ถูกต้อง');
  if (input.pattern === 'ALTERNATE' && (!input.altItemId || input.altItemId === input.itemId)) throw badRequest('แบบสลับต้องเลือกอาหาร 2 อย่างที่ต่างกัน');
  if (!(input.piecesPerCrab > 0 && input.piecesPerCrab <= 20)) throw badRequest('จำนวนชิ้นต่อตัวไม่ถูกต้อง');
  await assertItems(user, [input.itemId, input.altItemId]);
  const data = {
    active: input.active ?? true,
    onDays: input.onDays,
    offDays: input.offDays,
    anchorDate: input.anchorDate ? parseYmdLocal(input.anchorDate) : startOfLocalDay(new Date()),
    timeOfDay: input.timeOfDay,
    pattern: input.pattern,
    itemId: input.itemId,
    altItemId: input.pattern === 'ALTERNATE' ? input.altItemId! : null,
    piecesPerCrab: input.piecesPerCrab,
  };
  await prisma.feedingPlan.upsert({
    where: { systemId: input.systemId },
    create: { ...data, ownerId: user.id, systemId: input.systemId },
    update: data,
  });
  return getPlan(user, input.systemId);
}

/** ปรับวันเดียว: skip = วันนี้ไม่ให้อาหาร · itemId = เปลี่ยนอาหารวันนั้น · ทั้งคู่ว่าง = กลับไปตามแผน */
export async function setPlanDay(user: AuthUser, input: { systemId: number; date: string; skip: boolean; itemId: number | null }) {
  await ownedSystem(user, input.systemId);
  const plan = await prisma.feedingPlan.findUnique({ where: { systemId: input.systemId }, select: { id: true } });
  if (!plan) throw badRequest('ยังไม่ได้ตั้งแผนให้อาหาร');
  await assertItems(user, [input.itemId]);
  if (!input.skip && !input.itemId) {
    await prisma.feedingPlanDay.deleteMany({ where: { planId: plan.id, date: input.date } });
  } else {
    await prisma.feedingPlanDay.upsert({
      where: { planId_date: { planId: plan.id, date: input.date } },
      create: { planId: plan.id, date: input.date, skip: input.skip, itemId: input.itemId },
      update: { skip: input.skip, itemId: input.itemId },
    });
  }
  // วันนี้มีรอบเปิดอยู่แล้ว (ยังไม่ได้ให้) แล้วกด "วันนี้ไม่ให้อาหาร" → ปิดรอบนั้นเป็น "ไม่ได้ให้"
  if (input.skip) {
    const rounds = await prisma.feedingRound.findMany({
      where: { systemId: input.systemId, feedDate: input.date, status: 'OPEN', fedAt: null },
      select: { id: true },
    });
    if (rounds.length) {
      const ids = rounds.map((r) => r.id);
      await prisma.$transaction([
        prisma.feedingRound.updateMany({ where: { id: { in: ids }, status: 'OPEN' }, data: { status: 'SKIPPED', closedAt: new Date() } }),
        prisma.feedingEntry.deleteMany({ where: { roundId: { in: ids } } }),
      ]);
      publishFeeding(input.systemId);
    }
  }
  return getPlan(user, input.systemId);
}
