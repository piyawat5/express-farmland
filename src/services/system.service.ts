import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';
import type { AuthUser } from './auth.service';
import { ownerWhere, assertOwnership } from '../lib/scope';

// ── โมดูล A: CrabSystem = ระบบน้ำ RAS 1 ชุด ───────────────────────────

/** field Json ที่ nullable ต้องใช้ Prisma.DbNull แทน null ตรงๆ ไม่งั้น Prisma โยน error */
function normalizeSystemData<T extends { sizeBuckets?: unknown }>(data: T): T {
  if (data.sizeBuckets === null) {
    return { ...data, sizeBuckets: Prisma.DbNull };
  }
  return data;
}

export function listSystems(user: AuthUser) {
  return prisma.crabSystem.findMany({
    where: ownerWhere(user),
    orderBy: { createdAt: 'asc' },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { boxes: true, filterTanks: true, crabs: true } },
    },
  });
}

/** ดึงระบบ — ถ้าส่ง user มาด้วยจะ assert ว่าเป็นเจ้าของ (ADMIN ผ่าน); ไม่ส่ง = ใช้ภายในที่ guard มาแล้ว */
export async function getSystem(id: number, user?: AuthUser) {
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
  if (user) assertOwnership(user, system.ownerId);
  return system;
}

export async function createSystem(data: Prisma.CrabSystemUncheckedCreateInput) {
  // ถ้าไม่ระบุเจ้าของ → ผูกกับ user คนแรกที่ active (single user)
  // สำคัญต่อการแจ้งเตือน: Task ของระบบ resolve ปลายทางอีเมลจาก owner ของระบบ
  let ownerId = data.ownerId ?? null;
  if (ownerId == null) {
    const owner = await prisma.user.findFirst({ where: { active: true }, orderBy: { id: 'asc' } });
    ownerId = owner?.id ?? null;
  }
  return prisma.crabSystem.create({ data: normalizeSystemData({ ...data, ownerId }) });
}

export async function updateSystem(id: number, data: Prisma.CrabSystemUncheckedUpdateInput) {
  await getSystem(id); // โยน 404 ถ้าไม่มี
  return prisma.crabSystem.update({ where: { id }, data: normalizeSystemData(data) });
}

export async function deleteSystem(id: number) {
  await getSystem(id);
  await prisma.crabSystem.delete({ where: { id } });
}

// ── CrabBox (1 กล่อง = ปู 1 ตัว) ─────────────────────────────────────

export async function listBoxes(systemId: number, user: AuthUser) {
  await getSystem(systemId, user); // assert เจ้าของระบบก่อน (กันอ่านกล่องข้ามเจ้าของ)
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

/**
 * สร้างกล่องเป็นตาราง row × column — แถวเป็นตัวอักษร (A,B,C..) คอลัมน์เป็นเลข (1..cols)
 * เช่น rows=6, cols=5 → A1..A5, B1..B5, ... F1..F5 (30 กล่อง)
 * ใช้ตอนสร้างระบบใหม่ — ข้าม code ที่มีอยู่แล้ว (skipDuplicates)
 */
export async function generateBoxGrid(systemId: number, opts: { rows: number; cols: number }) {
  await getSystem(systemId);
  const { rows, cols } = opts;
  const data = [];
  for (let r = 0; r < rows; r++) {
    const letter = String.fromCharCode(65 + r); // 0→A, 1→B, ...
    for (let c = 1; c <= cols; c++) {
      data.push({ systemId, code: `${letter}${c}` });
    }
  }
  const result = await prisma.crabBox.createMany({ data, skipDuplicates: true });
  return { requested: data.length, created: result.count };
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

export async function listFilterTanks(systemId: number, user: AuthUser) {
  await getSystem(systemId, user); // assert เจ้าของระบบก่อน
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
