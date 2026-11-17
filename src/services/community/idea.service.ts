import type { IdeaStatus, Prisma } from '@prisma/client';
import { AppError, badRequest, notFound } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../auth.service';
import { getContent } from './content.service';

// ════════════════════════════════════════════════════════════════════
//  ไอเดีย + ❤ ถูกใจ (P8 · ข้อ 5.12)
//  - ทุกคนเห็นไอเดียของทุกคน → ชื่อผู้เขียนอ่านด้วย select { name } เท่านั้น (ห้าม include ทั้งแถว — อีเมล/uiPrefs รั่ว)
//  - ❤ คนละครั้ง: IdeaLike (PK ideaId+userId) + likeCount สำเนา แก้คู่กันใน transaction
//    กดซ้ำพร้อมกัน → createMany skipDuplicates ได้ count 0 → ไม่บวกซ้ำ
//  - เสนอแล้วนับว่าถูกใจของตัวเองเลย (1 ❤) · แก้/ลบได้เฉพาะตอน "รอพิจารณา"
//  - เรียง: ยังเปิดอยู่ (รอพิจารณา/กำลังทำ) ก่อน แล้วตาม ❤ หรือใหม่สุด — เรียงในหน่วยความจำ (ไอเดียมีไม่กี่ร้อย)
// ════════════════════════════════════════════════════════════════════

export const IDEA_STATUSES: IdeaStatus[] = ['PENDING', 'IN_PROGRESS', 'DONE', 'DECLINED'];
const OPEN = new Set<IdeaStatus>(['PENDING', 'IN_PROGRESS']);
const DAILY_LIMIT = 5;

export type IdeaSort = 'top' | 'new';
export type IdeaQuery = { status?: IdeaStatus; mine?: boolean; sort?: IdeaSort; skip?: number; take?: number };

