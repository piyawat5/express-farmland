import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';

// ── โมดูล A: CrabSystem = ระบบน้ำ RAS 1 ชุด ───────────────────────────

export function listSystems() {
  return prisma.crabSystem.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { boxes: true, filterTanks: true, crabs: true } },
    },
  });
}

export async function getSystem(id: number) {
  const system = await prisma.crabSystem.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      boxes: { orderBy: { id: 'asc' } },
      filterTanks: { orderBy: { id: 'asc' } },
      _count: { select: { crabs: true } },
    },
  });
  if (!system) throw notFound('ไม่พบระบบปูนี้');
  return system;
}

export function createSystem(data: Prisma.CrabSystemUncheckedCreateInput) {
  return prisma.crabSystem.create({ data });
}

export async function updateSystem(id: number, data: Prisma.CrabSystemUncheckedUpdateInput) {
  await getSystem(id); // โยน 404 ถ้าไม่มี
  return prisma.crabSystem.update({ where: { id }, data });
}

export async function deleteSystem(id: number) {
  await getSystem(id);
  await prisma.crabSystem.delete({ where: { id } });
}

// ── CrabBox (1 กล่อง = ปู 1 ตัว) ─────────────────────────────────────

export function listBoxes(systemId: number) {
  return prisma.crabBox.findMany({
    where: { systemId },
    orderBy: { id: 'asc' },
  });
}

export async function createBox(systemId: number, data: Omit<Prisma.CrabBoxUncheckedCreateInput, 'systemId'>) {
  await getSystem(systemId);
  return prisma.crabBox.create({ data: { ...data, systemId } });
}

/**
 * สร้างกล่องเป็นชุด เช่น prefix "A" from 1 to 30 → A1..A30
 * ใช้ตอน seed/ตั้งระบบใหม่ — ข้าม code ที่มีอยู่แล้ว (skipDuplicates)
 */
export async function generateBoxes(
  systemId: number,
  opts: { prefix: string; from: number; to: number; label?: string },
) {
  await getSystem(systemId);
  const { prefix, from, to, label } = opts;
  const rows = [];
  for (let n = from; n <= to; n++) {
    rows.push({ systemId, code: `${prefix}${n}`, label: label ?? null });
  }
  const result = await prisma.crabBox.createMany({ data: rows, skipDuplicates: true });
  return { requested: rows.length, created: result.count };
}

export async function updateBox(id: number, data: Prisma.CrabBoxUncheckedUpdateInput) {
  const box = await prisma.crabBox.findUnique({ where: { id } });
  if (!box) throw notFound('ไม่พบกล่องปูนี้');
  return prisma.crabBox.update({ where: { id }, data });
}

export async function deleteBox(id: number) {
  const box = await prisma.crabBox.findUnique({ where: { id } });
  if (!box) throw notFound('ไม่พบกล่องปูนี้');
  await prisma.crabBox.delete({ where: { id } });
}

// ── FilterTank (ถังกรอง) ─────────────────────────────────────────────

export function listFilterTanks(systemId: number) {
  return prisma.filterTank.findMany({
    where: { systemId },
    orderBy: { id: 'asc' },
  });
}

export async function createFilterTank(
  systemId: number,
  data: Omit<Prisma.FilterTankUncheckedCreateInput, 'systemId'>,
) {
  await getSystem(systemId);
  return prisma.filterTank.create({ data: { ...data, systemId } });
}

export async function updateFilterTank(id: number, data: Prisma.FilterTankUncheckedUpdateInput) {
  const tank = await prisma.filterTank.findUnique({ where: { id } });
  if (!tank) throw notFound('ไม่พบถังกรองนี้');
  return prisma.filterTank.update({ where: { id }, data });
}

export async function deleteFilterTank(id: number) {
  const tank = await prisma.filterTank.findUnique({ where: { id } });
  if (!tank) throw notFound('ไม่พบถังกรองนี้');
  await prisma.filterTank.delete({ where: { id } });
}
