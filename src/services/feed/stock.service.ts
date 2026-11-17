import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import { addDays, startOfLocalDay, ymdLocal } from '../../lib/feedingCycle';
import type { AuthUser } from '../auth.service';
import { ensureFeedItems } from './items';
import { dayPlan, overridesOf } from './plan.service';

// ════════════════════════════════════════════════════════════════════
//  สต็อกอาหาร (ข้อ 4.12.2 · 5.5) — ต่อเจ้าของ ใช้ร่วมทุกระบบ
//  - ไม่บังคับใส่สต็อก: ยังไม่เคยใส่ (stockSet=false) = ไม่ตัดสต็อก ไม่เตือน (แต่ขึ้น ⚠ ชวนใส่)
//  - ปิดรอบให้อาหาร = ตัดสต็อกตามแถวผลการกิน (applyRoundStock — idempotent แก้ย้อนหลังได้)
//  - โชว์ "พออีก N รอบ" จากแผนจริง แทนเกณฑ์ขั้นต่ำที่ต้องตั้งเอง · < 2 รอบ = ใกล้หมด
// ════════════════════════════════════════════════════════════════════

type Tx = Prisma.TransactionClient;
export const LOW_ROUNDS = 2;
const FORECAST_DAYS = 30;

const ITEM_SELECT = {
  id: true,
  name: true,
  emoji: true,
  unit: true,
  qty: true,
  stockSet: true,
  piecesPerKg: true,
  active: true,
  sortOrder: true,
} satisfies Prisma.FeedItemSelect;

export type Forecast = {
  itemId: number;
  /** ใช้ในแผน 30 วันข้างหน้าไหม */
  used: boolean;
  /** พออีกกี่รอบ (นับเฉพาะรอบที่ใช้อาหารนี้) */
  rounds: number;
  /** วันที่จะไม่พอ (null = พอเกิน 30 วัน) */
  runsOutOn: string | null;
  /** ใช้ต่อรอบ (รอบถัดไป) */
  perRound: number;
  low: boolean;
};

/** ความต้องการอาหาร 30 วันข้างหน้า (ทุกระบบ) → พออีกกี่รอบ ต่ออาหาร */
export async function forecast(ownerId: number, now = new Date()): Promise<Map<number, Forecast>> {
  const today = startOfLocalDay(now);
  const fromYmd = ymdLocal(today);
  const [items, plans, openRounds, laterRounds] = await Promise.all([
    prisma.feedItem.findMany({ where: { ownerId, active: true }, select: { id: true, qty: true, stockSet: true } }),
    prisma.feedingPlan.findMany({
      where: { ownerId, active: true },
      select: {
        systemId: true,
        onDays: true,
        offDays: true,
        anchorDate: true,
        timeOfDay: true,
        pattern: true,
        itemId: true,
        altItemId: true,
        piecesPerCrab: true,
        days: { where: { date: { gte: fromYmd } }, select: { date: true, skip: true, itemId: true } },
      },
    }),
    // รอบที่เปิดอยู่ยังไม่ได้ตัดสต็อก → นับเป็นความต้องการก้อนแรก
    prisma.feedingRound.findMany({
      where: { ownerId, status: 'OPEN' },
      select: { systemId: true, feedDate: true, entries: { select: { itemId: true, pieces: true } } },
    }),
    // วันที่มีรอบแล้ว (เปิด/ปิด/ข้าม) ไม่ต้องนับจากแผนซ้ำ
    prisma.feedingRound.findMany({ where: { ownerId, feedDate: { gte: fromYmd } }, select: { systemId: true, feedDate: true } }),
  ]);

  const usage: { date: string; itemId: number; need: number }[] = [];
  for (const r of openRounds) {
    const per = new Map<number, number>();
    for (const e of r.entries) if (e.itemId) per.set(e.itemId, (per.get(e.itemId) ?? 0) + e.pieces.toNumber());
    for (const [itemId, need] of per) usage.push({ date: r.feedDate, itemId, need });
  }
  const hasRound = new Set(laterRounds.map((r) => `${r.systemId}:${r.feedDate}`));
  const counts = plans.length
    ? await prisma.crab.groupBy({
        by: ['systemId'],
        where: { systemId: { in: plans.map((p) => p.systemId) }, status: 'ALIVE', deletedAt: null },
        _count: { _all: true },
      })
    : [];
  const crabsOf = new Map(counts.map((c) => [c.systemId, c._count._all]));
  for (const p of plans) {
    const crabs = crabsOf.get(p.systemId) ?? 0;
    if (!crabs) continue;
    const overrides = overridesOf(p.days);
    const pieces = p.piecesPerCrab.toNumber();
    for (let i = 0; i < FORECAST_DAYS; i++) {
      const day = addDays(today, i);
      const d = dayPlan(p, overrides, day);
      if (!d.feed || d.skip || !d.itemId || hasRound.has(`${p.systemId}:${d.date}`)) continue;
      usage.push({ date: d.date, itemId: d.itemId, need: crabs * pieces });
    }
  }
  usage.sort((a, b) => a.date.localeCompare(b.date));

  const out = new Map<number, Forecast>();
  for (const it of items) {
    const mine = usage.filter((u) => u.itemId === it.id);
    let left = it.qty.toNumber();
    let rounds = 0;
    let runsOutOn: string | null = null;
    for (const u of mine) {
      if (left + 1e-9 >= u.need) {
        left -= u.need;
        rounds++;
      } else {
        runsOutOn = u.date;
        break;
      }
    }
    const used = mine.length > 0;
    out.set(it.id, {
      itemId: it.id,
      used,
      rounds,
      runsOutOn,
      perRound: mine[0]?.need ?? 0,
      low: it.stockSet && used && runsOutOn != null && rounds < LOW_ROUNDS,
    });
  }
  return out;
}

