import { Prisma, type BugStatus } from '@prisma/client';
import { AppError, notFound } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../auth.service';

// ════════════════════════════════════════════════════════════════════
//  แจ้งปัญหา (P8 · ข้อ 5.12) — ผู้ใช้เห็นแค่ของตัวเอง แอดมินเห็นทั้งหมด
//  - หน้าเว็บแนบให้เอง: หน้าที่เกิดปัญหา (page/pageTitle) + เครื่อง (device)
//  - ตอบกลับกันในเรื่องเดียว (BugComment · fromAdmin = "ทีมงาน")
//  - ยังไม่ได้อ่าน 2 ฝั่ง: userUnread (ทีมงานตอบ/เปลี่ยนสถานะ → ⚠ bug_reply) · adminUnread (เรื่องใหม่/ผู้ใช้ตอบ → ตัวเลขที่เมนูหลังบ้าน)
//  - ผู้ใช้ตอบในเรื่องที่ "แก้แล้ว" หรือ "ขอข้อมูลเพิ่ม" = เปิดเรื่องอีกครั้ง (กลับเป็น "รับเรื่องแล้ว")
// ════════════════════════════════════════════════════════════════════

export const BUG_STATUSES: BugStatus[] = ['RECEIVED', 'FIXING', 'FIXED', 'NEED_INFO'];
const OPEN: BugStatus[] = ['RECEIVED', 'FIXING', 'NEED_INFO'];
const DAILY_LIMIT = 10;

export type BugPhoto = { url: string; publicId?: string | null };
export type BugDevice = { ua?: string; screen?: string; theme?: string; app?: string; lang?: string };

const photosOf = (v: Prisma.JsonValue | null): BugPhoto[] => (Array.isArray(v) ? (v as BugPhoto[]) : []);
const json = (photos?: BugPhoto[] | null) => (photos?.length ? (photos as unknown as Prisma.InputJsonValue) : Prisma.DbNull);

const DETAIL = {
  id: true,
  userId: true,
  body: true,
  photos: true,
  page: true,
  pageTitle: true,
  device: true,
  status: true,
  userUnread: true,
  adminUnread: true,
  lastActivityAt: true,
  createdAt: true,
  comments: { orderBy: { createdAt: 'asc' }, select: { id: true, fromAdmin: true, body: true, photos: true, status: true, createdAt: true } },
} satisfies Prisma.BugReportSelect;

type BugDb = Prisma.BugReportGetPayload<{ select: typeof DETAIL }>;

function toDetail(b: BugDb) {
  return {
    id: b.id,
    body: b.body,
    photos: photosOf(b.photos),
    page: b.page,
    pageTitle: b.pageTitle,
    device: (b.device as BugDevice | null) ?? null,
    status: b.status,
    userUnread: b.userUnread,
    adminUnread: b.adminUnread,
    lastActivityAt: b.lastActivityAt,
    createdAt: b.createdAt,
    comments: b.comments.map((c) => ({ ...c, photos: photosOf(c.photos) })),
  };
}
export type BugDetail = ReturnType<typeof toDetail>;

/** แถวในรายการ (ไม่มีเธรด) — ข้อความตัดสั้น + รูปแรก + จำนวนข้อความ */
async function toRows<T extends { id: number; body: string; photos: Prisma.JsonValue | null }>(rows: T[]) {
  const ids = rows.map((r) => r.id);
  // groupBy เฉพาะเรื่องในหน้านี้ (ไม่ใช้ _count ใน findMany — นับทั้งตาราง)
  const counts = ids.length ? await prisma.bugComment.groupBy({ by: ['bugId'], where: { bugId: { in: ids } }, _count: { _all: true } }) : [];
  const byBug = new Map(counts.map((c) => [c.bugId, c._count._all]));
  return rows.map(({ body, photos, ...r }) => ({
    ...r,
    excerpt: body.length > 140 ? `${body.slice(0, 140)}…` : body,
    photo: photosOf(photos)[0]?.url ?? null,
    comments: byBug.get(r.id) ?? 0,
  }));
}

const ROW = {
  id: true,
  body: true,
  photos: true,
  pageTitle: true,
  status: true,
  userUnread: true,
  adminUnread: true,
  lastActivityAt: true,
  createdAt: true,
} satisfies Prisma.BugReportSelect;

// ── ผู้ใช้ ─────────────────────────────────────────────────────────────

export async function listMyBugs(user: AuthUser) {
  const rows = await prisma.bugReport.findMany({ where: { userId: user.id }, orderBy: { lastActivityAt: 'desc' }, take: 100, select: ROW });
  return toRows(rows);
}

export async function createBug(
  user: AuthUser,
  input: { body: string; photos?: BugPhoto[]; page?: string | null; pageTitle?: string | null; device?: BugDevice | null },
) {
  const since = new Date(Date.now() - 24 * 3600_000);
  const today = await prisma.bugReport.count({ where: { userId: user.id, createdAt: { gte: since } } });
  if (today >= DAILY_LIMIT) throw new AppError(429, `แจ้งได้วันละ ${DAILY_LIMIT} เรื่อง — ตอบเพิ่มในเรื่องเดิมได้`);
  const b = await prisma.bugReport.create({
    data: {
      userId: user.id,
      body: input.body,
      photos: json(input.photos),
      page: input.page || null,
      pageTitle: input.pageTitle || null,
      device: input.device ? (input.device as Prisma.InputJsonValue) : Prisma.DbNull,
    },
    select: DETAIL,
  });
  return toDetail(b);
}

