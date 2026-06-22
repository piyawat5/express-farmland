import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';
import type { AuthUser } from './auth.service';
import { ownerWhere, assertOwnership } from '../lib/scope';

// ── โมดูล E: Contact = คู่ค้า (ผู้ซื้อ/ผู้ขาย, เจ้าเดียวเป็นได้ทั้งคู่) ────

type ContactFilter = {
  type?: Prisma.EnumContactTypeFilter['equals'];
  isRegular?: boolean;
  active?: boolean;
};

export function listContacts(user: AuthUser, filter: ContactFilter) {
  return prisma.contact.findMany({
    where: {
      ...ownerWhere(user),
      type: filter.type,
      isRegular: filter.isRegular,
      active: filter.active,
    },
    orderBy: [{ isRegular: 'desc' }, { id: 'asc' }], // ลูกค้าประจำขึ้นก่อน
  });
}

export async function getContact(id: number, user: AuthUser) {
  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      transactions: { orderBy: { id: 'desc' }, take: 20 },
      outreachLogs: { orderBy: { id: 'desc' }, take: 20 },
    },
  });
  if (!contact) throw notFound('ไม่พบคู่ค้ารายนี้');
  assertOwnership(user, contact.ownerId);
  return contact;
}

export function createContact(user: AuthUser, data: Prisma.ContactUncheckedCreateInput) {
  return prisma.contact.create({ data: { ...data, ownerId: user.id } });
}

export async function updateContact(
  id: number,
  user: AuthUser,
  data: Prisma.ContactUncheckedUpdateInput,
) {
  const c = await prisma.contact.findUnique({ where: { id } });
  if (!c) throw notFound('ไม่พบคู่ค้ารายนี้');
  assertOwnership(user, c.ownerId);
  return prisma.contact.update({ where: { id }, data });
}

export async function deleteContact(id: number, user: AuthUser) {
  const c = await prisma.contact.findUnique({ where: { id } });
  if (!c) throw notFound('ไม่พบคู่ค้ารายนี้');
  assertOwnership(user, c.ownerId);
  await prisma.contact.delete({ where: { id } });
}
