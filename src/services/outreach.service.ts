import { Prisma, TxnKind, OutreachStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound, badRequest } from '../lib/http';

// ── โมดูล E: OutreachLog = ไล่ทักคู่ค้าทีละเจ้าต่อรอบ (ข้อ 4.4) ─────────
//
// 1 รอบ (round) ของการหาซื้อ/หาขาย (kind) → มี log ต่อคู่ค้า 1 ใบ
//   unique [contactId, round, kind]; status ไล่จาก PENDING → CONTACTED → ...
// kind=SELL = รอบหาคนซื้อ → ทักผู้ซื้อ (BUYER/BOTH)
// kind=BUY  = รอบหาของ   → ทักผู้ขาย (SELLER/BOTH)

type OutreachFilter = {
  round?: number;
  kind?: Prisma.EnumTxnKindFilter['equals'];
  status?: Prisma.EnumOutreachStatusFilter['equals'];
  contactId?: number;
};

export function listOutreach(filter: OutreachFilter) {
  return prisma.outreachLog.findMany({
    where: {
      round: filter.round,
      kind: filter.kind,
      status: filter.status,
      contactId: filter.contactId,
    },
    orderBy: [{ round: 'desc' }, { id: 'asc' }],
    include: { contact: { select: { id: true, name: true, type: true, isRegular: true, phone: true } } },
  });
}

/** ประเภทคู่ค้าที่ต้องทักสำหรับ kind นี้ */
function contactTypesFor(kind: TxnKind): ('BUYER' | 'SELLER' | 'BOTH')[] {
  return kind === 'SELL' ? ['BUYER', 'BOTH'] : ['SELLER', 'BOTH'];
}

/**
 * เปิดรอบใหม่: สร้าง log PENDING ให้คู่ค้าที่เกี่ยวข้อง (idempotent — ข้ามใบที่มีแล้ว)
 * ถ้าระบุ contactIds มา ใช้เฉพาะรายนั้น (ต้อง active) ไม่งั้นเอาคู่ค้า active ทุกเจ้าที่ type ตรง
 */
export async function startRound(input: { round: number; kind: TxnKind; contactIds?: number[] }) {
  const where: Prisma.ContactWhereInput = {
    active: true,
    type: { in: contactTypesFor(input.kind) },
    ...(input.contactIds?.length ? { id: { in: input.contactIds } } : {}),
  };
  const contacts = await prisma.contact.findMany({ where, select: { id: true } });
  if (contacts.length === 0) throw badRequest('ไม่พบคู่ค้าที่ตรงเงื่อนไขสำหรับเปิดรอบนี้');

  await prisma.outreachLog.createMany({
    data: contacts.map((c) => ({
      contactId: c.id,
      round: input.round,
      kind: input.kind,
      status: 'PENDING' as OutreachStatus,
    })),
    skipDuplicates: true, // กันชนกับ unique [contactId, round, kind]
  });

  return listOutreach({ round: input.round, kind: input.kind });
}

export async function createOutreach(data: {
  contactId: number;
  round: number;
  kind: TxnKind;
  status?: OutreachStatus;
  contactedAt?: Date | null;
  note?: string | null;
}) {
  const contact = await prisma.contact.findUnique({ where: { id: data.contactId } });
  if (!contact) throw notFound('ไม่พบคู่ค้ารายนี้');
  try {
    return await prisma.outreachLog.create({
      data: {
        contactId: data.contactId,
        round: data.round,
        kind: data.kind,
        status: data.status ?? 'PENDING',
        contactedAt: data.contactedAt ?? null,
        note: data.note ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw badRequest('คู่ค้ารายนี้มี log ของรอบ/ประเภทนี้อยู่แล้ว');
    }
    throw err;
  }
}

export async function updateOutreach(
  id: number,
  data: { status?: OutreachStatus; contactedAt?: Date | null; note?: string | null },
) {
  const current = await prisma.outreachLog.findUnique({ where: { id } });
  if (!current) throw notFound('ไม่พบ log การติดต่อนี้');

  // เปลี่ยนสถานะออกจาก PENDING แต่ไม่ได้ระบุเวลา → บันทึกเวลาทักให้อัตโนมัติ
  const movedOffPending =
    data.status != null && data.status !== 'PENDING' && current.status === 'PENDING';
  const contactedAt =
    data.contactedAt !== undefined
      ? data.contactedAt
      : movedOffPending && current.contactedAt == null
        ? new Date()
        : undefined;

  return prisma.outreachLog.update({
    where: { id },
    data: {
      status: data.status ?? undefined,
      contactedAt,
      note: data.note === undefined ? undefined : data.note,
    },
  });
}

export async function deleteOutreach(id: number) {
  const o = await prisma.outreachLog.findUnique({ where: { id } });
  if (!o) throw notFound('ไม่พบ log การติดต่อนี้');
  await prisma.outreachLog.delete({ where: { id } });
}
