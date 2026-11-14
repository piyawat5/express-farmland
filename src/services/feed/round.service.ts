import { Prisma, type EatResult } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import { publishFeeding } from '../../lib/realtime';
import { addDays, feedTimeOn, startOfLocalDay, ymdLocal } from '../../lib/feedingCycle';
import type { AuthUser } from '../auth.service';
import { ensureFeedItems } from './items';
import { aliveCount, dayPlan, overridesOf } from './plan.service';
import { applyRoundStock } from './stock.service';

// ════════════════════════════════════════════════════════════════════
//  รอบให้อาหาร (ข้อ 4.6.8) — 1 ระบบเปิดได้ทีละรอบ
//  ชีวิตของรอบ: เปิด (ถึงเวลาให้อาหาร / กด "เริ่มให้อาหาร") → "ให้อาหารแล้ว" (fedAt — แจ้งเตือนให้อาหารปิด)
//              → แตะเฉพาะตัวที่ไม่กิน/กินน้อย → "เสร็จแล้ว" (ปิด + ตัดสต็อก)
//  ลืมปิด: ถึงเวลารอบใหม่ → ปิดรอบเก่าให้เอง (ตัวที่ไม่ได้แตะ = กินหมด) + ถามยืนยันครั้งเดียว (reviewPending)
//  ทุกตัวมีแถวผลการกินตั้งแต่เปิดรอบ (เริ่มที่ "กินหมด") → 300 กล่องก็แตะแค่ตัวที่มีปัญหา
// ════════════════════════════════════════════════════════════════════

const TX_OPTS = { timeout: 20_000, maxWait: 10_000 };
type Tx = Prisma.TransactionClient;

/** แถวผลการกินของปูที่ยังเลี้ยงอยู่ทุกตัว (เริ่มที่กินหมด) */
async function snapshotEntries(tx: Tx, roundId: number, systemId: number, itemId: number | null, pieces: number) {
  const crabs = await tx.crab.findMany({ where: { systemId, status: 'ALIVE', deletedAt: null }, select: { id: true, boxId: true } });
  if (!crabs.length) return;
  await tx.feedingEntry.createMany({
    data: crabs.map((c) => ({ roundId, crabId: c.id, boxId: c.boxId, itemId, pieces })),
    skipDuplicates: true,
  });
}

/** สร้างรอบ (กันซ้ำด้วย unique systemId+feedDate) — คืน id หรือ null ถ้ามีอยู่แล้ว */
async function createRound(ownerId: number, systemId: number, feedDate: string, dueAt: Date, itemId: number | null, pieces: number, fedAt?: Date) {
  try {
    return await prisma.$transaction(async (tx) => {
      const round = await tx.feedingRound.create({ data: { ownerId, systemId, feedDate, dueAt, fedAt: fedAt ?? null } });
      await snapshotEntries(tx, round.id, systemId, itemId, pieces);
      return round.id;
    }, TX_OPTS);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
    throw e;
  }
}

/** ปิดรอบ (ครั้งเดียว — conditional update กัน 2 เครื่องกดพร้อมกัน) + ตัดสต็อก */
async function closeRoundRow(roundId: number, opts: { auto: boolean; now: Date }) {
  const round = await prisma.feedingRound.findUnique({ where: { id: roundId }, select: { systemId: true, dueAt: true, fedAt: true } });
  if (!round) return false;
  const ok = await prisma.$transaction(async (tx) => {
    const r = await tx.feedingRound.updateMany({
      where: { id: roundId, status: 'OPEN' },
      data: {
        status: 'DONE',
        closedAt: opts.now,
        autoClosed: opts.auto,
        reviewPending: opts.auto,
        // ปิดให้เองโดยยังไม่ได้กด "ให้อาหารแล้ว" = ถือว่าให้ตามเวลา (ถามยืนยันอยู่แล้ว)
        fedAt: round.fedAt ?? (opts.auto ? round.dueAt : opts.now),
      },
    });
    if (!r.count) return false;
    await applyRoundStock(tx, roundId);
    return true;
  }, TX_OPTS);
  if (ok) publishFeeding(round.systemId);
  return ok;
}

/**
 * เปิดรอบที่ถึงเวลาแล้ว + ปิดรอบเก่าที่ลืมปิด (เรียกจาก syncOwner ของแจ้งเตือน — ตอนเปิดหน้า/ตอน tick)
 * เปิดเฉพาะ "วันให้อาหารล่าสุดที่ถึงเวลาแล้ว" — ไม่ได้เปิดแอปหลายวัน = ไม่สร้างรอบย้อนหลังให้ (ไม่รู้ว่าให้จริงไหม)
 */
