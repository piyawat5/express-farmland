import { InventoryCategory, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';
import { createTask } from './task.service';
import type { AuthUser } from './auth.service';
import { ownerWhere, assertOwnership } from '../lib/scope';

// ── โมดูล G: InventoryItem = คลังของ (อาหารปู/สาร/อุปกรณ์) ─────────────
//
// บันทึกจำนวนคงเหลือ + เกณฑ์ต่ำสุด (lowThreshold) → ถ้าต่ำกว่าเกณฑ์
// scheduler.tick จะสร้าง Task RESTOCK ให้อัตโนมัติ + เข้าเมลเตือน

const num = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));

/** ของชิ้นนี้ "ใกล้หมด" ไหม (มีเกณฑ์ + คงเหลือ <= เกณฑ์) */
function isLow(item: { currentQty: Prisma.Decimal | number; lowThreshold: Prisma.Decimal | number | null }) {
  return item.lowThreshold != null && num(item.currentQty) <= num(item.lowThreshold);
}

export async function listInventory(
  user: AuthUser,
  filter: { category?: InventoryCategory; lowOnly?: boolean },
) {
  const items = await prisma.inventoryItem.findMany({
    where: { ...ownerWhere(user), category: filter.category },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    include: { substance: { select: { id: true, name: true } } },
  });
  return filter.lowOnly ? items.filter(isLow) : items;
}

export async function getInventory(id: number, user?: AuthUser) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    include: { substance: { select: { id: true, name: true } } },
  });
  if (!item) throw notFound('ไม่พบรายการในคลัง');
  if (user) assertOwnership(user, item.ownerId);
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

export async function createInventory(user: AuthUser, input: CreateInventoryInput) {
  const item = await prisma.inventoryItem.create({
    data: {
      ownerId: user.id,
      name: input.name,
      category: input.category,
      currentQty: input.currentQty ?? 0,
      unit: input.unit,
      lowThreshold: input.lowThreshold ?? null,
      substanceId: input.substanceId ?? null,
      note: input.note ?? null,
    },
  });
  await syncRestockTask(item);
  return item;
}

export type UpdateInventoryInput = Partial<CreateInventoryInput>;

export async function updateInventory(id: number, user: AuthUser, input: UpdateInventoryInput) {
  await getInventory(id, user);
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
  await syncRestockTask(item);
  return item;
}

/** ปรับจำนวนคงเหลือ (delta บวก = ซื้อเข้า, ลบ = ใช้ไป) — ไม่ต่ำกว่า 0 */
export async function adjustInventory(id: number, user: AuthUser, delta: number) {
  const current = await getInventory(id, user);
  const next = Math.max(0, Math.round((num(current.currentQty) + delta) * 100) / 100);
  const item = await prisma.inventoryItem.update({ where: { id }, data: { currentQty: next } });
  await syncRestockTask(item);
  return item;
}

export async function deleteInventory(id: number, user: AuthUser) {
  await getInventory(id, user);
  // ตัดลิงก์ Task RESTOCK ที่ค้างของของชิ้นนี้ก่อนลบ
  await prisma.task.updateMany({
    where: { status: 'PENDING', type: 'RESTOCK', linkType: 'InventoryItem', linkId: id },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });
  await prisma.inventoryItem.delete({ where: { id } });
}

type RestockItem = {
  id: number;
  name: string;
  ownerId: number | null;
  currentQty: Prisma.Decimal | number;
  unit: string;
  lowThreshold: Prisma.Decimal | number | null;
};

/** สร้าง Task RESTOCK ให้ของชิ้นนี้ (กันซ้ำถ้ามี PENDING อยู่แล้ว) — คืน 1 ถ้าสร้างใหม่ */
async function ensureRestockTask(item: RestockItem, now: Date, ownerId: number | null): Promise<number> {
  const existing = await prisma.task.count({
    where: { status: 'PENDING', type: 'RESTOCK', linkType: 'InventoryItem', linkId: item.id },
  });
  if (existing > 0) return 0;
  await createTask({
    type: 'RESTOCK',
    title: `ของใกล้หมด: ${item.name}`,
    detail: `เหลือ ${num(item.currentQty)} ${item.unit} (ต่ำกว่าเกณฑ์ ${num(item.lowThreshold)} ${item.unit}) — ควรไปซื้อเพิ่ม`,
    userId: ownerId,
    dueAt: now,
    linkType: 'InventoryItem',
    linkId: item.id,
  });
  return 1;
}

/**
 * sync Task RESTOCK ตามสถานะสต็อกล่าสุด (เรียกหลัง create/update/adjust):
 *   ใกล้หมด → สร้าง Task ทันที (ไม่ต้องรอ cron)
 *   พ้นเกณฑ์ → ปิด Task ที่ค้าง (ถือว่าซื้อเติมแล้ว)
 */
async function syncRestockTask(item: RestockItem) {
  if (isLow(item)) {
    // ปลายทางแจ้งเตือน = เจ้าของคลังของชิ้นนี้ (per-user)
    await ensureRestockTask(item, new Date(), item.ownerId);
  } else {
    await prisma.task.updateMany({
      where: { status: 'PENDING', type: 'RESTOCK', linkType: 'InventoryItem', linkId: item.id },
      data: { status: 'DONE', completedAt: new Date(), linkType: 'InventoryItem', linkId: item.id },
    });
  }
}

/**
 * กวาดของที่ใกล้หมดทั้งหมด → สร้าง Task RESTOCK (เรียกจาก scheduler.tick เป็น safety net)
 * ผูกผู้รับ = เจ้าของคนแรก (single user) เพื่อให้เมลเตือนมีปลายทาง
 */
export async function generateRestockTasks(now: Date): Promise<number> {
  const items = await prisma.inventoryItem.findMany({ where: { lowThreshold: { not: null } } });
  const low = items.filter(isLow);
  if (low.length === 0) return 0;

  let created = 0;
  for (const it of low) {
    // ปลายทาง = เจ้าของของชิ้นนั้นๆ (multi-user)
    created += await ensureRestockTask(it, now, it.ownerId);
  }
  return created;
}
