import { Prisma, TxnKind, TxnStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';
import { syncLedgerForTransaction, removeLedgerForTransaction } from './ledger.service';
import type { AuthUser } from './auth.service';
import { isAdmin, assertOwnership } from '../lib/scope';

// ── ownership helpers ─────────────────────────────────────────────────
async function assertContactOwned(contactId: number, user: AuthUser) {
  const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { ownerId: true } });
  if (!c) throw notFound('ไม่พบคู่ค้ารายนี้');
  assertOwnership(user, c.ownerId);
}

async function assertCrabOwned(crabId: number, user: AuthUser) {
  const crab = await prisma.crab.findUnique({
    where: { id: crabId },
    select: { system: { select: { ownerId: true } } },
  });
  if (!crab) throw notFound('ไม่พบปูที่ระบุ');
  assertOwnership(user, crab.system.ownerId);
}

// ── โมดูล E: Transaction = การซื้อ/ขาย ────────────────────────────────
//
// หัวใจของ phase นี้ = "คำนวณกำไรล่วงหน้า" (ข้อ 4.5):
//   กรอกราคาที่ไปถามมา (status QUOTE) → เห็น totalPrice / costBasis / profit
//   ก่อนตกลงจริง  (QUOTE → CONFIRMED → DONE)
//
// กติกาคำนวณ:
//   totalPrice = pricePerUnit × qty  (คำนวณให้เสมอ ไม่รับจาก client เพื่อกันค่าขัดกัน)
//   costBasis  = ต้นทุน (เฉพาะ SELL): ถ้าไม่กรอกมา → ดึงจาก purchasePrice ของปูที่ลิงก์ × qty
//   profit     = totalPrice − costBasis (เฉพาะ SELL ที่รู้ต้นทุน); BUY = null

export type TxnFinancialInput = {
  kind: TxnKind;
  qty: number;
  pricePerUnit: number;
  costBasis?: number | null;
  crabId?: number | null;
};

export type TxnFinancials = {
  qty: number;
  pricePerUnit: number;
  totalPrice: number;
  costBasis: number | null;
  profit: number | null;
};

const dec = (v: Prisma.Decimal | number | null | undefined): number | null =>
  v == null ? null : Number(v);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** คำนวณตัวเลขการเงินจาก input + (ถ้ามี) ต้นทุนปูที่ลิงก์ — ใช้ทั้ง preview/create/update */
async function computeFinancials(input: TxnFinancialInput): Promise<TxnFinancials> {
  const qty = input.qty;
  const pricePerUnit = input.pricePerUnit;
  const totalPrice = round2(pricePerUnit * qty);

  let costBasis: number | null = null;
  if (input.kind === 'SELL') {
    if (input.costBasis != null) {
      costBasis = round2(input.costBasis);
    } else if (input.crabId != null) {
      const crab = await prisma.crab.findUnique({
        where: { id: input.crabId },
        select: { purchasePrice: true },
      });
      const pp = dec(crab?.purchasePrice);
      if (pp != null) costBasis = round2(pp * qty);
    }
  }

  const profit = input.kind === 'SELL' && costBasis != null ? round2(totalPrice - costBasis) : null;

  return { qty, pricePerUnit, totalPrice, costBasis, profit };
}

/** คำนวณกำไรล่วงหน้าโดยไม่บันทึก (ข้อ 4.5) */
export async function previewFinancials(user: AuthUser, input: TxnFinancialInput) {
  if (input.crabId != null) await assertCrabOwned(input.crabId, user); // กันดูต้นทุนปูของ user อื่น
  return computeFinancials(input);
}

type TxnFilter = {
  contactId?: number;
  kind?: Prisma.EnumTxnKindFilter['equals'];
  status?: Prisma.EnumTxnStatusFilter['equals'];
  crabId?: number;
};

export function listTransactions(user: AuthUser, filter: TxnFilter) {
  return prisma.transaction.findMany({
    where: {
      contactId: filter.contactId,
      kind: filter.kind,
      status: filter.status,
      crabId: filter.crabId,
      ...(isAdmin(user) ? {} : { contact: { ownerId: user.id } }), // เฉพาะธุรกรรมของคู่ค้าตัวเอง
    },
    orderBy: { id: 'desc' },
    include: {
      contact: { select: { id: true, name: true, type: true } },
      crab: { select: { id: true, code: true } },
    },
  });
}