export async function syncFeeding(ownerId: number, now = new Date()) {
  const plans = await prisma.feedingPlan.findMany({
    where: { ownerId, active: true },
    include: { days: { where: { date: { gte: ymdLocal(addDays(now, -20)) } }, select: { date: true, skip: true, itemId: true } } },
  });

  for (const plan of plans) {
    const overrides = overridesOf(plan.days);
    const today = startOfLocalDay(now);
    let latest: { date: string; dueAt: Date; itemId: number | null } | null = null;
    for (let i = 0; i <= plan.onDays + plan.offDays + 1; i++) {
      const day = addDays(today, -i);
      const d = dayPlan(plan, overrides, day);
      const dueAt = feedTimeOn(plan, day);
      if (!d.feed || dueAt > now) continue;
      if (dueAt < plan.createdAt) break; // ก่อนมีแผน ไม่นับ
      if (!d.skip) latest = { date: d.date, dueAt, itemId: d.itemId };
      break;
    }
    if (!latest) continue;
    // มีรอบของวันนี้หรือใหม่กว่าแล้ว (เช่นกดเริ่มเองก่อนเวลา) → ไม่ต้องทำอะไร
    const newer = await prisma.feedingRound.count({ where: { systemId: plan.systemId, feedDate: { gte: latest.date } } });
    if (newer) continue;
    // ลืมปิดรอบเก่า → ปิดให้ (ตัวที่ไม่ได้แตะ = กินหมด) แล้วถามยืนยันทีหลัง
    const stale = await prisma.feedingRound.findMany({ where: { systemId: plan.systemId, status: 'OPEN' }, select: { id: true } });
    for (const r of stale) await closeRoundRow(r.id, { auto: true, now });
    const id = await createRound(ownerId, plan.systemId, latest.date, latest.dueAt, latest.itemId, plan.piecesPerCrab.toNumber());
    if (id) publishFeeding(plan.systemId);
  }
}

// ── อ่าน ──────────────────────────────────────────────────────────────

async function ownedSystem(user: AuthUser, systemId: number) {
  return assertOwned(await prisma.crabSystem.findUnique({ where: { id: systemId }, select: { id: true, ownerId: true } }), user, 'ระบบปูนี้');
}
async function ownedRound(user: AuthUser, id: number) {
  return assertOwned(await prisma.feedingRound.findUnique({ where: { id } }), user, 'รอบให้อาหารนี้');
}

const countResults = (entries: { result: EatResult }[]) => ({
  total: entries.length,
  little: entries.filter((e) => e.result === 'LITTLE').length,
  none: entries.filter((e) => e.result === 'NONE').length,
});

