import { Prisma, type SaleStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import type { AuthUser } from '../auth.service';
import { defaultCrabName } from '../farm/crab.service';
import { TX_OPTS } from '../farm/lot.service';

// ════════════════════════════════════════════════════════════════════
//  ขายปู (P6) — ใบขาย/ใบจองจากผังกล่อง
//  - ปูในใบถูกล็อกด้วย Crab.saleId ผ่าน updateMany แบบมีเงื่อนไข (ว่าง + ยังเลี้ยงอยู่) แล้วเช็ค count
//    → 2 เครื่องจองตัวเดียวกันพร้อมกัน เครื่องที่ช้ากว่าได้ 400 (transaction ย้อนกลับทั้งใบ)
//  - จองไว้ = ปูยังอยู่ในกล่อง (ยังให้อาหาร/เช็คตามปกติ) · ขายแล้ว = SOLD ออกจากผัง
//  - ยกเลิก = ปูกลับมาที่กล่องเดิม (ทั้งใบจองและใบที่ขายแล้ว — เผื่อกดผิด/ลูกค้าคืน)
//  - สำเนาชื่อ/กล่อง/น้ำหนัก/%/รูป ณ วันขายไว้ในใบ → ใบเสร็จไม่เปลี่ยนตามทีหลัง
// ════════════════════════════════════════════════════════════════════

type Tx = Prisma.TransactionClient;

export type SaleItemInput = { crabId: number; price: number; pricePerKg?: number | null };
export type CreateSaleInput = {
  systemId: number;
  status: 'RESERVED' | 'DONE';
  customerId?: number | null;
  soldAt?: Date;
  note?: string | null;
  items: SaleItemInput[];
};
export type UpdateSaleInput = {
  customerId?: number | null;
  soldAt?: Date;
  note?: string | null;
  items?: SaleItemInput[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (items: SaleItemInput[]) => round2(items.reduce((s, i) => s + i.price, 0));

function assertItems(items: SaleItemInput[]) {
  if (!items.length) throw badRequest('เลือกปูอย่างน้อย 1 ตัว');
  const ids = new Set(items.map((i) => i.crabId));
  if (ids.size !== items.length) throw badRequest('เลือกปูตัวเดียวกันซ้ำ');
  if (items.some((i) => i.price < 0)) throw badRequest('ราคาต้องไม่ติดลบ');
}

async function assertCustomer(user: AuthUser, customerId: number | null | undefined) {
  if (customerId == null) return;
  assertOwned(await prisma.contact.findUnique({ where: { id: customerId } }), user, 'ลูกค้านี้');
}

/** ปูที่จะใส่ในใบ: ของเรา · ยังไม่ถูกลบ · อยู่ในระบบเดียวกับใบ */
async function loadCrabs(tx: Tx, user: AuthUser, systemId: number, ids: number[]) {
  if (!ids.length) return [];
  const crabs = await tx.crab.findMany({
    where: { id: { in: ids }, ownerId: user.id, deletedAt: null },
    select: {
      id: true,
      systemId: true,
      name: true,
      type: true,
      lastWeightG: true,
      lastPct: true,
      lastPhotoUrl: true,
      box: { select: { side: true, code: true } },
      system: { select: { layout: true } },
    },
  });
  if (crabs.length !== ids.length) throw badRequest('ไม่พบปูบางตัว — โหลดหน้าใหม่แล้วเลือกใหม่');
  if (crabs.some((c) => c.systemId !== systemId)) throw badRequest('ปูในใบเดียวกันต้องอยู่ระบบเดียวกัน');
  return crabs;
}
type LoadedCrab = Awaited<ReturnType<typeof loadCrabs>>[number];

const snapshot = (c: LoadedCrab) => ({
  name: c.name,
  place: c.box ? defaultCrabName(c.system.layout, c.box.side, c.box.code) : '',
  type: c.type,
  weightG: c.lastWeightG,
  pct: c.lastPct,
  photoUrl: c.lastPhotoUrl,
});

/** ล็อกปูให้ใบนี้ — ต้องว่าง (ไม่อยู่ในใบอื่น) และยังเลี้ยงอยู่ ไม่งั้นทั้งใบย้อนกลับ */
async function lockCrabs(tx: Tx, ownerId: number, saleId: number, ids: number[]) {
  if (!ids.length) return;
  const r = await tx.crab.updateMany({
    where: { id: { in: ids }, ownerId, status: 'ALIVE', deletedAt: null, saleId: null },
    data: { saleId },
  });
  if (r.count !== ids.length) {
    throw badRequest('ปูบางตัวถูกจอง/ขายไปแล้ว หรือไม่อยู่ในฟาร์มแล้ว — โหลดหน้าใหม่แล้วเลือกใหม่');
  }
}

/** ปล่อยปูกลับเข้าผัง (ขายแล้ว → ยังเลี้ยงอยู่) */
async function releaseCrabs(tx: Tx, saleId: number, ids?: number[]) {
  await tx.crab.updateMany({
    where: { saleId, ...(ids ? { id: { in: ids } } : {}), status: { in: ['ALIVE', 'SOLD'] } },
    data: { saleId: null, status: 'ALIVE', soldAt: null },
  });
  // ปูที่ตายระหว่างจอง (ไม่ควรเกิด — กันไว้ที่ setCrabDead แล้ว) แค่ปลดล็อก
  await tx.crab.updateMany({ where: { saleId, ...(ids ? { id: { in: ids } } : {}) }, data: { saleId: null } });
}

/** ปูในใบ → ขายแล้ว (ทุกตัวต้องยังเลี้ยงอยู่) */
async function markSold(tx: Tx, saleId: number, ids: number[], soldAt: Date) {
  if (!ids.length) return;
  const r = await tx.crab.updateMany({
    where: { saleId, id: { in: ids }, status: 'ALIVE', deletedAt: null },
    data: { status: 'SOLD', soldAt },
  });
  if (r.count !== ids.length) throw badRequest('ปูบางตัวในใบนี้ตายหรือถูกลบไปแล้ว — เอาออกจากใบก่อน');
}

async function nextNo(tx: Tx, ownerId: number) {
  const last = await tx.sale.aggregate({ where: { ownerId }, _max: { no: true } });
  return (last._max.no ?? 0) + 1;
}

/** เลขที่ใบชนกัน (2 เครื่องขายพร้อมกัน) → ลองใหม่ */
async function retryOnNoClash<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const clash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
      if (!clash || i >= tries - 1) throw e;
    }
  }
}