export async function getTransaction(id: number, user: AuthUser) {
  const txn = await prisma.transaction.findUnique({
    where: { id },
    include: {
      contact: { select: { id: true, name: true, type: true, ownerId: true } },
      crab: { select: { id: true, code: true, purchasePrice: true } },
    },
  });
  if (!txn) throw notFound('ไม่พบรายการซื้อขายนี้');
  assertOwnership(user, txn.contact.ownerId);
  return txn;
}

export type CreateTxnInput = {
  contactId: number;
  kind: TxnKind;
  status?: TxnStatus;
  crabId?: number | null;
  qty?: number;
  pricePerUnit: number;
  costBasis?: number | null;
  round?: number | null;
  occurredAt?: Date | null;
  note?: string | null;
};

export async function createTransaction(user: AuthUser, input: CreateTxnInput) {
  await assertContactOwned(input.contactId, user);
  if (input.crabId != null) await assertCrabOwned(input.crabId, user);

  const qty = input.qty ?? 1;
  const fin = await computeFinancials({
    kind: input.kind,
    qty,
    pricePerUnit: input.pricePerUnit,
    costBasis: input.costBasis,
    crabId: input.crabId,
  });

  const txn = await prisma.transaction.create({
    data: {
      contactId: input.contactId,
      kind: input.kind,
      status: input.status ?? 'QUOTE',
      crabId: input.crabId ?? null,
      qty,
      pricePerUnit: fin.pricePerUnit,
      totalPrice: fin.totalPrice,
      costBasis: fin.costBasis,
      profit: fin.profit,
      round: input.round ?? null,
      occurredAt: input.occurredAt ?? null,
      note: input.note ?? null,
    },
  });
  // status → DONE ลง LedgerEntry อัตโนมัติ (โมดูล F hook)
  await syncLedgerForTransaction(txn.id);
  return txn;
}

export type UpdateTxnInput = Partial<Omit<CreateTxnInput, 'contactId'>>;

export async function updateTransaction(id: number, user: AuthUser, input: UpdateTxnInput) {
  const current = await prisma.transaction.findUnique({
    where: { id },
    include: { contact: { select: { ownerId: true } } },
  });
  if (!current) throw notFound('ไม่พบรายการซื้อขายนี้');
  assertOwnership(user, current.contact.ownerId);

  if (input.crabId != null) await assertCrabOwned(input.crabId, user);

  // ค่าที่ใช้คำนวณ — เอาจาก input ถ้าส่งมา ไม่งั้นใช้ของเดิม
  const kind = input.kind ?? current.kind;
  const qty = input.qty ?? current.qty;
  const pricePerUnit = input.pricePerUnit ?? Number(current.pricePerUnit);
  const crabId = input.crabId === undefined ? current.crabId : input.crabId;
  // costBasis: ถ้า client ส่งมา (รวม null = ล้างให้ดึงใหม่จากปู) ใช้ค่านั้น, ไม่ส่ง = ค่าเดิม
  const costBasis = input.costBasis === undefined ? dec(current.costBasis) : input.costBasis;

  const fin = await computeFinancials({ kind, qty, pricePerUnit, costBasis, crabId });

  const txn = await prisma.transaction.update({
    where: { id },
    data: {
      kind,
      status: input.status ?? undefined,
      crabId,
      qty: fin.qty,
      pricePerUnit: fin.pricePerUnit,
      totalPrice: fin.totalPrice,
      costBasis: fin.costBasis,
      profit: fin.profit,
      round: input.round === undefined ? undefined : input.round,
      occurredAt: input.occurredAt === undefined ? undefined : input.occurredAt,
      note: input.note === undefined ? undefined : input.note,
    },
  });
  // sync LedgerEntry ตามสถานะล่าสุด (ลงเมื่อ DONE / ถอนเมื่อออกจาก DONE)
  await syncLedgerForTransaction(txn.id);
  return txn;
}

export async function deleteTransaction(id: number, user: AuthUser) {
  const txn = await prisma.transaction.findUnique({
    where: { id },
    include: { contact: { select: { ownerId: true } } },
  });
  if (!txn) throw notFound('ไม่พบรายการซื้อขายนี้');
  assertOwnership(user, txn.contact.ownerId);
  // ลบ LedgerEntry ที่ผูกไว้ก่อน กัน orphan (FK เป็น optional → default SetNull)
  await removeLedgerForTransaction(id);
  await prisma.transaction.delete({ where: { id } });
}
