import type { LedgerCategory, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import type { AuthUser } from '../auth.service';
import {
  CATEGORY_GROUP,
  CATEGORY_LABEL,
  electricMonthly,
  monthKey,
  monthStart,
  monthsBetween,
  shareCosts,
  type ElectricDevice,
  type LedgerCat,
  type LedgerGroup,
  type Stay,
} from '../../lib/profit';

// ════════════════════════════════════════════════════════════════════
//  บัญชี (P6)
//  - รายการ = ซื้อปู (ล็อตที่ใส่ราคาแล้ว) + ซื้ออาหาร (ที่ใส่ราคา) + ขายปู (ใบที่ขายแล้ว) — อ่านจากต้นทางสดๆ
//            + รายการที่ลงเอง + ค่าไฟจากตัวช่วย (เก็บใน LedgerEntry)
//  - ตัวช่วยค่าไฟลงให้เดือนละแถวแบบขี้เกียจ (ตอนเปิดหน้าบัญชี) — ไม่ต้องพึ่ง cron
//  - กำไรรายล็อต: ดู src/lib/profit.ts
// ════════════════════════════════════════════════════════════════════

export type LedgerSource = 'LOT' | 'FEED' | 'SALE' | 'MANUAL' | 'ELECTRIC';
export type LedgerRow = {
  /** ไม่ซ้ำทั้งรายการ เช่น "sale:12" "lot:5" "feed:33" "m:7" */
  key: string;
  source: LedgerSource;
  category: LedgerCat;
  group: LedgerGroup;
  amount: number;
  at: Date;
  title: string;
  detail: string | null;
  /** id ต้นทาง (ใบขาย / ล็อต / การซื้ออาหาร / รายการที่ลงเอง) */
  refId: number;
  systemName: string | null;
};

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const ELECTRIC_NOTE = 'ประมาณจากตัวช่วยค่าไฟ';

// ── ตัวช่วยค่าไฟ ──────────────────────────────────────────────────────

/** ลงค่าไฟเดือนที่ยังไม่ได้ลง (ตั้งแต่ startMonth ถึงเดือนนี้) — unique (ownerId, autoMonth) กันลงซ้ำ */
export async function postElectric(ownerId: number, now = new Date()) {
  const setup = await prisma.electricSetup.findUnique({ where: { ownerId } });
  if (!setup?.active) return;
  const months = monthsBetween(setup.startMonth, monthKey(now));
  if (!months.length) return;
  const have = await prisma.ledgerEntry.findMany({ where: { ownerId, autoMonth: { in: months } }, select: { autoMonth: true } });
  const done = new Set(have.map((h) => h.autoMonth));
  const missing = months.filter((m) => !done.has(m));
  if (!missing.length) return;
  const amount = electricMonthly(setup.devices as ElectricDevice[], setup.rate.toNumber());
  await prisma.ledgerEntry.createMany({
    data: missing.map((m) => ({ ownerId, category: 'ELECTRIC' as const, amount, at: monthStart(m), note: ELECTRIC_NOTE, autoMonth: m })),
    skipDuplicates: true,
  });
}

export async function getElectric(user: AuthUser) {
  const s = await prisma.electricSetup.findUnique({ where: { ownerId: user.id } });
  if (!s) return null;
  const devices = s.devices as ElectricDevice[];
  const rate = s.rate.toNumber();
  return { devices, rate, active: s.active, startMonth: s.startMonth, monthly: electricMonthly(devices, rate) };
}

/** บันทึกตัวช่วยค่าไฟ → ยอดเดือนนี้เปลี่ยนตาม (ถ้ายังไม่ได้แก้เอง) · เดือนก่อนๆ ไม่แตะ */
export async function saveElectric(user: AuthUser, input: { devices: ElectricDevice[]; rate: number; active: boolean }) {
  const cur = monthKey(new Date());
  const old = await prisma.electricSetup.findUnique({ where: { ownerId: user.id } });
  // ตั้งครั้งแรก / เปิดกลับมาใหม่ = เริ่มเดือนนี้ (ไม่ย้อนเติมช่วงที่ไม่ได้ใช้)
  const startMonth = !old || (!old.active && input.active) ? cur : old.startMonth;
  const devices = input.devices.map((d) => ({ key: d.key, name: d.name.trim(), watts: d.watts, qty: d.qty, hours: d.hours }));
  const data = { devices: devices as unknown as Prisma.InputJsonValue, rate: input.rate, active: input.active, startMonth };
  await prisma.electricSetup.upsert({ where: { ownerId: user.id }, create: { ownerId: user.id, ...data }, update: data });

  if (input.active) {
    const amount = electricMonthly(devices, input.rate);
    await prisma.ledgerEntry.updateMany({ where: { ownerId: user.id, autoMonth: cur, edited: false, hidden: false }, data: { amount } });
    await postElectric(user.id);
  } else {
    // ปิดตัวช่วย = เอาค่าไฟเดือนนี้ที่ลงให้ออก (เดือนก่อนๆ เป็นประวัติแล้ว ไม่แตะ)
    await prisma.ledgerEntry.deleteMany({ where: { ownerId: user.id, autoMonth: cur, edited: false, hidden: false } });
  }
  return getElectric(user);
}

// ── รายการที่ลงเอง ────────────────────────────────────────────────────

export type EntryInput = { category: LedgerCategory; amount: number; at: Date; note?: string | null };

export async function createEntry(user: AuthUser, input: EntryInput) {
  const e = await prisma.ledgerEntry.create({
    data: { ownerId: user.id, category: input.category, amount: input.amount, at: input.at, note: input.note?.trim() || null },
  });
  return { id: e.id };
}

export async function updateEntry(user: AuthUser, id: number, input: Partial<EntryInput>) {
  const e = assertOwned(await prisma.ledgerEntry.findUnique({ where: { id } }), user, 'รายการนี้');
  if (e.hidden) throw notFound('ไม่พบรายการนี้');
  if (e.autoMonth && input.category && input.category !== 'ELECTRIC') throw badRequest('ค่าไฟจากตัวช่วยเปลี่ยนหมวดไม่ได้');
  await prisma.ledgerEntry.update({
    where: { id },
    data: {
      category: input.category,
      amount: input.amount,
      at: input.at,
      note: input.note === undefined ? undefined : input.note?.trim() || null,
      // ค่าไฟที่ตัวช่วยลงให้ แล้วผู้ใช้แก้เอง (เช่น ใส่ยอดจากบิลจริง) → ตัวช่วยไม่ทับอีก
      ...(e.autoMonth ? { edited: true } : {}),
    },
  });
}

export async function deleteEntry(user: AuthUser, id: number) {
  const e = assertOwned(await prisma.ledgerEntry.findUnique({ where: { id } }), user, 'รายการนี้');
  // ค่าไฟจากตัวช่วย: ซ่อนไว้แทนลบ ไม่งั้นตัวช่วยลงเดือนนั้นให้ใหม่
  if (e.autoMonth) await prisma.ledgerEntry.update({ where: { id }, data: { hidden: true } });
  else await prisma.ledgerEntry.delete({ where: { id } });
}

// ── รายการรวม ─────────────────────────────────────────────────────────

/** รายการบัญชีในช่วง [from, to) เรียงใหม่ → เก่า */
export async function listLedger(user: AuthUser, from: Date, to: Date): Promise<LedgerRow[]> {
  if (to.getTime() - from.getTime() > 400 * 86_400_000) throw badRequest('ดูได้ทีละไม่เกิน 13 เดือน');
  await postElectric(user.id);
  const range = { gte: from, lt: to };
  const [lots, buys, sales, entries] = await Promise.all([
    prisma.crabLot.findMany({
      where: { ownerId: user.id, totalCost: { not: null }, receivedAt: range },
      select: {
        id: true,
        receivedAt: true,
        totalCost: true,
        seller: { select: { name: true } },
        system: { select: { name: true } },
        _count: { select: { crabs: { where: { deletedAt: null } } } },
      },
    }),
    prisma.feedStockMove.findMany({
      where: { ownerId: user.id, kind: 'BUY', priceTHB: { not: null }, at: range },
      select: { id: true, at: true, qty: true, priceTHB: true, note: true, item: { select: { name: true, unit: true } } },
    }),
    prisma.sale.findMany({
      where: { ownerId: user.id, status: 'DONE', soldAt: range },
      select: {
        id: true,
        no: true,
        soldAt: true,
        total: true,
        customer: { select: { name: true } },
        system: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.ledgerEntry.findMany({ where: { ownerId: user.id, hidden: false, at: range } }),
  ]);

  const rows: LedgerRow[] = [
    ...lots.map<LedgerRow>((l) => ({
      key: `lot:${l.id}`,
      source: 'LOT',
      category: 'CRAB',
      group: 'DIRECT',
      amount: l.totalCost!.toNumber(),
      at: l.receivedAt,
      title: `ซื้อปู ${l._count.crabs} ตัว`,
      detail: l.seller ? `จาก${l.seller.name}` : null,
      refId: l.id,
      systemName: l.system.name,
    })),
    ...buys.map<LedgerRow>((b) => ({
      key: `feed:${b.id}`,
      source: 'FEED',
      category: 'FEED',
      group: 'DIRECT',
      amount: b.priceTHB!.toNumber(),
      at: b.at,
      title: `ซื้อ${b.item.name} ${fmtQty(b.qty.toNumber())} ${b.item.unit}`,
      detail: b.note,
      refId: b.id,
      systemName: null,
    })),
    ...sales.map<LedgerRow>((s) => ({
      key: `sale:${s.id}`,
      source: 'SALE',
      category: 'SALE',
      group: 'INCOME',
      amount: s.total.toNumber(),
      at: s.soldAt!,
      title: `ขายปู ${s._count.items} ตัว`,
      detail: [`ใบที่ ${s.no}`, s.customer?.name].filter(Boolean).join(' · '),
      refId: s.id,
      systemName: s.system.name,
    })),
    ...entries.map<LedgerRow>((e) => ({
      key: `m:${e.id}`,
      source: e.autoMonth ? 'ELECTRIC' : 'MANUAL',
      category: e.category,
      group: CATEGORY_GROUP[e.category],
      amount: e.amount.toNumber(),
      at: e.at,
      title: CATEGORY_LABEL[e.category],
      detail: e.note,
      refId: e.id,
      systemName: null,
    })),
  ];
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime() || a.key.localeCompare(b.key));
}

// ── กำไรรายล็อต ───────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function lotProfits(user: AuthUser, now = new Date()) {
  await postElectric(user.id, now);
  const lots = await prisma.crabLot.findMany({
    where: { ownerId: user.id },
    orderBy: { receivedAt: 'desc' },
    select: {
      id: true,
      systemId: true,
      receivedAt: true,
      totalCost: true,
      seller: { select: { name: true } },
      system: { select: { name: true } },
      crabs: {
        where: { deletedAt: null },
        select: { id: true, status: true, soldAt: true, diedAt: true, sale: { select: { status: true } } },
      },
    },
  });
  if (!lots.length) return [];

  const since = monthStart(monthKey(new Date(Math.min(...lots.map((l) => l.receivedAt.getTime())))));
  const [items, buys, entries] = await Promise.all([
    prisma.saleItem.findMany({ where: { sale: { ownerId: user.id, status: 'DONE' } }, select: { crabId: true, price: true } }),
    prisma.feedStockMove.findMany({
      where: { ownerId: user.id, kind: 'BUY', priceTHB: { not: null }, at: { gte: since, lt: now } },
      select: { at: true, priceTHB: true },
    }),
    prisma.ledgerEntry.findMany({
      where: { ownerId: user.id, hidden: false, category: { not: 'INCOME' }, at: { gte: since, lt: now } },
      select: { at: true, amount: true },
    }),
  ]);

  // กองค่าอาหาร/ค่าฟาร์มรายเดือน
  const pool = new Map<string, number>();
  const addPool = (at: Date, amt: number) => pool.set(monthKey(at), (pool.get(monthKey(at)) ?? 0) + amt);
  buys.forEach((b) => addPool(b.at, b.priceTHB!.toNumber()));
  entries.forEach((e) => addPool(e.at, e.amount.toNumber()));

  // ช่วงที่ปูแต่ละตัวอยู่ในฟาร์ม
  const stays: Stay[] = [];
  for (const l of lots) {
    for (const c of l.crabs) {
      const end = c.status === 'SOLD' ? c.soldAt : c.status === 'DEAD' ? c.diedAt : null;
      const to = end && end.getTime() < now.getTime() ? end : now;
      stays.push({ lotId: l.id, from: l.receivedAt, to });
    }
  }
  const shares = shareCosts(stays, pool);

  const priceByCrab = new Map(items.map((i) => [i.crabId, i.price.toNumber()]));
  return lots.map((l) => {
    const revenue = round2(l.crabs.reduce((s, c) => s + (c.status === 'SOLD' ? (priceByCrab.get(c.id) ?? 0) : 0), 0));
    const cost = l.totalCost?.toNumber() ?? null;
    const shared = Math.round(shares.get(l.id) ?? 0);
    const alive = l.crabs.filter((c) => c.status === 'ALIVE').length;
    return {
      lotId: l.id,
      systemId: l.systemId,
      systemName: l.system.name,
      receivedAt: l.receivedAt,
      seller: l.seller?.name ?? null,
      crabs: l.crabs.length,
      sold: l.crabs.filter((c) => c.status === 'SOLD').length,
      dead: l.crabs.filter((c) => c.status === 'DEAD').length,
      alive,
      reserved: l.crabs.filter((c) => c.status === 'ALIVE' && c.sale?.status === 'RESERVED').length,
      cost,
      costMissing: cost == null,
      revenue,
      /** ส่วนแบ่งค่าอาหาร + ค่าฟาร์ม (ประมาณ) */
      shared,
      profit: round2(revenue - (cost ?? 0) - shared),
      /** ขาย/ตายหมดแล้ว = ตัวเลขสุดท้าย · ยังเหลือ = กำไรถึงวันนี้ */
      finished: alive === 0,
    };
  });
}