const shapeItem = (it: Prisma.FeedItemGetPayload<{ select: typeof ITEM_SELECT }>, f?: Forecast) => ({
  ...it,
  qty: it.qty.toNumber(),
  piecesPerKg: it.piecesPerKg?.toNumber() ?? null,
  forecast: f ?? null,
});

/** ใส่เป็นกิโล → จำนวนชิ้น (ปัดเป็นจำนวนเต็ม) + จำ "1 กก. กี่ชิ้น" ไว้ที่อาหารนั้น */
export type QtyInput = { qty?: number | null; kg?: number | null; piecesPerKg?: number | null };
function resolveQty(input: QtyInput): { qty: number; kg: number | null; perKg: number | null } {
  if (input.kg != null) {
    if (!(input.piecesPerKg && input.piecesPerKg > 0)) throw badRequest('บอกด้วยว่า 1 กก. ได้ประมาณกี่ชิ้น');
    if (!(input.kg >= 0)) throw badRequest('ใส่จำนวนกิโล');
    return { qty: Math.round(input.kg * input.piecesPerKg), kg: input.kg, perKg: input.piecesPerKg };
  }
  if (input.qty == null) throw badRequest('ใส่จำนวน');
  return { qty: input.qty, kg: null, perKg: null };
}

export async function listItems(user: AuthUser, opts: { includeHidden?: boolean } = {}) {
  await ensureFeedItems(user.id);
  const [items, fc] = await Promise.all([
    prisma.feedItem.findMany({
      where: { ownerId: user.id, ...(opts.includeHidden ? {} : { active: true }) },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: ITEM_SELECT,
    }),
    forecast(user.id),
  ]);
  return items.map((it) => shapeItem(it, fc.get(it.id)));
}

async function ownedItem(user: AuthUser, id: number) {
  return assertOwned(await prisma.feedItem.findUnique({ where: { id } }), user, 'อาหารนี้');
}

export async function createItem(user: AuthUser, input: { name: string; emoji?: string | null; unit?: string }) {
  const name = input.name.trim();
  const dup = await prisma.feedItem.findUnique({ where: { ownerId_name: { ownerId: user.id, name } } });
  if (dup?.active) throw badRequest('มีอาหารชื่อนี้แล้ว');
  if (dup) {
    // เคยลบไปแล้ว → เอากลับมา
    await prisma.feedItem.update({ where: { id: dup.id }, data: { active: true, emoji: input.emoji ?? dup.emoji, unit: input.unit ?? dup.unit } });
    return dup.id;
  }
  const count = await prisma.feedItem.count({ where: { ownerId: user.id } });
  const it = await prisma.feedItem.create({
    data: { ownerId: user.id, name, emoji: input.emoji || null, unit: input.unit?.trim() || 'ชิ้น', sortOrder: count + 1 },
  });
  return it.id;
}

