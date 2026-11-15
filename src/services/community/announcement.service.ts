import type { AnnouncementKind, Prisma } from '@prisma/client';
import { badRequest, notFound } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../auth.service';

// ════════════════════════════════════════════════════════════════════
//  ประกาศ (P8 · ข้อ 5.12)
//    MUST_READ  ป๊อปอัปจนกว่าจะกด "รับทราบ" (คนละครั้ง)
//    GENERAL    การ์ด "ประกาศ" บนหน้าแรก (กด ✕ = ไม่โชว์อีก — ใช้ตาราง ack เดียวกัน)
//  แสดงช่วง startsAt ≤ ตอนนี้ < expiresAt (null = ไม่หมดอายุ) · ตั้งล่วงหน้าได้
// ════════════════════════════════════════════════════════════════════

const activeWhere = (now = new Date()): Prisma.AnnouncementWhereInput => ({
  startsAt: { lte: now },
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

const SELECT = { id: true, kind: true, title: true, body: true, linkUrl: true, startsAt: true, expiresAt: true } satisfies Prisma.AnnouncementSelect;

/** ประกาศที่กำลังแสดงอยู่ + ผู้ใช้คนนี้รับทราบ/ปิดไปแล้วหรือยัง (ใหม่สุดก่อน) */
export async function listActive(user: AuthUser) {
  const rows = await prisma.announcement.findMany({
    where: activeWhere(),
    orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    take: 30,
    select: { ...SELECT, acks: { where: { userId: user.id }, select: { ackedAt: true } } },
  });
  return rows.map(({ acks, ...a }) => ({ ...a, acked: acks.length > 0 }));
}

export async function ack(user: AuthUser, id: number) {
  const exists = await prisma.announcement.count({ where: { id } });
  if (!exists) throw notFound('ไม่พบประกาศ');
  await prisma.announcementAck.createMany({ data: [{ announcementId: id, userId: user.id }], skipDuplicates: true });
}

// ── หลังบ้าน ─────────────────────────────────────────────────────────

export type AnnouncementInput = {
  kind: AnnouncementKind;
  title: string;
  body: string;
  linkUrl?: string | null;
  startsAt?: Date | null;
  expiresAt?: Date | null;
};

function check(startsAt: Date, expiresAt: Date | null | undefined) {
  if (expiresAt && expiresAt <= startsAt) throw badRequest('วันหมดอายุต้องอยู่หลังวันเริ่มแสดง');
}

export async function adminList() {
  const rows = await prisma.announcement.findMany({ orderBy: [{ startsAt: 'desc' }, { id: 'desc' }], take: 200, select: { ...SELECT, createdAt: true } });
  const ids = rows.map((r) => r.id);
  // นับคนรับทราบเฉพาะประกาศในหน้านี้ (groupBy แทน _count) · นับแค่ลูกค้า (แอดมินที่ประกาศถือว่ารับทราบเองแล้ว)
  const acks = ids.length
    ? await prisma.announcementAck.groupBy({ by: ['announcementId'], where: { announcementId: { in: ids }, user: { role: 'USER' } }, _count: { _all: true } })
    : [];
  const byId = new Map(acks.map((a) => [a.announcementId, a._count._all]));
  const now = new Date();
  return rows.map((r) => ({
    ...r,
    ackCount: byId.get(r.id) ?? 0,
    state: r.startsAt > now ? ('SCHEDULED' as const) : r.expiresAt && r.expiresAt <= now ? ('EXPIRED' as const) : ('ACTIVE' as const),
  }));
}

/** แอดมินที่ประกาศ = รับทราบแล้ว (ไม่งั้นป๊อปอัปของตัวเองเด้งทับหน้าหลังบ้านทันทีที่กดประกาศ) */
export async function adminCreate(adminId: number, input: AnnouncementInput) {
  const startsAt = input.startsAt ?? new Date();
  check(startsAt, input.expiresAt);
  return prisma.announcement.create({
    data: {
      kind: input.kind,
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl || null,
      startsAt,
      expiresAt: input.expiresAt ?? null,
      acks: { create: { userId: adminId } },
    },
    select: SELECT,
  });
}

export async function adminUpdate(id: number, input: Partial<AnnouncementInput>) {
  const cur = await prisma.announcement.findUnique({ where: { id }, select: { startsAt: true, expiresAt: true } });
  if (!cur) throw notFound('ไม่พบประกาศ');
  const startsAt = input.startsAt ?? cur.startsAt;
  const expiresAt = input.expiresAt !== undefined ? input.expiresAt : cur.expiresAt;
  check(startsAt, expiresAt);
  return prisma.announcement.update({
    where: { id },
    data: {
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.linkUrl !== undefined ? { linkUrl: input.linkUrl || null } : {}),
      startsAt,
      expiresAt,
    },
    select: SELECT,
  });
}

export async function adminRemove(id: number) {
  const r = await prisma.announcement.deleteMany({ where: { id } });
  if (!r.count) throw notFound('ไม่พบประกาศ');
}

/** ให้ลูกค้าอ่านใหม่ทั้งหมด (แก้เนื้อหาสำคัญแล้ว อยากให้ทุกคนเห็นป๊อปอัปอีกรอบ) — ของแอดมินคงไว้ */
export async function adminResetAcks(id: number) {
  const exists = await prisma.announcement.count({ where: { id } });
  if (!exists) throw notFound('ไม่พบประกาศ');
  await prisma.announcementAck.deleteMany({ where: { announcementId: id, user: { role: 'USER' } } });
}
