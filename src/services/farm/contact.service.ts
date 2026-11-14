import type { ContactType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { assertOwned } from '../../lib/scope';
import type { AuthUser } from '../auth.service';

// คู่ค้า: คนขายปู (SELLER) / ลูกค้า (CUSTOMER) — เพิ่มได้ตรงช่องที่เลือก (SelectOrCreate) ไม่ต้องไปอีกเมนู

const SELECT = { id: true, type: true, name: true, phone: true, note: true } as const;

export function listContacts(user: AuthUser, type?: ContactType) {
  return prisma.contact.findMany({
    where: { ownerId: user.id, ...(type ? { type } : {}) },
    orderBy: [{ updatedAt: 'desc' }],
    select: SELECT,
  });
}

export function createContact(user: AuthUser, input: { type: ContactType; name: string; phone?: string | null; note?: string | null }) {
  return prisma.contact.create({
    data: { ownerId: user.id, type: input.type, name: input.name.trim(), phone: input.phone?.trim() || null, note: input.note ?? null },
    select: SELECT,
  });
}

export async function updateContact(user: AuthUser, id: number, input: { name?: string; phone?: string | null; note?: string | null }) {
  assertOwned(await prisma.contact.findUnique({ where: { id } }), user, 'คู่ค้านี้');
  return prisma.contact.update({
    where: { id },
    data: {
      name: input.name?.trim() || undefined,
      phone: input.phone === undefined ? undefined : input.phone?.trim() || null,
      note: input.note,
    },
    select: SELECT,
  });
}
