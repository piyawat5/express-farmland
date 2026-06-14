import { InventoryCategory, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';
import { createTask } from './task.service';

// ── โมดูล G: InventoryItem = คลังของ (อาหารปู/สาร/อุปกรณ์) ─────────────
//
// บันทึกจำนวนคงเหลือ + เกณฑ์ต่ำสุด (lowThreshold) → ถ้าต่ำกว่าเกณฑ์
// scheduler.tick จะสร้าง Task RESTOCK ให้อัตโนมัติ + เข้าเมลเตือน

const num = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));

/** ของชิ้นนี้ "ใกล้หมด" ไหม (มีเกณฑ์ + คงเหลือ <= เกณฑ์) */
function isLow(item: { currentQty: Prisma.Decimal | number; lowThreshold: Prisma.Decimal | number | null }) {
  return item.lowThreshold != null && num(item.currentQty) <= num(item.lowThreshold);
}

export async function listInventory(filter: { category?: InventoryCategory; lowOnly?: boolean }) {
  const items = await prisma.inventoryItem.findMany({
    where: { category: filter.category },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    include: { substance: { select: { id: true, name: true } } },
  });
  return filter.lowOnly ? items.filter(isLow) : items;
}

export async function getInventory(id: number) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    include: { substance: { select: { id: true, name: true } } },
  });
  if (!item) throw notFound('ไม่พบรายการในคลัง');
  return item;
}

export type CreateInventoryInput = {
  name: string;
  category: InventoryCategory;
  currentQty?: number;
  unit: string;
  lowThreshold?: number | null;
  substanceId?: number | null;
  note?: string | null;
};

export async function createInventory(input: CreateInventoryInput) {
  const item = await prisma.inventoryItem.create({
    data: {
      name: input.name,
      category: input.category,
      currentQty: input.currentQty ?? 0,
      unit: input.unit,
      lowThreshold: input.lowThreshold ?? null,
      substanceId: input.substanceId ?? null,
      note: input.note ?? null,
    },
  });
  return item;
}

export type UpdateInventoryInput = Partial<CreateInventoryInput>;

export async function updateInventory(id: number, input: UpdateInventoryInput) {
  await getInventory(id);
  const item = await prisma.inventoryItem.update({
    where: { id },
    data: {
      name: input.name ?? undefined,
      category: input.category ?? undefined,
      currentQty: input.currentQty ?? undefined,
      unit: input.unit ?? undefined,
      lowThreshold: input.lowThreshold === undefined ? undefined : input.lowThreshold,
      substanceId: input.substanceId === undefined ? undefined : input.substanceId,
      note: input.note === undefined ? undefined : input.note,
    },
  });
  await closeRestockIfStocked(item);
  return item;
}

/** ปรับจำนวนคงเหลือ (delta บวก = ซื้อเข้า, ลบ = ใช้ไป) — ไม่ต่ำกว่า 0 */
export async function adjustInventory(id: number, delta: number) {
  const current = await getInventory(id);
  const next = Math.max(0, Math.round((num(current.currentQty) + delta) * 100) / 100);
  const item = await prisma.inventoryItem.update({ where: { id }, data: { currentQty: next } });
  await closeRestockIfStocked(item);
  return item;
}

export async function deleteInventory(id: number) {
  await getInventory(id);
  // ตัดลิงก์ Task RESTOCK ที่ค้างของของชิ้นนี้ก่อนลบ
  await prisma.task.updateMany({
    where: { status: 'PENDING', type: 'RESTOCK', linkType: 'InventoryItem', linkId: id },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });
  await prisma.inventoryItem.delete({ where: { id } });
}

/** ถ้าเติมของจนพ้นเกณฑ์แล้ว → ปิด Task RESTOCK ที่ค้างของชิ้นนั้น (ถือว่าซื้อเติมแล้ว) */
async function closeRestockIfStocked(item: { id: number; currentQty: Prisma.Decimal; lowThreshold: Prisma.Decimal | null }) {
  if (isLow(item)) return;
  await prisma.task.updateMany({
    where: { status: 'PENDING', type: 'RESTOCK', linkType: 'InventoryItem', linkId: item.id },
    data: { status: 'DONE', completedAt: new Date(), linkType: 'InventoryItem', linkId: item.id },
  });
}

/**
 * สร้าง Task RESTOCK สำหรับของที่ใกล้หมด (เรียกจาก scheduler.tick)
 * กันซ้ำ: ถ้ามี Task RESTOCK PENDING ของชิ้นนั้นค้างอยู่แล้ว → ข้าม
 * ผูกผู้รับ = เจ้าของคนแรก (single user) เพื่อให้เมลเตือนมีปลายทาง
 */
export async function generateRestockTasks(now: Date): Promise<number> {
  const items = await prisma.inventoryItem.findMany({ where: { lowThreshold: { not: null } } });
  const low = items.filter(isLow);
  if (low.length === 0) return 0;

  const owner = await prisma.user.findFirst({ where: { active: true }, orderBy: { id: 'asc' } });
  let created = 0;
  for (const it of low) {
    const existing = await prisma.task.count({
      where: { status: 'PENDING', type: 'RESTOCK', linkType: 'InventoryItem', linkId: it.id },
    });
    if (existing > 0) continue;
    await createTask({
      type: 'RESTOCK',
      title: `ของใกล้หมด: ${it.name}`,
      detail: `เหลือ ${num(it.currentQty)} ${it.unit} (ต่ำกว่าเกณฑ์ ${num(it.lowThreshold)} ${it.unit}) — ควรไปซื้อเพิ่ม`,
      userId: owner?.id ?? null,
      dueAt: now,
      linkType: 'InventoryItem',
      linkId: it.id,
    });
    created++;
  }
  return created;
}
