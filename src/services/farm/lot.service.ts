import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import type { AuthUser } from '../auth.service';

// ════════════════════════════════════════════════════════════════════
//  ล็อตปู — ปูทุกตัวต้องอยู่ในล็อต · ราคาใส่ทีหลังได้ (ขึ้น ⚠ จนกว่าจะใส่)
//  ใส่ราคาเมื่อไร → แบ่งต้นทุนให้ปูทุกตัวในล็อตตามน้ำหนักตอนรับเข้า (เศษสตางค์ยกให้ตัวสุดท้าย)
// ════════════════════════════════════════════════════════════════════

type Tx = Prisma.TransactionClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * แบ่งยอดตามน้ำหนัก → ผลรวมเท่ายอดเป๊ะ (เศษยกให้ตัวสุดท้าย)
 * ถ้ามีตัวไหนไม่มีน้ำหนัก → แบ่งเท่ากันทุกตัว (ยุติธรรมกว่าเดา)
 */
export function splitByWeight(total: number, weights: (number | null)[]): number[] {
  const n = weights.length;
  if (!n) return [];
  const useWeight = weights.every((w) => w != null && w > 0);
  const basis = useWeight ? (weights as number[]) : weights.map(() => 1);
  const sum = basis.reduce((a, b) => a + b, 0);
  const out = basis.map((w) => round2((total * w) / sum));
  const drift = round2(total - out.reduce((a, b) => a + b, 0));
  out[n - 1] = round2(out[n - 1] + drift);
  return out;
}

/** แบ่งต้นทุนล็อตให้ปูใหม่ทุกครั้งที่ราคา/สมาชิกล็อตเปลี่ยน (ปูขาย/ตายแล้วยังนับ เพราะต้นทุนจ่ายไปแล้ว) */
export async function allocateLotCost(tx: Tx, lotId: number) {
  const lot = await tx.crabLot.findUnique({ where: { id: lotId }, select: { totalCost: true } });
  const crabs = await tx.crab.findMany({
    where: { lotId, deletedAt: null },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      lastWeightG: true,
      // น้ำหนักตอนรับเข้า = การเช็คครั้งแรก (นิ่งกว่าน้ำหนักล่าสุดที่ขึ้นลงตามการเลี้ยง)
      checks: { where: { weightG: { not: null } }, orderBy: { checkedAt: 'asc' }, take: 1, select: { weightG: true } },
    },
  });
  if (!lot || lot.totalCost == null) {
    await tx.crab.updateMany({ where: { lotId }, data: { allocatedCost: null } });
    return;
  }
  if (!crabs.length) return;
  const weights = crabs.map((c) => c.checks[0]?.weightG?.toNumber() ?? c.lastWeightG?.toNumber() ?? null);
  const shares = splitByWeight(lot.totalCost.toNumber(), weights);
  // คำสั่งเดียวทั้งล็อต (ทีละตัว = ล็อต 100 ตัวยิง 100 คำสั่งทุกครั้งที่รับปูเพิ่ม — DB อยู่ไกล ช้ามาก)
  const cases = Prisma.join(
    crabs.map((c, i) => Prisma.sql`WHEN ${c.id} THEN ${shares[i]}`),
    ' ',
  );
  await tx.$executeRaw`UPDATE \`Crab\` SET \`allocatedCost\` = CASE \`id\` ${cases} END WHERE \`id\` IN (${Prisma.join(crabs.map((c) => c.id))})`;
}

/** transaction ที่มีการแบ่งต้นทุนล็อต — DB remote ช้า ค่าเริ่มต้น 5 วิไม่พอ */
export const TX_OPTS = { timeout: 20_000, maxWait: 10_000 };