export async function updateItem(user: AuthUser, id: number, input: { name?: string; emoji?: string | null; unit?: string; active?: boolean; piecesPerKg?: number | null }) {
  await ownedItem(user, id);
  if (input.active === false) {
    const inPlan = await prisma.feedingPlan.count({ where: { ownerId: user.id, OR: [{ itemId: id }, { altItemId: id }] } });
    if (inPlan) throw badRequest('อาหารนี้อยู่ในแผนให้อาหาร เปลี่ยนแผนก่อนแล้วค่อยลบ');
  }
  try {
    await prisma.feedItem.update({
      where: { id },
      data: { name: input.name?.trim() || undefined, emoji: input.emoji, unit: input.unit?.trim() || undefined, active: input.active, piecesPerKg: input.piecesPerKg },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw badRequest('มีอาหารชื่อนี้แล้ว');
    throw e;
  }
}

/** + ซื้ออาหาร (ราคาไม่ใส่ก็ได้) · ซื้อเป็นกิโลได้ (kg × piecesPerKg = ชิ้น) */
export async function buy(user: AuthUser, id: number, input: QtyInput & { priceTHB?: number | null; note?: string | null }) {
  const it = await ownedItem(user, id);
  const { qty, kg, perKg } = resolveQty(input);
  if (!(qty > 0)) throw badRequest('ใส่จำนวนที่ซื้อ');
  // ยังไม่เคยใส่สต็อก = เริ่มนับจากที่ซื้อครั้งนี้ (ยอดเดิมไม่มีความหมาย)
  const base = it.stockSet ? undefined : 0;
  await prisma.$transaction([
    prisma.feedStockMove.create({
      data: { ownerId: user.id, itemId: id, kind: 'BUY', qty, kg, priceTHB: input.priceTHB ?? null, note: input.note ?? null },
    }),
    prisma.feedItem.update({
      where: { id },
      data: {
        ...(base === 0 ? { qty } : { qty: { increment: qty } }),
        stockSet: true,
        ...(perKg ? { piecesPerKg: perKg } : {}),
      },
    }),
  ]);
}

/** นับสต็อกใหม่ (มีอยู่จริงเท่านี้ · ชั่งเป็นกิโลได้) — เก็บส่วนต่างเป็นประวัติ */
export async function recount(user: AuthUser, id: number, input: QtyInput) {
  const it = await ownedItem(user, id);
  const { qty, kg, perKg } = resolveQty(input);
  if (!(qty >= 0)) throw badRequest('จำนวนต้องไม่ติดลบ');
  const diff = it.stockSet ? qty - it.qty.toNumber() : qty;
  await prisma.$transaction([
    prisma.feedStockMove.create({
      data: { ownerId: user.id, itemId: id, kind: 'ADJUST', qty: diff, kg, note: kg != null ? `นับใหม่ ≈ ${kg} กก. = ${qty}` : `นับใหม่ = ${qty}` },
    }),
    prisma.feedItem.update({ where: { id }, data: { qty, stockSet: true, ...(perKg ? { piecesPerKg: perKg } : {}) } }),
  ]);
}

export async function listMoves(user: AuthUser, id: number) {
  await ownedItem(user, id);
  const rows = await prisma.feedStockMove.findMany({
    where: { itemId: id },
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    take: 40,
    select: { id: true, kind: true, qty: true, kg: true, priceTHB: true, note: true, at: true, round: { select: { feedDate: true, system: { select: { name: true } } } } },
  });
  return rows.map((m) => ({
    id: m.id,
    kind: m.kind,
    qty: m.qty.toNumber(),
    kg: m.kg?.toNumber() ?? null,
    priceTHB: m.priceTHB?.toNumber() ?? null,
    note: m.note,
    at: m.at,
    round: m.round ? { feedDate: m.round.feedDate, systemName: m.round.system.name } : null,
  }));
}

/**
 * ตัดสต็อกของรอบให้ตรงกับแถวผลการกิน (เรียกซ้ำได้ — แก้ย้อนหลัง / ข้ามรอบ คำนวณส่วนต่างให้)
 * รอบที่ยังเปิด/ข้าม = ไม่ใช้อะไร · อาหารที่ยังไม่เคยใส่สต็อก = ไม่ตัด
 */
export async function applyRoundStock(tx: Tx, roundId: number) {
  const round = await tx.feedingRound.findUnique({
    where: { id: roundId },
    select: { ownerId: true, status: true, closedAt: true, entries: { select: { itemId: true, pieces: true } }, moves: { where: { kind: 'USE' }, select: { itemId: true, qty: true } } },
  });
  if (!round) return;
  const want = new Map<number, number>();
  if (round.status === 'DONE') {
    for (const e of round.entries) if (e.itemId) want.set(e.itemId, (want.get(e.itemId) ?? 0) + e.pieces.toNumber());
  }
  const had = new Map<number, number>();
  for (const m of round.moves) had.set(m.itemId, (had.get(m.itemId) ?? 0) - m.qty.toNumber());
  const ids = [...new Set([...want.keys(), ...had.keys()])];
  if (!ids.length) return;
  const items = await tx.feedItem.findMany({ where: { id: { in: ids } }, select: { id: true, stockSet: true } });
  for (const it of items) {
    const w = it.stockSet ? (want.get(it.id) ?? 0) : 0;
    const h = had.get(it.id) ?? 0;
    if (Math.abs(w - h) < 1e-9) continue;
    await tx.feedStockMove.deleteMany({ where: { roundId, itemId: it.id, kind: 'USE' } });
    if (w > 0) {
      await tx.feedStockMove.create({ data: { ownerId: round.ownerId, itemId: it.id, kind: 'USE', qty: -w, roundId, at: round.closedAt ?? new Date() } });
    }
    await tx.feedItem.update({ where: { id: it.id }, data: { qty: { decrement: w - h } } });
  }
}
