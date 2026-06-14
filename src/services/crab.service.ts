import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound, badRequest } from '../lib/http';

// ── โมดูล B: Crab = ปู 1 ตัว (1 กล่อง = 1 ตัว) ────────────────────────

type CrabFilter = {
  systemId?: number;
  status?: Prisma.EnumCrabStatusFilter['equals'];
  type?: Prisma.EnumCrabTypeFilter['equals'];
};

export function listCrabs(filter: CrabFilter) {
  return prisma.crab.findMany({
    where: {
      systemId: filter.systemId,
      status: filter.status,
      type: filter.type,
    },
    orderBy: { id: 'asc' },
    include: {
      box: { select: { id: true, code: true } },
    },
  });
}

export async function getCrab(id: number) {
  const crab = await prisma.crab.findUnique({
    where: { id },
    include: {
      box: { select: { id: true, code: true } },
      system: { select: { id: true, name: true } },
      feedings: { orderBy: { fedAt: 'desc' }, take: 20 },
      firmnessLogs: { orderBy: { checkedAt: 'desc' }, take: 20 },
    },
  });
  if (!crab) throw notFound('ไม่พบปูตัวนี้');
  return crab;
}

/** ตรวจว่ากล่องอยู่ในระบบเดียวกัน + ยังว่าง (กันปู 2 ตัวในกล่องเดียว) */
async function assertBoxAvailable(tx: Prisma.TransactionClient, systemId: number, boxId: number, exceptCrabId?: number) {
  const box = await tx.crabBox.findUnique({ where: { id: boxId } });
  if (!box) throw notFound('ไม่พบกล่องที่ระบุ');
  if (box.systemId !== systemId) throw badRequest('กล่องนี้ไม่ได้อยู่ในระบบเดียวกับปู');
  const occupant = await tx.crab.findFirst({
    where: {
      boxId,
      id: exceptCrabId ? { not: exceptCrabId } : undefined,
      status: { in: ['FATTENING', 'READY'] }, // ปูที่ยังอยู่จริง
    },
  });
  if (occupant) throw badRequest(`กล่องนี้มีปู (id ${occupant.id}) อยู่แล้ว`);
}

export function createCrab(data: Prisma.CrabUncheckedCreateInput) {
  return prisma.$transaction(async (tx) => {
    if (data.boxId != null) {
      await assertBoxAvailable(tx, data.systemId, data.boxId);
    }
    // ถ้าไม่ระบุรหัสปู → default = ชื่อระบบ + รหัสกล่อง (เช่นระบบ "1" กล่อง A1 → "1A1")
    // กัน code ซ้ำข้ามระบบ เพราะนำชื่อระบบมานำหน้า
    if ((data.code == null || data.code === '') && data.boxId != null) {
      const [system, box] = await Promise.all([
        tx.crabSystem.findUnique({ where: { id: data.systemId }, select: { name: true } }),
        tx.crabBox.findUnique({ where: { id: data.boxId }, select: { code: true } }),
      ]);
      if (system && box) data.code = `${system.name}${box.code}`;
    }
    const crab = await tx.crab.create({ data });
    if (crab.boxId != null) {
      await tx.crabBox.update({ where: { id: crab.boxId }, data: { status: 'OCCUPIED' } });
    }
    return crab;
  });
}

export function updateCrab(id: number, data: Prisma.CrabUncheckedUpdateInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.crab.findUnique({ where: { id } });
    if (!current) throw notFound('ไม่พบปูตัวนี้');

    const nextBoxId = data.boxId === undefined ? current.boxId : (data.boxId as number | null);
    const nextStatus = (data.status as string | undefined) ?? current.status;
    const stillLiving = nextStatus === 'FATTENING' || nextStatus === 'READY';

    // ย้ายกล่อง: เช็คกล่องใหม่ว่าง แล้วปล่อยกล่องเก่า
    if (nextBoxId != null && nextBoxId !== current.boxId && stillLiving) {
      await assertBoxAvailable(tx, current.systemId, nextBoxId, id);
    }

    const crab = await tx.crab.update({ where: { id }, data });

    // sync สถานะกล่อง
    if (current.boxId != null && current.boxId !== nextBoxId) {
      await freeBoxIfEmpty(tx, current.boxId);
    }
    if (nextBoxId != null) {
      await tx.crabBox.update({
        where: { id: nextBoxId },
        data: { status: stillLiving ? 'OCCUPIED' : 'EMPTY' },
      });
    }
    return crab;
  });
}

export function deleteCrab(id: number) {
  return prisma.$transaction(async (tx) => {
    const crab = await tx.crab.findUnique({ where: { id } });
    if (!crab) throw notFound('ไม่พบปูตัวนี้');
    await tx.crab.delete({ where: { id } });
    if (crab.boxId != null) await freeBoxIfEmpty(tx, crab.boxId);
  });
}

/** คืนกล่องเป็น EMPTY ถ้าไม่มีปูที่ยังอยู่จริงในกล่องนั้นแล้ว */
async function freeBoxIfEmpty(tx: Prisma.TransactionClient, boxId: number) {
  const living = await tx.crab.count({
    where: { boxId, status: { in: ['FATTENING', 'READY'] } },
  });
  if (living === 0) {
    await tx.crabBox.update({ where: { id: boxId }, data: { status: 'EMPTY' } });
  }
}