/** ทุกอย่างที่หน้ากล่องปูต้องใช้วาดแถบให้อาหาร (เรียกหลัง syncOwner) */
export async function getCurrent(user: AuthUser, systemId: number, now = new Date()) {
  await ownedSystem(user, systemId);
  await ensureFeedItems(user.id);
  const [plan, items, round, review, last] = await Promise.all([
    prisma.feedingPlan.findUnique({
      where: { systemId },
      include: { days: { where: { date: { gte: ymdLocal(now) } }, select: { date: true, skip: true, itemId: true } } },
    }),
    prisma.feedItem.findMany({
      where: { ownerId: user.id },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, emoji: true, unit: true, qty: true, stockSet: true, active: true },
    }),
    prisma.feedingRound.findFirst({
      where: { systemId, status: 'OPEN' },
      orderBy: { feedDate: 'desc' },
      select: { id: true, feedDate: true, dueAt: true, fedAt: true, entries: { select: { crabId: true, boxId: true, itemId: true, pieces: true, result: true } } },
    }),
    prisma.feedingRound.findMany({
      where: { systemId, reviewPending: true },
      orderBy: { feedDate: 'asc' },
      select: { id: true, feedDate: true, dueAt: true, fedAt: true, entries: { select: { result: true } } },
    }),
    // รอบก่อน (ปิดแล้ว) — ใช้บอก "รอบก่อนกินน้อย" ในโหมดเสียง/บนกล่อง
    prisma.feedingRound.findFirst({
      where: { systemId, status: 'DONE' },
      orderBy: { feedDate: 'desc' },
      select: { id: true, feedDate: true, entries: { where: { result: { not: 'ATE' } }, select: { crabId: true, result: true } } },
    }),
  ]);

  // รอบถัดไปตามแผน (ตอนไม่มีรอบเปิดอยู่)
  let next = null;
  if (plan?.active) {
    const overrides = overridesOf(plan.days);
    const crabs = await aliveCount(systemId);
    for (let i = 0; i <= 30; i++) {
      const day = addDays(startOfLocalDay(now), i);
      const d = dayPlan(plan, overrides, day);
      const dueAt = feedTimeOn(plan, day);
      if (!d.feed || d.skip) continue;
      // เวลาที่ผ่านไปแล้วแต่ไม่มีรอบ (เช่นเพิ่งสร้างแผน) = ไม่ใช่ "ครั้งถัดไป" — กด "เริ่มให้อาหารวันนี้" เองได้
      if (dueAt <= now) continue;
      if (round && d.date <= round.feedDate) continue;
      const exists = await prisma.feedingRound.count({ where: { systemId, feedDate: d.date } });
      if (exists) continue;
      next = { date: d.date, dueAt, itemId: d.itemId, pieces: plan.piecesPerCrab.toNumber(), crabs, need: crabs * plan.piecesPerCrab.toNumber() };
      break;
    }
  }

  // ของพอไหม (รอบที่เปิดอยู่ หรือรอบถัดไป) — "⚠ หอยมี 10 ต้องใช้ 30 → ให้ปลาแทนไหม?"
  const needBy = new Map<number, number>();
  if (round) {
    for (const e of round.entries) if (e.itemId) needBy.set(e.itemId, (needBy.get(e.itemId) ?? 0) + e.pieces.toNumber());
  } else if (next?.itemId) {
    needBy.set(next.itemId, next.need);
  }
  const shortages = items
    .filter((it) => it.stockSet && needBy.has(it.id) && it.qty.toNumber() < needBy.get(it.id)!)
    .map((it) => ({ itemId: it.id, need: needBy.get(it.id)!, have: it.qty.toNumber() }));

  return {
    plan: plan
      ? {
          id: plan.id,
          active: plan.active,
          onDays: plan.onDays,
          offDays: plan.offDays,
          timeOfDay: plan.timeOfDay,
          pattern: plan.pattern,
          itemId: plan.itemId,
          altItemId: plan.altItemId,
          piecesPerCrab: plan.piecesPerCrab.toNumber(),
        }
      : null,
    items: items.map((it) => ({ ...it, qty: it.qty.toNumber() })),
    round: round
      ? {
          id: round.id,
          feedDate: round.feedDate,
          dueAt: round.dueAt,
          fedAt: round.fedAt,
          entries: round.entries.map((e) => ({ ...e, pieces: e.pieces.toNumber() })),
        }
      : null,
    next,
    shortages,
    review: review.map((r) => ({ id: r.id, feedDate: r.feedDate, dueAt: r.dueAt, fedAt: r.fedAt, ...countResults(r.entries) })),
    last: last ? { roundId: last.id, feedDate: last.feedDate, results: last.entries } : null,
  };
}

/** ประวัติรอบ (หน้าอาหารปู) */
export async function listRounds(user: AuthUser, systemId: number, take = 10) {
  await ownedSystem(user, systemId);
  const rows = await prisma.feedingRound.findMany({
    where: { systemId },
    orderBy: { feedDate: 'desc' },
    take: Math.min(60, Math.max(1, take)),
    select: {
      id: true,
      feedDate: true,
      dueAt: true,
      status: true,
      fedAt: true,
      closedAt: true,
      autoClosed: true,
      reviewPending: true,
      entries: { select: { result: true, itemId: true, pieces: true } },
    },
  });
  return rows.map(({ entries, ...r }) => {
    const food = new Map<number, number>();
    for (const e of entries) if (e.itemId) food.set(e.itemId, (food.get(e.itemId) ?? 0) + e.pieces.toNumber());
    return { ...r, ...countResults(entries), food: [...food].map(([itemId, qty]) => ({ itemId, qty })) };
  });
}

/** รอบ 1 รอบพร้อมผลการกินรายตัว (แก้ย้อนหลัง) — เรียงตามด้าน/แถว/ช่อง */
export async function getRound(user: AuthUser, id: number) {
  const r = assertOwned(
    await prisma.feedingRound.findUnique({
      where: { id },
      include: {
        entries: {
          select: {
            crabId: true,
            boxId: true,
            itemId: true,
            pieces: true,
            result: true,
            crab: { select: { name: true, box: { select: { code: true, side: true, row: true, col: true } } } },
          },
        },
      },
    }),
    user,
    'รอบให้อาหารนี้',
  );
  const entries = r.entries
    .map((e) => ({
      crabId: e.crabId,
      boxId: e.boxId,
      itemId: e.itemId,
      pieces: e.pieces.toNumber(),
      result: e.result,
      crabName: e.crab.name,
      boxCode: e.crab.box?.code ?? null,
      side: e.crab.box?.side ?? null,
      _k: e.crab.box ? `${e.crab.box.side === 'FRONT' ? 0 : 1}:${String(e.crab.box.row).padStart(3, '0')}:${String(e.crab.box.col).padStart(3, '0')}` : '9',
    }))
    .sort((a, b) => a._k.localeCompare(b._k))
    .map(({ _k, ...e }) => e);
  return {
    id: r.id,
    systemId: r.systemId,
    feedDate: r.feedDate,
    dueAt: r.dueAt,
    status: r.status,
    fedAt: r.fedAt,
    closedAt: r.closedAt,
    autoClosed: r.autoClosed,
    reviewPending: r.reviewPending,
    entries,
  };
}

