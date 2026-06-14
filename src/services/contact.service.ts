import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';

// ── โมดูล E: Contact = คู่ค้า (ผู้ซื้อ/ผู้ขาย, เจ้าเดียวเป็นได้ทั้งคู่) ────

type ContactFilter = {
  type?: Prisma.EnumContactTypeFilter['equals'];
  isRegular?: boolean;
  active?: boolean;
};

export function listContacts(filter: ContactFilter) {
  return prisma.contact.findMany({
    where: {
      type: filter.type,
      isRegular: filter.isRegular,
      active: filter.active,
    },
    orderBy: [{ isRegular: 'desc' }, { id: 'asc' }], // ลูกค้าประจำขึ้นก่อน
  });
}

export async function getContact(id: number) {
  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      transactions: { orderBy: { id: 'desc' }, take: 20 },
      outreachLogs: { orderBy: { id: 'desc' }, take: 20 },
    },
  });
  if (!contact) throw notFound('ไม่พบคู่ค้ารายนี้');
  return contact;
}

export function createContact(data: Prisma.ContactUncheckedCreateInput) {
  return prisma.contact.create({ data });
}

export async function updateContact(id: number, data: Prisma.ContactUncheckedUpdateInput) {
  const c = await prisma.contact.findUnique({ where: { id } });
  if (!c) throw notFound('ไม่พบคู่ค้ารายนี้');
  return prisma.contact.update({ where: { id }, data });
}

export async function deleteContact(id: number) {
  const c = await prisma.contact.findUnique({ where: { id } });
  if (!c) throw notFound('ไม่พบคู่ค้ารายนี้');
  await prisma.contact.delete({ where: { id } });
}
