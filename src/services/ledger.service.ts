import { LedgerKind, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';
import type { AuthUser } from './auth.service';
import { ownerWhere, assertOwnership } from '../lib/scope';

// ── โมดูล F: LedgerEntry = สมุดบัญชีรวม income/expense ──────────────────
//
// รวมเงินเข้า-ออกทุกประเภทไว้ที่เดียว (แทน Excel กระจัดกระจาย — pain point #2):
//   - รายการปู: ลงอัตโนมัติเมื่อ Transaction status → DONE (ดู syncLedgerForTransaction)
//   - รายการอื่น (อาหาร/สาร/อุปกรณ์): ผู้ใช้ลงมือเอง ผ่าน CRUD
//
// category มาตรฐาน: CRAB_SALE / CRAB_PURCHASE (auto) + FOOD / SUBSTANCE / EQUIPMENT / OTHER (manual)

export const LEDGER_CATEGORIES = [
  'CRAB_SALE',
  'CRAB_PURCHASE',
  'FOOD',
  'SUBSTANCE',
  'EQUIPMENT',
  'OTHER',
] as const;

type LedgerFilter = {
  systemId?: number;
  kind?: Prisma.EnumLedgerKindFilter['equals'];
  category?: string;
  from?: Date;
  to?: Date;
};

function dateRange(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return { gte: from, lte: to };
}

export function listLedger(user: AuthUser, filter: LedgerFilter) {
  return prisma.ledgerEntry.findMany({
    where: {
      ...ownerWhere(user),
      systemId: filter.systemId,
      kind: filter.kind,
      category: filter.category,
      occurredAt: dateRange(filter.from, filter.to),
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    include: {
      transaction: { select: { id: true, kind: true, contactId: true } },
    },
  });
}

export async function getLedger(id: number, user: AuthUser) {
  const entry = await prisma.ledgerEntry.findUnique({
    where: { id },
    include: { transaction: { select: { id: true, kind: true, contactId: true } } },
  });
  if (!entry) throw notFound('ไม่พบรายการบัญชีนี้');
  assertOwnership(user, entry.ownerId);
  return entry;
}

export type CreateLedgerInput = {
  systemId?: number | null;
  kind: LedgerKind;
  category: string;
  amount: number;
  occurredAt: Date;
  note?: string | null;
};

export function createLedger(user: AuthUser, input: CreateLedgerInput) {
  return prisma.ledgerEntry.create({
    data: {
      ownerId: user.id,
      systemId: input.systemId ?? null,
      kind: input.kind,
      category: input.category,
      amount: input.amount,
      occurredAt: input.occurredAt,
      note: input.note ?? null,
    },
  });
}

export type UpdateLedgerInput = Partial<CreateLedgerInput>;

export async function updateLedger(id: number, user: AuthUser, input: UpdateLedgerInput) {
  const current = await prisma.ledgerEntry.findUnique({ where: { id } });
  if (!current) throw notFound('ไม่พบรายการบัญชีนี้');
  assertOwnership(user, current.ownerId);
  // รายการที่ผูกกับ Transaction (auto) ห้ามแก้มือ — ให้แก้ที่ Transaction แทน
  if (current.transactionId != null) {
    throw notFound('รายการนี้สร้างจากการซื้อขายอัตโนมัติ — แก้ไขที่ Transaction แทน');
  }
  return prisma.ledgerEntry.update({
    where: { id },
    data: {
      systemId: input.systemId === undefined ? undefined : input.systemId,
      kind: input.kind ?? undefined,
      category: input.category ?? undefined,
      amount: input.amount ?? undefined,
      occurredAt: input.occurredAt ?? undefined,
      note: input.note === undefined ? undefined : input.note,
    },
  });
}

export async function deleteLedger(id: number, user: AuthUser) {
  const entry = await prisma.ledgerEntry.findUnique({ where: { id } });
  if (!entry) throw notFound('ไม่พบรายการบัญชีนี้');
  assertOwnership(user, entry.ownerId);
  await prisma.ledgerEntry.delete({ where: { id } });
}

// ── Hook: Transaction → LedgerEntry ────────────────────────────────────
//
// เรียกหลัง create/update Transaction:
//   status === DONE  → upsert LedgerEntry (SELL→INCOME/CRAB_SALE, BUY→EXPENSE/CRAB_PURCHASE)
//   status !== DONE  → ลบ LedgerEntry ที่เคยลง (เผื่อถูกถอย DONE กลับ)
// amount = totalPrice; systemId อิงระบบของปูที่ลิงก์ (ถ้ามี); occurredAt อิง txn หรือ now
export async function syncLedgerForTransaction(transactionId: number) {
  const txn = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      crab: { select: { systemId: true } },
      contact: { select: { ownerId: true } },
      ledgerEntry: true,
    },
  });
  if (!txn) return;

  if (txn.status !== 'DONE') {
    if (txn.ledgerEntry) await prisma.ledgerEntry.delete({ where: { id: txn.ledgerEntry.id } });
    return;
  }

  const data = {
    ownerId: txn.contact.ownerId, // เจ้าของรายการบัญชี = เจ้าของคู่ค้า
    systemId: txn.crab?.systemId ?? null,
    kind: txn.kind === 'SELL' ? LedgerKind.INCOME : LedgerKind.EXPENSE,
    category: txn.kind === 'SELL' ? 'CRAB_SALE' : 'CRAB_PURCHASE',
    amount: txn.totalPrice,
    occurredAt: txn.occurredAt ?? new Date(),
    note: txn.note ?? null,
  };

  if (txn.ledgerEntry) {
    await prisma.ledgerEntry.update({ where: { id: txn.ledgerEntry.id }, data });
  } else {
    await prisma.ledgerEntry.create({ data: { ...data, transactionId: txn.id } });
  }
}

/** ลบ LedgerEntry ที่ผูกกับ Transaction (เรียกก่อนลบ Transaction กัน orphan) */
export async function removeLedgerForTransaction(transactionId: number) {
  await prisma.ledgerEntry.deleteMany({ where: { transactionId } });
}