const LOT_SELECT = {
  id: true,
  systemId: true,
  receivedAt: true,
  totalCost: true,
  costEnteredAt: true,
  note: true,
  createdAt: true,
  seller: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.CrabLotSelect;

export async function listLots(user: AuthUser, filter: { systemId?: number; costMissing?: boolean }) {
  const lots = await prisma.crabLot.findMany({
    where: {
      ownerId: user.id,
      ...(filter.systemId ? { systemId: filter.systemId } : {}),
      ...(filter.costMissing ? { totalCost: null } : {}),
    },
    orderBy: { receivedAt: 'desc' },
    select: { ...LOT_SELECT, crabs: { where: { deletedAt: null }, select: { status: true } } },
  });
  return lots.map(({ crabs, ...l }) => ({
    ...l,
    crabCount: crabs.length,
    aliveCount: crabs.filter((c) => c.status === 'ALIVE').length,
    soldCount: crabs.filter((c) => c.status === 'SOLD').length,
    deadCount: crabs.filter((c) => c.status === 'DEAD').length,
  }));
}

export async function getLot(user: AuthUser, id: number) {
  const lot = assertOwned(
    await prisma.crabLot.findUnique({
      where: { id },
      select: {
        ...LOT_SELECT,
        ownerId: true,
        crabs: {
          where: { deletedAt: null },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            name: true,
            type: true,
            status: true,
            lastWeightG: true,
            lastPct: true,
            allocatedCost: true,
            box: { select: { code: true, side: true } },
          },
        },
      },
    }),
    user,
    'ล็อตนี้',
  );
  const { ownerId: _o, ...rest } = lot;
  return rest;
}

export type LotInput = {
  systemId: number;
  sellerId?: number | null;
  receivedAt?: Date;
  totalCost?: number | null;
  note?: string | null;
};

async function assertSellerOwned(user: AuthUser, sellerId: number | null | undefined) {
  if (sellerId == null) return;
  assertOwned(await prisma.contact.findUnique({ where: { id: sellerId } }), user, 'คนขายนี้');
}

export async function createLot(user: AuthUser, input: LotInput) {
  assertOwned(await prisma.crabSystem.findUnique({ where: { id: input.systemId } }), user, 'ระบบปูนี้');
  await assertSellerOwned(user, input.sellerId);
  if (input.totalCost != null && input.totalCost < 0) throw badRequest('ราคาต้องไม่ติดลบ');
  return prisma.crabLot.create({
    data: {
      ownerId: user.id,
      systemId: input.systemId,
      sellerId: input.sellerId ?? null,
      receivedAt: input.receivedAt ?? new Date(),
      totalCost: input.totalCost ?? null,
      costEnteredAt: input.totalCost != null ? new Date() : null,
      note: input.note ?? null,
    },
    select: LOT_SELECT,
  });
}

export async function updateLot(user: AuthUser, id: number, input: Partial<Omit<LotInput, 'systemId'>>) {
  const lot = assertOwned(await prisma.crabLot.findUnique({ where: { id } }), user, 'ล็อตนี้');
  await assertSellerOwned(user, input.sellerId);
  if (input.totalCost != null && input.totalCost < 0) throw badRequest('ราคาต้องไม่ติดลบ');
  const costChanged = input.totalCost !== undefined && (input.totalCost ?? null) !== (lot.totalCost?.toNumber() ?? null);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.crabLot.update({
      where: { id },
      data: {
        sellerId: input.sellerId,
        receivedAt: input.receivedAt,
        note: input.note,
        ...(costChanged
          ? { totalCost: input.totalCost ?? null, costEnteredAt: input.totalCost != null ? new Date() : null }
          : {}),
      },
      select: LOT_SELECT,
    });
    if (costChanged) await allocateLotCost(tx, id);
    return updated;
  }, TX_OPTS);
}

/** ลบล็อตได้เฉพาะล็อตที่ไม่มีปูแล้ว (เช่น สร้างผิด) */
export async function deleteLot(user: AuthUser, id: number) {
  assertOwned(await prisma.crabLot.findUnique({ where: { id } }), user, 'ล็อตนี้');
  const crabs = await prisma.crab.count({ where: { lotId: id, deletedAt: null } });
  if (crabs) throw badRequest('ล็อตนี้มีปูอยู่ ลบไม่ได้');
  await prisma.$transaction([
    prisma.crab.deleteMany({ where: { lotId: id } }), // ปูที่ถูกลบ (บันทึกผิด) ของล็อตนี้
    prisma.crabLot.delete({ where: { id } }),
  ]);
}
