import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound, badRequest } from '../lib/http';
import type { AuthUser } from './auth.service';
import { systemScopeWhere, assertOwnership } from '../lib/scope';

// ── โมดูล B: Crab = ปู 1 ตัว (1 กล่อง = หลายตัวได้ — แยกด้วยเคเบิ้ลไทล์สี, ข้อ 2) ──

type CrabFilter = {
  systemId?: number;
  status?: Prisma.EnumCrabStatusFilter['equals'];
  type?: Prisma.EnumCrabTypeFilter['equals'];
};

export async function listCrabs(user: AuthUser, filter: CrabFilter) {
  const scope = await systemScopeWhere(user, filter.systemId);
  return prisma.crab.findMany({
    where: {
      ...scope, // จำกัดเฉพาะปูในระบบของ user (ADMIN เห็นทั้งหมด)
      status: filter.status,
      type: filter.type,
    },
    orderBy: { id: 'asc' },
    include: {
      box: { select: { id: true, code: true } },
    },
  });
}

export async function getCrab(id: number, user: AuthUser) {
  const crab = await prisma.crab.findUnique({
    where: { id },
    include: {
      box: { select: { id: true, code: true } },
      system: { select: { id: true, name: true, ownerId: true } },
      feedings: { orderBy: { fedAt: 'desc' }, take: 20 },
      firmnessLogs: { orderBy: { checkedAt: 'desc' }, take: 20 },
    },
  });
  if (!crab) throw notFound('ไม่พบปูตัวนี้');
  assertOwnership(user, crab.system.ownerId);
  return crab;
}

/**
 * ตรวจว่ากล่องอยู่ในระบบเดียวกับปู (1 กล่องใส่ปูได้หลายตัว — ไม่กันจำนวนแล้ว, ข้อ 2)
 * แยกตัวด้วย cableTieColor ที่ฝั่ง UI
 */
async function assertBoxInSystem(tx: Prisma.TransactionClient, systemId: number, boxId: number) {
  const box = await tx.crabBox.findUnique({ where: { id: boxId } });
  if (!box) throw notFound('ไม่พบกล่องที่ระบุ');
  if (box.systemId !== systemId) throw badRequest('กล่องนี้ไม่ได้อยู่ในระบบเดียวกับปู');
}

export function createCrab(data: Prisma.CrabUncheckedCreateInput) {
  return prisma.$transaction(async (tx) => {
    if (data.boxId != null) {
      await assertBoxInSystem(tx, data.systemId, data.boxId);
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

    // ย้ายกล่อง: เช็คว่ากล่องใหม่อยู่ระบบเดียวกัน (ไม่กันจำนวนปูต่อกล่องแล้ว)
    if (nextBoxId != null && nextBoxId !== current.boxId && stillLiving) {
      await assertBoxInSystem(tx, current.systemId, nextBoxId);
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