// ── ทำ ────────────────────────────────────────────────────────────────

/** "เริ่มให้อาหาร" ก่อนเวลา (หรือวันที่ไม่อยู่ในแผน) — รอบของวันนี้ */
export async function startRound(user: AuthUser, systemId: number, now = new Date()) {
  await ownedSystem(user, systemId);
  await ensureFeedItems(user.id);
  const date = ymdLocal(now);
  const existing = await prisma.feedingRound.findUnique({ where: { systemId_feedDate: { systemId, feedDate: date } } });
  if (existing) {
    if (existing.status !== 'OPEN') throw badRequest('วันนี้ปิดรอบให้อาหารไปแล้ว');
    return existing.id;
  }
  const plan = await prisma.feedingPlan.findUnique({ where: { systemId }, include: { days: { where: { date }, select: { date: true, skip: true, itemId: true } } } });
  let itemId: number | null = null;
  let pieces = 1;
  if (plan) {
    itemId = dayPlan(plan, overridesOf(plan.days), now).itemId;
    pieces = plan.piecesPerCrab.toNumber();
  } else {
    itemId = (await prisma.feedItem.findFirst({ where: { ownerId: user.id, active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }))?.id ?? null;
  }
  // รอบเก่าที่ยังเปิดอยู่ = ลืมปิด → ปิดให้แบบเดียวกับตอนถึงเวลา
  const stale = await prisma.feedingRound.findMany({ where: { systemId, status: 'OPEN' }, select: { id: true } });
  for (const r of stale) await closeRoundRow(r.id, { auto: true, now });
  const id = await createRound(user.id, systemId, date, now, itemId, pieces);
  if (!id) throw badRequest('มีรอบของวันนี้แล้ว');
  publishFeeding(systemId);
  return id;
}

/** "ให้อาหารแล้ว" — แจ้งเตือนให้อาหารปิดเอง ต่อจากนี้เป็นช่วงเก็บเศษ/บันทึกการกิน */
export async function markFed(user: AuthUser, id: number) {
  const round = await ownedRound(user, id);
  if (round.status !== 'OPEN') throw badRequest('รอบนี้ปิดไปแล้ว');
  await prisma.feedingRound.updateMany({ where: { id, fedAt: null }, data: { fedAt: new Date() } });
  publishFeeding(round.systemId);
}

/** ปิดรอบที่เปิดอยู่ของระบบ (ใช้ตอนกด "เสร็จแล้ว" ที่งานแจ้งเตือน "ให้อาหารปู") — คืน false ถ้าไม่มีรอบ */
export async function markFedForSystem(systemId: number) {
  const r = await prisma.feedingRound.updateMany({ where: { systemId, status: 'OPEN', fedAt: null }, data: { fedAt: new Date() } });
  if (r.count) publishFeeding(systemId);
  return r.count > 0;
}

/** "เสร็จแล้ว ✓" — ปิดรอบ + ตัดสต็อก */
export async function closeRound(user: AuthUser, id: number) {
  const round = await ownedRound(user, id);
  if (round.status !== 'OPEN') throw badRequest('รอบนี้ปิดไปแล้ว');
  const ok = await closeRoundRow(id, { auto: false, now: new Date() });
  if (!ok) throw badRequest('รอบนี้ปิดไปแล้ว');
}

/** ตอบการ์ด "ปิดให้แล้ว": ok = ถูกต้อง · not_fed = วันนั้นไม่ได้ให้อาหาร (คืนสต็อก + ลบผลการกิน) */
export async function reviewRound(user: AuthUser, id: number, action: 'ok' | 'not_fed') {
  const round = await ownedRound(user, id);
  if (action === 'ok') {
    await prisma.feedingRound.update({ where: { id }, data: { reviewPending: false } });
  } else {
    if (round.status === 'OPEN') throw badRequest('รอบนี้ยังเปิดอยู่');
    await prisma.$transaction(async (tx) => {
      await tx.feedingRound.update({ where: { id }, data: { status: 'SKIPPED', reviewPending: false, fedAt: null } });
      await applyRoundStock(tx, id); // คืนสต็อก
      await tx.feedingEntry.deleteMany({ where: { roundId: id } });
    }, TX_OPTS);
  }
  publishFeeding(round.systemId);
}

/**
 * แก้ผลการกิน/อาหารของหลายตัวพร้อมกัน — ใช้ทั้งรอบที่เปิดอยู่ และแก้ย้อนหลัง (รอบที่ปิดแล้ว ≤ 30 วัน)
 *  - { crabIds, result }        แตะกล่องที่ไม่กิน/กินน้อย (ปูที่ไม่มีแถว เช่นเพิ่งรับเข้า = สร้างให้)
 *  - { crabIds, itemId, pieces } แบ่งกล่องให้คนละอาหาร
 *  - { fromItemId, itemId }     ของไม่พอ → เปลี่ยนอาหารทั้งรอบ ("ให้ปลาแทน")
 */
export async function updateEntries(
  user: AuthUser,
  id: number,
  input: { crabIds?: number[]; result?: EatResult; itemId?: number | null; pieces?: number; fromItemId?: number },
) {
  const round = await ownedRound(user, id);
  if (round.status === 'SKIPPED') throw badRequest('รอบนี้บันทึกว่าไม่ได้ให้อาหาร');
  if (round.status === 'DONE' && round.closedAt && +new Date() - +round.closedAt > 30 * 86_400_000) throw badRequest('แก้ย้อนหลังได้ไม่เกิน 30 วัน');
  if (input.itemId) {
    const ok = await prisma.feedItem.count({ where: { id: input.itemId, ownerId: user.id } });
    if (!ok) throw badRequest('ไม่พบอาหารที่เลือก');
  }
  if (input.pieces != null && !(input.pieces >= 0 && input.pieces <= 20)) throw badRequest('จำนวนชิ้นไม่ถูกต้อง');
  const data: Prisma.FeedingEntryUncheckedUpdateManyInput = {};
  if (input.result) data.result = input.result;
  if (input.itemId !== undefined) data.itemId = input.itemId;
  if (input.pieces != null) data.pieces = input.pieces;
  if (!Object.keys(data).length) throw badRequest('ไม่มีอะไรให้แก้');

  await prisma.$transaction(async (tx) => {
    if (input.fromItemId) {
      await tx.feedingEntry.updateMany({ where: { roundId: id, itemId: input.fromItemId }, data });
    } else {
      const crabIds = [...new Set(input.crabIds ?? [])];
      if (!crabIds.length) throw badRequest('เลือกปูก่อน');
      // ปูที่ยังไม่มีแถวในรอบนี้ (รับเข้าระหว่างรอบ) → สร้างแถวตามอาหารส่วนใหญ่ของรอบ
      const have = new Set((await tx.feedingEntry.findMany({ where: { roundId: id, crabId: { in: crabIds } }, select: { crabId: true } })).map((e) => e.crabId));
      const missing = crabIds.filter((c) => !have.has(c));
      if (missing.length) {
        const crabs = await tx.crab.findMany({ where: { id: { in: missing }, systemId: round.systemId, ownerId: user.id, deletedAt: null }, select: { id: true, boxId: true } });
        if (crabs.length !== missing.length) throw badRequest('ไม่พบปูบางตัวในระบบนี้');
        const common = await tx.feedingEntry.groupBy({ by: ['itemId', 'pieces'], where: { roundId: id }, _count: { _all: true }, orderBy: { _count: { id: 'desc' } }, take: 1 });
        await tx.feedingEntry.createMany({
          data: crabs.map((c) => ({ roundId: id, crabId: c.id, boxId: c.boxId, itemId: common[0]?.itemId ?? null, pieces: common[0]?.pieces ?? 1 })),
        });
      }
      await tx.feedingEntry.updateMany({ where: { roundId: id, crabId: { in: crabIds } }, data });
    }
    if (round.status === 'DONE') {
      await applyRoundStock(tx, id); // แก้ย้อนหลัง → สต็อกตามจริง
      await tx.feedingRound.update({ where: { id }, data: { reviewPending: false } });
    }
  }, TX_OPTS);
  publishFeeding(round.systemId);
}

/** รอบที่เปิดอยู่ทุกระบบของเจ้าของ (แจ้งเตือน "ให้อาหารปู") */
export function openUnfedRounds(ownerId: number) {
  return prisma.feedingRound.findMany({ where: { ownerId, status: 'OPEN', fedAt: null }, select: { id: true, systemId: true, dueAt: true } });
}