export async function createSale(user: AuthUser, input: CreateSaleInput) {
  assertOwned(await prisma.crabSystem.findUnique({ where: { id: input.systemId } }), user, 'ระบบปูนี้');
  assertItems(input.items);
  if (input.status === 'RESERVED' && !input.customerId) throw badRequest('จองไว้ให้ใคร? เลือกลูกค้าก่อน');
  await assertCustomer(user, input.customerId);
  const ids = input.items.map((i) => i.crabId);
  const now = new Date();
  const soldAt = input.status === 'DONE' ? (input.soldAt ?? now) : null;

  const saleId = await retryOnNoClash(() =>
    prisma.$transaction(async (tx) => {
      const crabs = await loadCrabs(tx, user, input.systemId, ids);
      const byId = new Map(crabs.map((c) => [c.id, c]));
      const sale = await tx.sale.create({
        data: {
          ownerId: user.id,
          systemId: input.systemId,
          no: await nextNo(tx, user.id),
          status: input.status,
          customerId: input.customerId ?? null,
          total: sum(input.items),
          reservedAt: input.status === 'RESERVED' ? now : null,
          soldAt,
          note: input.note?.trim() || null,
        },
      });
      await lockCrabs(tx, user.id, sale.id, ids);
      if (soldAt) await markSold(tx, sale.id, ids, soldAt);
      await tx.saleItem.createMany({
        data: input.items.map((i) => ({
          saleId: sale.id,
          crabId: i.crabId,
          price: i.price,
          pricePerKg: i.pricePerKg ?? null,
          ...snapshot(byId.get(i.crabId)!),
        })),
      });
      return sale.id;
    }, TX_OPTS),
  );
  return getSale(user, saleId);
}