/** เปิดอ่าน = ล้างสถานะยังไม่ได้อ่านของฝั่งผู้ใช้ */
export async function getMyBug(user: AuthUser, id: number) {
  const b = await prisma.bugReport.findUnique({ where: { id }, select: DETAIL });
  if (!b || b.userId !== user.id) throw notFound('ไม่พบเรื่องที่แจ้ง');
  if (b.userUnread) await prisma.bugReport.update({ where: { id }, data: { userUnread: false } });
  return toDetail({ ...b, userUnread: false });
}

export async function commentMyBug(user: AuthUser, id: number, input: { body: string; photos?: BugPhoto[] }) {
  const b = await prisma.bugReport.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!b || b.userId !== user.id) throw notFound('ไม่พบเรื่องที่แจ้ง');
  const reopen = b.status === 'FIXED' || b.status === 'NEED_INFO';
  await prisma.$transaction([
    prisma.bugComment.create({ data: { bugId: id, body: input.body, photos: json(input.photos) } }),
    prisma.bugReport.update({
      where: { id },
      data: { adminUnread: true, userUnread: false, lastActivityAt: new Date(), ...(reopen ? { status: 'RECEIVED' } : {}) },
    }),
  ]);
  return getMyBug(user, id);
}

/** ⚠ bug_reply: เรื่องที่ทีมงานตอบ/เปลี่ยนสถานะแล้วผู้ใช้ยังไม่เปิดอ่าน */
export async function unreadForUser(userId: number) {
  const rows = await prisma.bugReport.findMany({ where: { userId, userUnread: true }, select: { status: true } });
  return { count: rows.length, needInfo: rows.filter((r) => r.status === 'NEED_INFO').length };
}

// ── หลังบ้าน ─────────────────────────────────────────────────────────

export type AdminBugQuery = { status?: BugStatus | 'OPEN'; unread?: boolean; skip?: number; take?: number };

export async function adminListBugs(q: AdminBugQuery) {
  const where: Prisma.BugReportWhereInput = {
    ...(q.status === 'OPEN' ? { status: { in: OPEN } } : q.status ? { status: q.status } : {}),
    ...(q.unread ? { adminUnread: true } : {}),
  };
  const [rows, total, grouped, unread] = await Promise.all([
    prisma.bugReport.findMany({
      where,
      // ยังไม่ได้อ่านขึ้นก่อน แล้วตามความเคลื่อนไหวล่าสุด
      orderBy: [{ adminUnread: 'desc' }, { lastActivityAt: 'desc' }],
      skip: q.skip ?? 0,
      take: q.take ?? 30,
      select: { ...ROW, user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.bugReport.count({ where }),
    prisma.bugReport.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.bugReport.count({ where: { adminUnread: true } }),
  ]);
  const counts = Object.fromEntries(BUG_STATUSES.map((s) => [s, 0])) as Record<BugStatus, number>;
  for (const g of grouped) counts[g.status] = g._count._all;
  return { total, counts, unread, items: await toRows(rows) };
}

async function adminDetail(id: number) {
  const b = await prisma.bugReport.findUnique({ where: { id }, select: { ...DETAIL, user: { select: { id: true, name: true, email: true } } } });
  if (!b) throw notFound('ไม่พบเรื่องที่แจ้ง');
  return { ...toDetail(b), user: b.user };
}

export async function adminGetBug(id: number) {
  const b = await adminDetail(id);
  if (b.adminUnread) await prisma.bugReport.update({ where: { id }, data: { adminUnread: false } });
  return { ...b, adminUnread: false };
}

/** ตอบ และ/หรือ เปลี่ยนสถานะ → ผู้ใช้เห็น ⚠ จนกว่าจะเปิดอ่าน */
export async function adminReplyBug(id: number, input: { body?: string | null; photos?: BugPhoto[]; status?: BugStatus }) {
  const b = await prisma.bugReport.findUnique({ where: { id }, select: { status: true } });
  if (!b) throw notFound('ไม่พบเรื่องที่แจ้ง');
  const status = input.status && input.status !== b.status ? input.status : undefined;
  const body = input.body?.trim() || null;
  if (!body && !status && !input.photos?.length) throw new AppError(400, 'พิมพ์ข้อความ หรือเปลี่ยนสถานะก่อน');
  await prisma.$transaction([
    prisma.bugComment.create({ data: { bugId: id, fromAdmin: true, body, photos: json(input.photos), status: status ?? null } }),
    prisma.bugReport.update({
      where: { id },
      data: { userUnread: true, adminUnread: false, lastActivityAt: new Date(), ...(status ? { status } : {}) },
    }),
  ]);
  return adminDetail(id);
}

export async function adminBugCounts() {
  const [unread, open] = await Promise.all([
    prisma.bugReport.count({ where: { adminUnread: true } }),
    prisma.bugReport.count({ where: { status: { in: OPEN } } }),
  ]);
  return { unread, open };
}