const ROW_SELECT = {
  id: true,
  authorId: true,
  title: true,
  body: true,
  status: true,
  reply: true,
  repliedAt: true,
  likeCount: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.IdeaSelect;

type IdeaRowDb = Prisma.IdeaGetPayload<{ select: typeof ROW_SELECT }> & { author: { name: string | null; email?: string } };

const displayName = (name: string | null | undefined) => name?.trim() || 'สมาชิก';

function toRow(i: IdeaRowDb, viewerId: number, liked: boolean, admin: boolean) {
  return {
    id: i.id,
    title: i.title,
    body: i.body,
    status: i.status,
    reply: i.reply,
    repliedAt: i.repliedAt,
    likeCount: i.likeCount,
    liked,
    mine: i.authorId === viewerId,
    authorName: displayName(i.author.name),
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    // หลังบ้านเห็นอีเมลผู้เขียน (ไว้ทักถามรายละเอียด)
    ...(admin ? { authorId: i.authorId, authorEmail: i.author.email ?? null } : {}),
  };
}
export type IdeaRow = ReturnType<typeof toRow>;

async function loadRows(viewer: AuthUser, ids: number[], admin: boolean): Promise<IdeaRow[]> {
  if (!ids.length) return [];
  const [rows, likes] = await Promise.all([
    prisma.idea.findMany({
      where: { id: { in: ids } },
      select: { ...ROW_SELECT, author: { select: admin ? { name: true, email: true } : { name: true } } },
    }),
    prisma.ideaLike.findMany({ where: { userId: viewer.id, ideaId: { in: ids } }, select: { ideaId: true } }),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const liked = new Set(likes.map((l) => l.ideaId));
  return ids.filter((id) => byId.has(id)).map((id) => toRow(byId.get(id)! as IdeaRowDb, viewer.id, liked.has(id), admin));
}

export async function listIdeas(viewer: AuthUser, q: IdeaQuery, opts: { admin?: boolean } = {}) {
  const admin = !!opts.admin;
  const base: Prisma.IdeaWhereInput = q.mine ? { authorId: viewer.id } : {};
  const [lite, grouped, content] = await Promise.all([
    prisma.idea.findMany({ where: { ...base, ...(q.status ? { status: q.status } : {}) }, select: { id: true, status: true, likeCount: true, createdAt: true } }),
    // ตัวเลขบนชิปสถานะ (ไม่ขึ้นกับสถานะที่เลือกอยู่)
    prisma.idea.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    getContent(),
  ]);
  const sort = q.sort ?? 'top';
  lite.sort((a, b) => {
    if (!q.status) {
      const oa = OPEN.has(a.status) ? 0 : 1;
      const ob = OPEN.has(b.status) ? 0 : 1;
      if (oa !== ob) return oa - ob;
    }
    if (sort === 'top' && a.likeCount !== b.likeCount) return b.likeCount - a.likeCount;
    return +b.createdAt - +a.createdAt || b.id - a.id;
  });
  const skip = q.skip ?? 0;
  const take = q.take ?? 20;
  const counts = Object.fromEntries(IDEA_STATUSES.map((s) => [s, 0])) as Record<IdeaStatus, number>;
  for (const g of grouped) counts[g.status] = g._count._all;
  return {
    total: lite.length,
    counts,
    nowBuilding: content.nowBuilding,
    items: await loadRows(
      viewer,
      lite.slice(skip, skip + take).map((i) => i.id),
      admin,
    ),
  };
}

async function oneRow(viewer: AuthUser, id: number, admin = false) {
  const [row] = await loadRows(viewer, [id], admin);
  if (!row) throw notFound('ไม่พบไอเดีย');
  return row;
}

export async function createIdea(user: AuthUser, input: { title: string; body?: string | null }) {
  const since = new Date(Date.now() - 24 * 3600_000);
  const today = await prisma.idea.count({ where: { authorId: user.id, createdAt: { gte: since } } });
  if (today >= DAILY_LIMIT) throw new AppError(429, `เสนอได้วันละ ${DAILY_LIMIT} ไอเดีย พรุ่งนี้มาเสนอต่อได้`);
  const idea = await prisma.idea.create({
    data: {
      authorId: user.id,
      title: input.title,
      body: input.body?.trim() || null,
      likeCount: 1,
      likes: { create: { userId: user.id } },
    },
  });
  return oneRow(user, idea.id);
}

/** ของตัวเอง + ยัง "รอพิจารณา" เท่านั้น (ทีมงานรับเรื่องแล้วห้ามเปลี่ยนเนื้อหา — คนอื่นกด ❤ ไปตามเนื้อหาเดิม) */
async function ownPending(user: AuthUser, id: number) {
  const idea = await prisma.idea.findUnique({ where: { id }, select: { authorId: true, status: true } });
  if (!idea || idea.authorId !== user.id) throw notFound('ไม่พบไอเดีย');
  if (idea.status !== 'PENDING') throw badRequest('ทีมงานรับเรื่องไปแล้ว แก้ไม่ได้ พิมพ์บอกในไอเดียใหม่ได้');
}

export async function updateIdea(user: AuthUser, id: number, input: { title?: string; body?: string | null }) {
  await ownPending(user, id);
  await prisma.idea.update({
    where: { id },
    data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.body !== undefined ? { body: input.body?.trim() || null } : {}) },
  });
  return oneRow(user, id);
}

export async function removeIdea(user: AuthUser, id: number) {
  await ownPending(user, id);
  await prisma.idea.delete({ where: { id } });
}

export async function setLike(user: AuthUser, id: number, liked: boolean) {
  const likeCount = await prisma.$transaction(async (tx) => {
    // ⚠️ ล็อกแถวไอเดียก่อนเสมอ → ❤ ของไอเดียเดียวกันเข้าคิวทีละคำขอ
    // (ไม่ล็อกก่อน = MySQL deadlock: FK ของ IdeaLike ถือ S lock แถว Idea ไว้ แล้ว 2 คำขอแย่งกันอัปเกรดเป็น X ตอนบวก likeCount — เจอจริงในเทส)
    const found = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM \`Idea\` WHERE id = ${id} FOR UPDATE`;
    if (!found.length) throw notFound('ไม่พบไอเดีย');
    if (liked) {
      const r = await tx.ideaLike.createMany({ data: [{ ideaId: id, userId: user.id }], skipDuplicates: true });
      if (r.count) await tx.idea.update({ where: { id }, data: { likeCount: { increment: 1 } } });
    } else {
      const r = await tx.ideaLike.deleteMany({ where: { ideaId: id, userId: user.id } });
      if (r.count) await tx.idea.update({ where: { id }, data: { likeCount: { decrement: 1 } } });
    }
    return (await tx.idea.findUniqueOrThrow({ where: { id }, select: { likeCount: true } })).likeCount;
  });
  return { likeCount, liked };
}

// ── หลังบ้าน ─────────────────────────────────────────────────────────

export async function adminUpdateIdea(
  admin: AuthUser,
  id: number,
  input: { status?: IdeaStatus; reply?: string | null; title?: string; body?: string | null },
) {
  const cur = await prisma.idea.findUnique({ where: { id }, select: { reply: true } });
  if (!cur) throw notFound('ไม่พบไอเดีย');
  const reply = input.reply !== undefined ? input.reply?.trim() || null : undefined;
  await prisma.idea.update({
    where: { id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body?.trim() || null } : {}),
      // ตอบใหม่/แก้คำตอบ = เวลาตอบล่าสุด · ลบคำตอบ = ไม่มีเวลา
      ...(reply !== undefined && reply !== cur.reply ? { reply, repliedAt: reply ? new Date() : null } : {}),
    },
  });
  return oneRow(admin, id, true);
}

export async function adminRemoveIdea(id: number) {
  const r = await prisma.idea.deleteMany({ where: { id } });
  if (!r.count) throw notFound('ไม่พบไอเดีย');
}

/** ตัวเลขแดงที่เมนู "ไอเดีย" หลังบ้าน = ไอเดียที่ยังไม่ได้ตัดสินใจ */
export const pendingIdeaCount = () => prisma.idea.count({ where: { status: 'PENDING' } });
