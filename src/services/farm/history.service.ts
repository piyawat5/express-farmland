import type { CrabType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { assertOwned } from '../../lib/scope';
import type { AuthUser } from '../auth.service';

// ════════════════════════════════════════════════════════════════════
//  ประวัติปู (P7 · ข้อ 4.7, 4.9) — เมนูเดียว 2 แท็บ
//  - "ปูทั้งหมด": แบ่งหน้า (ค่าเริ่มต้น 15) รวมปูที่ขาย / ตาย / ลบ (บันทึกผิด)
//  - "ก่อน-หลัง": ปูที่ยังเลี้ยงอยู่ที่เช็คแล้ว ≥ 2 ครั้ง → รอบแรก · รอบก่อน · รอบล่าสุด
// ════════════════════════════════════════════════════════════════════

/** สถานะในหน้าประวัติ — DELETED = ลบเพราะบันทึกผิด (ปกติซ่อนจากทุกหน้า) */
export type HistoryStatus = 'ALIVE' | 'SOLD' | 'DEAD' | 'DELETED';

export type HistoryQuery = {
  systemId?: number;
  status?: HistoryStatus;
  type?: CrabType;
  /** ค้นชื่อปู / รหัสกล่อง */
  q?: string;
  skip?: number;
  take?: number;
};

function statusWhere(s: HistoryStatus): Prisma.CrabWhereInput {
  return s === 'DELETED' ? { deletedAt: { not: null } } : { status: s, deletedAt: null };
}

export async function crabHistory(user: AuthUser, query: HistoryQuery) {
  if (query.systemId) assertOwned(await prisma.crabSystem.findUnique({ where: { id: query.systemId } }), user, 'ระบบปูนี้');
  const q = query.q?.trim();
  const base: Prisma.CrabWhereInput = {
    ownerId: user.id,
    ...(query.systemId ? { systemId: query.systemId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(q ? { OR: [{ name: { contains: q } }, { box: { code: q.toUpperCase() } }] } : {}),
  };
  const where: Prisma.CrabWhereInput = query.status ? { AND: [base, statusWhere(query.status)] } : base;
  const skip = query.skip ?? 0;
  const take = query.take ?? 15;

  const [rows, total, byStatus, deleted] = await Promise.all([
    prisma.crab.findMany({
      where,
      // ล็อตใหม่สุดก่อน · ในล็อตเดียวกันเรียงตามลำดับที่รับเข้า
      orderBy: [{ lot: { receivedAt: 'desc' } }, { id: 'asc' }],
      skip,
      take,
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        allocatedCost: true,
        lastWeightG: true,
        lastPct: true,
        lastPhotoUrl: true,
        lastCheckedAt: true,
        diedAt: true,
        soldAt: true,
        deletedAt: true,
        systemId: true,
        box: { select: { code: true, side: true } },
        lot: { select: { id: true, receivedAt: true } },
        sale: { select: { id: true, no: true, status: true, customer: { select: { name: true } } } },
        saleItems: { where: { sale: { status: 'DONE' } }, select: { price: true }, take: 1 },
      },
    }),
    prisma.crab.count({ where }),
    prisma.crab.groupBy({ by: ['status'], where: { AND: [base, { deletedAt: null }] }, _count: { _all: true } }),
    prisma.crab.count({ where: { AND: [base, { deletedAt: { not: null } }] } }),
  ]);

  const counts: Record<HistoryStatus, number> = { ALIVE: 0, SOLD: 0, DEAD: 0, DELETED: deleted };
  for (const g of byStatus) counts[g.status] = g._count._all;

  // จำนวนรอบเช็คเฉพาะปูในหน้านี้ (`_count` ของ Prisma นับทั้งตาราง CrabCheck ทุกคน แล้วค่อย join — ข้อมูลโตแล้วช้า)
  const checkCounts = rows.length
    ? await prisma.crabCheck.groupBy({ by: ['crabId'], where: { crabId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
    : [];
  const checksOf = new Map(checkCounts.map((g) => [g.crabId, g._count._all]));

  return {
    total,
    counts,
    items: rows.map(({ deletedAt, status, sale, saleItems, ...c }) => ({
      ...c,
      status: (deletedAt ? 'DELETED' : status) as HistoryStatus,
      deletedAt,
      checks: checksOf.get(c.id) ?? 0,
      /** ใบที่ถือปูตัวนี้อยู่ (จองไว้ / ขายแล้ว) */
      sale: sale ? { id: sale.id, no: sale.no, status: sale.status, customer: sale.customer?.name ?? null } : null,
      /** ขายได้เท่าไร (ใบที่ขายแล้วเท่านั้น) */
      salePrice: saleItems[0]?.price ?? null,
    })),
  };
}

const CHECK_SELECT = { id: true, checkedAt: true, weightG: true, pct: true, photoUrl: true } satisfies Prisma.CrabCheckSelect;

/** แท็บ "ก่อน-หลัง": ปูที่ยังเลี้ยงอยู่ในระบบนี้ที่เช็คแล้ว ≥ 2 ครั้ง (เรียงตามผัง) */
export async function crabCompare(user: AuthUser, systemId: number) {
  assertOwned(await prisma.crabSystem.findUnique({ where: { id: systemId } }), user, 'ระบบปูนี้');
  const crabs = await prisma.crab.findMany({
    where: { ownerId: user.id, systemId, status: 'ALIVE', deletedAt: null },
    select: {
      id: true,
      name: true,
      type: true,
      box: { select: { code: true, side: true, row: true, col: true } },
      lot: { select: { receivedAt: true } },
      checks: { orderBy: [{ checkedAt: 'asc' }, { id: 'asc' }], select: CHECK_SELECT },
    },
  });
  const sideOrder = (s?: string) => (s === 'BACK' ? 1 : 0);
  return crabs
    .filter((c) => c.checks.length >= 2)
    .sort(
      (a, b) =>
        sideOrder(a.box?.side) - sideOrder(b.box?.side) ||
        (a.box?.row ?? 999) - (b.box?.row ?? 999) ||
        (a.box?.col ?? 999) - (b.box?.col ?? 999) ||
        a.id - b.id,
    )
    .map(({ checks, box, lot, ...c }) => ({
      ...c,
      box: box ? { code: box.code, side: box.side } : null,
      lotReceivedAt: lot.receivedAt,
      checks: checks.length,
      first: checks[0],
      prev: checks[checks.length - 2],
      last: checks[checks.length - 1],
    }));
}