async function loadOwnedSale(user: AuthUser, id: number) {
  return assertOwned(
    await prisma.sale.findUnique({ where: { id }, include: { items: { select: { id: true, crabId: true } } } }),
    user,
    'ใบขายนี้',
  );
}

/** แก้ใบ: ลูกค้า · วันที่ขาย · โน้ต · รายการปู (ส่งมาทั้งชุด — ตัวที่หายไป = ปล่อยกลับเข้าผัง) */
export async function updateSale(user: AuthUser, id: number, input: UpdateSaleInput) {
  const sale = await loadOwnedSale(user, id);
  if (sale.status === 'CANCELLED') throw badRequest('ใบนี้ยกเลิกไปแล้ว แก้ไม่ได้');
  if (input.customerId !== undefined) {
    await assertCustomer(user, input.customerId);
    if (sale.status === 'RESERVED' && !input.customerId) throw badRequest('ใบจองต้องมีลูกค้า');
  }
  if (input.items) assertItems(input.items);

  await prisma.$transaction(async (tx) => {
    const soldAt = sale.status === 'DONE' ? (input.soldAt ?? sale.soldAt!) : null;
    if (input.items) {
      const oldIds = new Set(sale.items.map((i) => i.crabId));
      const newIds = new Set(input.items.map((i) => i.crabId));
      const removed = [...oldIds].filter((c) => !newIds.has(c));
      const added = [...newIds].filter((c) => !oldIds.has(c));
      if (removed.length) {
        await releaseCrabs(tx, id, removed);
        await tx.saleItem.deleteMany({ where: { saleId: id, crabId: { in: removed } } });
      }
      const crabs = await loadCrabs(tx, user, sale.systemId, added);
      const byId = new Map(crabs.map((c) => [c.id, c]));
      await lockCrabs(tx, user.id, id, added);
      if (soldAt) await markSold(tx, id, added, soldAt);
      for (const it of input.items) {
        if (byId.has(it.crabId)) {
          await tx.saleItem.create({
            data: { saleId: id, crabId: it.crabId, price: it.price, pricePerKg: it.pricePerKg ?? null, ...snapshot(byId.get(it.crabId)!) },
          });
        } else {
          await tx.saleItem.update({
            where: { saleId_crabId: { saleId: id, crabId: it.crabId } },
            data: { price: it.price, pricePerKg: it.pricePerKg ?? null },
          });
        }
      }
    }
    if (input.soldAt && sale.status === 'DONE') {
      await tx.crab.updateMany({ where: { saleId: id, status: 'SOLD' }, data: { soldAt: input.soldAt } });
    }
    await tx.sale.update({
      where: { id },
      data: {
        customerId: input.customerId,
        note: input.note === undefined ? undefined : input.note?.trim() || null,
        ...(input.items ? { total: sum(input.items) } : {}),
        ...(sale.status === 'DONE' && input.soldAt ? { soldAt: input.soldAt } : {}),
      },
    });
  }, TX_OPTS);
  return getSale(user, id);
}

/** ใบจอง → ขายแล้ว (สำเนาน้ำหนัก/%/รูปล่าสุดใหม่ เผื่อเช็คปูหลังวันจอง) */
export async function markDone(user: AuthUser, id: number, soldAt?: Date) {
  const sale = await loadOwnedSale(user, id);
  const at = soldAt ?? new Date();
  await prisma.$transaction(async (tx) => {
    const r = await tx.sale.updateMany({ where: { id, status: 'RESERVED' }, data: { status: 'DONE', soldAt: at } });
    if (r.count !== 1) throw badRequest(sale.status === 'DONE' ? 'ใบนี้ขายไปแล้ว' : 'ใบนี้ยกเลิกไปแล้ว');
    const ids = sale.items.map((i) => i.crabId);
    await markSold(tx, id, ids, at);
    const crabs = await loadCrabs(tx, user, sale.systemId, ids);
    for (const c of crabs) {
      await tx.saleItem.update({ where: { saleId_crabId: { saleId: id, crabId: c.id } }, data: snapshot(c) });
    }
  }, TX_OPTS);
  return getSale(user, id);
}

/** ยกเลิกใบ (จอง/ขายแล้ว) → ปูกลับเข้าผังที่กล่องเดิม */
export async function cancelSale(user: AuthUser, id: number) {
  await loadOwnedSale(user, id);
  await prisma.$transaction(async (tx) => {
    const r = await tx.sale.updateMany({
      where: { id, status: { in: ['RESERVED', 'DONE'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (r.count !== 1) throw badRequest('ใบนี้ยกเลิกไปแล้ว');
    await releaseCrabs(tx, id);
  }, TX_OPTS);
  return getSale(user, id);
}

// ── อ่าน ──────────────────────────────────────────────────────────────

const num = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());

export async function getSale(user: AuthUser, id: number) {
  const sale = assertOwned(
    await prisma.sale.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        system: { select: { id: true, name: true } },
        items: {
          orderBy: { id: 'asc' },
          include: {
            crab: {
              select: {
                allocatedCost: true,
                status: true,
                lot: { select: { id: true, receivedAt: true, totalCost: true } },
              },
            },
          },
        },
      },
    }),
    user,
    'ใบขายนี้',
  );
  return {
    id: sale.id,
    no: sale.no,
    status: sale.status,
    system: sale.system,
    customer: sale.customer,
    total: sale.total.toNumber(),
    reservedAt: sale.reservedAt,
    soldAt: sale.soldAt,
    cancelledAt: sale.cancelledAt,
    note: sale.note,
    createdAt: sale.createdAt,
    items: sale.items.map((i) => ({
      id: i.id,
      crabId: i.crabId,
      price: i.price.toNumber(),
      pricePerKg: num(i.pricePerKg),
      name: i.name,
      place: i.place,
      type: i.type,
      weightG: num(i.weightG),
      pct: i.pct,
      photoUrl: i.photoUrl,
      /** ต้นทุนปูตัวนี้ (แบ่งจากราคาล็อต) — null = ล็อตยังไม่ใส่ราคา */
      cost: num(i.crab.allocatedCost),
      crabStatus: i.crab.status,
      lot: { id: i.crab.lot.id, receivedAt: i.crab.lot.receivedAt, costMissing: i.crab.lot.totalCost == null },
    })),
  };
}

/**
 * รายการใบขาย: ใบจองทั้งหมด (ยังค้างอยู่) + ใบที่ขาย/ยกเลิกในช่วงวันที่
 * (from/to = เวลาเริ่ม/สิ้นสุดของช่วง ไม่ส่ง = 90 วันล่าสุด)
 */
export async function listSales(user: AuthUser, q: { from?: Date; to?: Date; status?: SaleStatus }) {
  const to = q.to ?? new Date();
  const from = q.from ?? new Date(to.getTime() - 90 * 86_400_000);
  const range = { gte: from, lt: to };
  const sales = await prisma.sale.findMany({
    where: {
      ownerId: user.id,
      ...(q.status ? { status: q.status } : {}),
      OR: [{ status: 'RESERVED' }, { status: 'DONE', soldAt: range }, { status: 'CANCELLED', cancelledAt: range }],
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 300,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      system: { select: { id: true, name: true } },
      items: { orderBy: { id: 'asc' }, select: { weightG: true, photoUrl: true, type: true } },
    },
  });
  return sales.map((s) => ({
    id: s.id,
    no: s.no,
    status: s.status,
    system: s.system,
    customer: s.customer,
    total: s.total.toNumber(),
    count: s.items.length,
    weightG: round2(s.items.reduce((a, i) => a + (i.weightG?.toNumber() ?? 0), 0)),
    photos: s.items.filter((i) => i.photoUrl).slice(0, 4).map((i) => i.photoUrl!),
    reservedAt: s.reservedAt,
    soldAt: s.soldAt,
    cancelledAt: s.cancelledAt,
    createdAt: s.createdAt,
  }));
}
