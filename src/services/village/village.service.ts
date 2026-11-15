import { Prisma } from '@prisma/client';
import { AppError, badRequest, notFound } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { statusOf } from '../../lib/water';
import { farmsVisitedBy, publishFarm, publishToUser, recheckFarmVisitors, refreshFarmProfile } from '../../lib/realtime';
import type { AuthUser } from '../auth.service';
import { canViewFarm, isJoined } from './access';

// ════════════════════════════════════════════════════════════════════
//  หมู่บ้านฟาร์ม (P9) — ย้ายจาก v1 Phase 23 มาเป็นกติกา v2
//
//   1. เข้าร่วมหมู่บ้าน (เลือกเอง) → อยู่ในสมุดรายชื่อ · ขอ/อนุมัติสิทธิ์เข้าชมฟาร์ม
//   2. ฟาร์มที่เดินได้: กล่องปูจริง + ของตกแต่ง + จดหมาย + สมุดฟาร์ม (ค่าน้ำ)
//   3. จดหมายจากผู้มาเยือน + คำตอบของเจ้าของ
//
//  ⚠️ ไฟล์นี้ "อ่านข้ามผู้ใช้" — ทุก select ของ User ใช้ PUBLIC_USER ที่กำหนดฟิลด์เอง
//     (passwordHash / uiPrefs / อีเมล ห้ามรั่ว) · ข้อมูลปูส่งแค่ "สิ่งที่มองเห็นจากการยืนดูกล่อง"
//     ไม่มีต้นทุน/ล็อต/คนขาย/ลูกค้าที่จอง/โน้ต
// ════════════════════════════════════════════════════════════════════

const PUBLIC_USER = { id: true, name: true, avatarUrl: true, farmAvatar: true } satisfies Prisma.UserSelect;

/** สิทธิ์ของ "เรา" ต่อฟาร์มของคนนั้น */
export type VillageAccessState = 'SELF' | 'APPROVED' | 'OPEN' | 'PENDING' | 'DENIED' | 'NONE';

const DAY_MS = 86_400_000;
/** จดหมายที่ 1 คนฝากค้างไว้ในฟาร์มหนึ่งได้ (กันสแปม/รกฟาร์ม) */
const MAX_LETTERS_PER_AUTHOR = 20;

const notJoined = () => new AppError(403, 'ยังไม่ได้เข้าร่วมหมู่บ้าน');

async function mustJoin(user: AuthUser) {
  if (!(await isJoined(user.id))) throw notJoined();
}

/** 404 (ไม่ใช่ 403) ถ้าเข้าไม่ได้ — กันไล่เดา id ฟาร์ม */
async function mustView(user: AuthUser, systemId: number) {
  if (!(await canViewFarm(user, systemId))) throw notFound('ไม่พบฟาร์มนี้ หรือยังไม่ได้รับอนุญาตให้เข้าชม');
}

async function ownSystem(user: AuthUser, systemId: number) {
  const s = await prisma.crabSystem.findUnique({ where: { id: systemId }, select: { ownerId: true } });
  if (!s || s.ownerId !== user.id) throw notFound('ไม่พบฟาร์มนี้');
}

async function systemIdsOf(ownerId: number) {
  return (await prisma.crabSystem.findMany({ where: { ownerId }, select: { id: true } })).map((s) => s.id);
}

// ─────────────────────────────────────────────────────────────────────
//  1. ตัวเรา + สมุดรายชื่อ + สิทธิ์
// ─────────────────────────────────────────────────────────────────────

/** หน้าแรกของหมู่บ้าน: เข้าร่วมแล้วหรือยัง · ฟาร์มของเรา · คำขอเข้า/ออก · จดหมายใหม่ */
export async function getMyVillage(user: AuthUser) {
  const [me, systems, given, asked, letters, replies] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { ...PUBLIC_USER, villageJoinedAt: true } }),
    prisma.crabSystem.findMany({ where: { ownerId: user.id }, select: { id: true, name: true, villageOpen: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    prisma.farmAccess.findMany({
      where: { ownerId: user.id, OR: [{ status: 'PENDING' }, { status: 'APPROVED', revokedAt: null }] },
      select: { id: true, status: true, message: true, requestedAt: true, visitor: { select: PUBLIC_USER } },
      orderBy: { requestedAt: 'desc' },
    }),
    prisma.farmAccess.findMany({
      where: { visitorId: user.id, status: 'PENDING' },
      select: { id: true, ownerId: true, requestedAt: true },
    }),
    // จดหมายใหม่ในฟาร์มเรา
    prisma.farmLetter.findMany({
      where: { deletedAt: null, readAt: null, system: { ownerId: user.id } },
      select: { id: true, systemId: true, body: true, mood: true, createdAt: true, system: { select: { name: true } }, author: { select: PUBLIC_USER } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    // เจ้าของฟาร์มตอบจดหมายของเราแล้ว
    prisma.farmLetter.findMany({
      where: { deletedAt: null, authorId: user.id, reply: { not: null }, authorReadReplyAt: null },
      select: {
        id: true,
        systemId: true,
        body: true,
        reply: true,
        repliedAt: true,
        system: { select: { name: true, owner: { select: PUBLIC_USER } } },
      },
      orderBy: { repliedAt: 'desc' },
      take: 20,
    }),
  ]);
  if (!me) throw notFound('ไม่พบผู้ใช้');
  const { villageJoinedAt, ...pub } = me;
  return {
    me: pub,
    joined: villageJoinedAt != null,
    systems,
    requests: given.filter((g) => g.status === 'PENDING'),
    visitors: given.filter((g) => g.status === 'APPROVED'),
    outgoing: asked,
    letters: letters.map(({ system, ...l }) => ({ ...l, systemName: system.name })),
    replies: replies.map(({ system, ...l }) => ({ ...l, systemName: system.name, owner: system.owner })),
  };
}

/**
 * เข้าร่วม / ออกจากหมู่บ้าน
 * ออก = หายจากสมุดรายชื่อ · คนที่ยืนอยู่ในฟาร์มเราถูกเชิญออก · เราถูกพาออกจากฟาร์มคนอื่น
 * (สิทธิ์ที่อนุมัติไว้ไม่ลบ — กลับมาเข้าร่วมใหม่แล้วใช้ต่อได้)
 */
export async function setJoined(user: AuthUser, joined: boolean) {
  await prisma.user.update({ where: { id: user.id }, data: { villageJoinedAt: joined ? new Date() : null } });
  if (!joined) {
    recheckFarmVisitors(await systemIdsOf(user.id));
    recheckFarmVisitors(farmsVisitedBy(user.id), user.id);
  }
  return { joined };
}

/** สมุดรายชื่อ: เฉพาะคนที่เข้าร่วมหมู่บ้านแล้ว (ตัวเราต้องเข้าร่วมก่อนถึงจะเห็นคนอื่น — แลกกันเห็น) */
export async function listVillageUsers(user: AuthUser) {
  await mustJoin(user);
  const [users, grants] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, villageJoinedAt: { not: null } },
      select: {
        ...PUBLIC_USER,
        crabSystems: { select: { id: true, name: true, villageOpen: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
      orderBy: [{ villageJoinedAt: 'asc' }, { id: 'asc' }],
      take: 500,
    }),
    prisma.farmAccess.findMany({ where: { visitorId: user.id }, select: { id: true, ownerId: true, status: true, revokedAt: true } }),
  ]);
  const grantOf = new Map(grants.map((g) => [g.ownerId, g]));
  return users.map(({ crabSystems, ...u }) => {
    const g = grantOf.get(u.id);
    let access: VillageAccessState = 'NONE';
    if (u.id === user.id) access = 'SELF';
    else if (g?.status === 'APPROVED' && g.revokedAt == null) access = 'APPROVED';
    else if (g?.status === 'PENDING') access = 'PENDING';
    else if (g?.status === 'DENIED' && g.revokedAt == null) access = 'DENIED';
    // ระบบที่เปิดให้ทุกคน เข้าได้ทันทีแม้ยังไม่ได้ขอ (ระบบอื่นของคนเดียวกันอาจยังปิด)
    const systems = crabSystems.map((s) => ({
      ...s,
      canVisit: access === 'SELF' || access === 'APPROVED' || s.villageOpen,
    }));
    if (access === 'NONE' && systems.some((s) => s.villageOpen)) access = 'OPEN';
    return { ...u, systems, access, accessId: g?.id ?? null };
  });
}

/** หน้าตาตัวละคร (zod ใน route ตรวจคีย์/สี hex แล้ว — ค่าเหล่านี้ถูกวาดลง SVG ที่เครื่องคนอื่น) */
export async function updateFarmAvatar(user: AuthUser, config: Record<string, unknown>) {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { farmAvatar: config as Prisma.InputJsonValue },
    select: PUBLIC_USER,
  });
  refreshFarmProfile(user.id, { name: updated.name, avatarUrl: updated.avatarUrl, farmAvatar: updated.farmAvatar });
  return updated;
}

/** ขอเข้าชมฟาร์ม (ทุกระบบของเจ้าของ) */
export async function requestAccess(user: AuthUser, ownerId: number, message?: string | null) {
  if (ownerId === user.id) throw badRequest('ฟาร์มของตัวเองเข้าได้เลย ไม่ต้องขอ');
  await mustJoin(user);
  if (!(await isJoined(ownerId))) throw notFound('ไม่พบผู้ใช้คนนี้ในหมู่บ้าน');
  const existing = await prisma.farmAccess.findUnique({
    where: { ownerId_visitorId: { ownerId, visitorId: user.id } },
    select: { id: true, status: true, revokedAt: true, requestedAt: true },
  });
  if (existing?.status === 'APPROVED' && existing.revokedAt == null) return { id: existing.id, status: existing.status, alreadyApproved: true };
  // ขอซ้ำรัว ๆ หลังถูกปฏิเสธ = รบกวนเจ้าของ → เว้น 1 วัน
  if (existing?.status === 'DENIED' && existing.revokedAt == null && Date.now() - existing.requestedAt.getTime() < DAY_MS) {
    throw new AppError(429, 'เจ้าของฟาร์มยังไม่อนุญาต ลองขอใหม่พรุ่งนี้นะ');
  }
  const row = await prisma.farmAccess.upsert({
    where: { ownerId_visitorId: { ownerId, visitorId: user.id } },
    create: { ownerId, visitorId: user.id, message: message ?? null },
    update: { status: 'PENDING', message: message ?? null, requestedAt: new Date(), decidedAt: null, revokedAt: null },
    select: { id: true, status: true },
  });
  publishToUser(ownerId, { t: 'village.inbox' });
  return { ...row, alreadyApproved: false };
}

/** เจ้าของกดอนุญาต / ไม่อนุญาต */
export async function decideAccess(user: AuthUser, id: number, approve: boolean) {
  const a = await prisma.farmAccess.findUnique({ where: { id }, select: { ownerId: true, visitorId: true, status: true } });
  if (!a || a.ownerId !== user.id) throw notFound('ไม่พบคำขอนี้');
  await prisma.farmAccess.update({
    where: { id },
    data: { status: approve ? 'APPROVED' : 'DENIED', decidedAt: new Date(), revokedAt: null },
  });
  publishToUser(a.visitorId, { t: 'village.inbox' });
  return { ok: true };
}

/** ถอนสิทธิ์ (เจ้าของ) หรือยกเลิกคำขอตัวเอง (ผู้ขอ) — คนที่ยืนอยู่ในฟาร์มถูกพาออกทันที */
export async function revokeAccess(user: AuthUser, id: number) {
  const a = await prisma.farmAccess.findUnique({ where: { id }, select: { ownerId: true, visitorId: true } });
  if (!a || (a.ownerId !== user.id && a.visitorId !== user.id)) throw notFound('ไม่พบคำขอนี้');
  // revokedAt ≠ null = ไม่ติดเงื่อนไข "เว้น 1 วัน" (ถอนแล้วขอใหม่ได้เลย — คนละเรื่องกับถูกปฏิเสธ)
  await prisma.farmAccess.update({ where: { id }, data: { status: 'DENIED', revokedAt: new Date(), decidedAt: new Date() } });
  recheckFarmVisitors(await systemIdsOf(a.ownerId), a.visitorId);
  return { ok: true };
}

/** ⚠ ของเมนูหมู่บ้าน (attention.service) */
export async function villageAttention(userId: number) {
  const [requests, letters, replies] = await Promise.all([
    prisma.farmAccess.count({ where: { ownerId: userId, status: 'PENDING' } }),
    prisma.farmLetter.count({ where: { deletedAt: null, readAt: null, system: { ownerId: userId } } }),
    prisma.farmLetter.count({ where: { deletedAt: null, authorId: userId, reply: { not: null }, authorReadReplyAt: null } }),
  ]);
  return { requests, letters, replies };
}

// ─────────────────────────────────────────────────────────────────────
//  2. ฟาร์มที่เดินได้
// ─────────────────────────────────────────────────────────────────────

const LETTER_SELECT = {
  id: true,
  x: true,
  y: true,
  body: true,
  mood: true,
  reply: true,
  repliedAt: true,
  readAt: true,
  createdAt: true,
  authorId: true,
  author: { select: PUBLIC_USER },
} satisfies Prisma.FarmLetterSelect;

function lettersWhere(user: AuthUser, systemId: number, isOwner: boolean): Prisma.FarmLetterWhereInput {
  // เจ้าของเห็นทุกฉบับ · แขกเห็นเฉพาะของตัวเอง (+ คำตอบ)
  return { systemId, deletedAt: null, ...(isOwner ? {} : { authorId: user.id }) };
}

/** ทุกอย่างที่หน้าฟาร์มต้องใช้ในคำขอเดียว */
export async function getFarm(user: AuthUser, systemId: number) {
  await mustView(user, systemId);
  const system = await prisma.crabSystem.findUniqueOrThrow({
    where: { id: systemId },
    select: { id: true, name: true, layout: true, ownerId: true, villageOpen: true, owner: { select: PUBLIC_USER } },
  });
  const isOwner = system.ownerId === user.id;
  const [boxes, crabs, decor, letters] = await Promise.all([
    prisma.crabBox.findMany({
      where: { systemId, active: true },
      orderBy: [{ side: 'asc' }, { row: 'asc' }, { col: 'asc' }],
      select: { id: true, side: true, row: true, col: true, code: true },
    }),
    // ปูที่ยังเลี้ยงอยู่ — เกณฑ์เดียวกับผังในหน้ากล่องปู (ตัวเลขต้องตรงกัน)
    prisma.crab.findMany({
      where: { systemId, status: 'ALIVE', deletedAt: null, boxId: { not: null } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        boxId: true,
        name: true,
        type: true,
        cableTieColor: true,
        lastWeightG: true,
        lastPct: true,
        lastPhotoUrl: true,
        lastCheckedAt: true,
        // วันรับเข้าใช้นับ "เลี้ยงมา N วัน" เท่านั้น — ไม่ส่งล็อต/ต้นทุนออกไป
        lot: { select: { receivedAt: true } },
      },
    }),
    prisma.farmDecor.findMany({
      where: { systemId },
      orderBy: { id: 'asc' },
      select: { id: true, kind: true, x: true, y: true, z: true, rot: true, scale: true, flip: true, variant: true },
    }),
    prisma.farmLetter.findMany({ where: lettersWhere(user, systemId, isOwner), select: LETTER_SELECT, orderBy: { id: 'asc' } }),
  ]);
  const now = Date.now();
  const byBox = new Map<number, unknown[]>();
  for (const { lot, boxId, lastWeightG, ...c } of crabs) {
    const list = byBox.get(boxId!) ?? [];
    list.push({ ...c, lastWeightG: lastWeightG?.toNumber() ?? null, days: Math.max(0, Math.floor((now - lot.receivedAt.getTime()) / DAY_MS)) });
    byBox.set(boxId!, list);
  }
  const { ownerId, ...sys } = system;
  return {
    system: { ...sys, ownerId },
    boxes: boxes.map((b) => ({ ...b, crabs: byBox.get(b.id) ?? [] })),
    decor,
    letters,
    isOwner,
  };
}

/** เปิด/ปิดฟาร์มให้เพื่อนบ้านทุกคน — ปิดแล้วคนที่เข้ามาเพราะสวิตช์นี้ถูกพาออก */
export async function setVillageOpen(user: AuthUser, systemId: number, open: boolean) {
  await ownSystem(user, systemId);
  await prisma.crabSystem.update({ where: { id: systemId }, data: { villageOpen: open } });
  if (!open) recheckFarmVisitors([systemId]);
  return { villageOpen: open };
}

/** สมุดฟาร์ม (แท่นหนังสือ): ค่าน้ำ — ข้อมูลการเลี้ยงที่แขกอ่านได้ (ไม่มีโน้ตที่เจ้าของพิมพ์) */
export async function getLogbook(user: AuthUser, systemId: number) {
  await mustView(user, systemId);
  const [params, tests] = await Promise.all([
    prisma.waterParam.findMany({
      where: { systemId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, key: true, name: true, unit: true, color: true, min: true, max: true },
    }),
    prisma.waterTest.findMany({
      where: { systemId },
      orderBy: { testedAt: 'desc' },
      take: 10,
      select: { id: true, testedAt: true, readings: { select: { paramId: true, value: true } } },
    }),
  ]);
  const p = params.map((x) => ({ ...x, min: x.min?.toNumber() ?? null, max: x.max?.toNumber() ?? null }));
  const byId = new Map(p.map((x) => [x.id, x]));
  return {
    params: p,
    tests: tests.map((t) => ({
      id: t.id,
      testedAt: t.testedAt,
      values: t.readings
        .filter((r) => byId.has(r.paramId))
        .map((r) => {
          const v = r.value.toNumber();
          const prm = byId.get(r.paramId)!;
          return { paramId: r.paramId, value: v, status: statusOf(v, prm.min, prm.max) };
        }),
    })),
  };
}

export type DecorInput = { kind: string; x: number; y: number; z: number; rot: number; scale: number; flip: boolean; variant?: string | null };

/** บันทึกผังตกแต่งทั้งชุด (ลากวางหลายชิ้นแล้วกดบันทึกทีเดียว — แทนที่ของเดิมทั้งหมด) */
export async function saveDecor(user: AuthUser, systemId: number, items: DecorInput[]) {
  await ownSystem(user, systemId);
  await prisma.$transaction([
    prisma.farmDecor.deleteMany({ where: { systemId } }),
    prisma.farmDecor.createMany({
      data: items.map((it) => ({ systemId, kind: it.kind, x: it.x, y: it.y, z: it.z, rot: it.rot, scale: it.scale, flip: it.flip, variant: it.variant ?? null })),
    }),
  ]);
  // แค่เคาะ — ไม่ส่งผังไปกับ event (ผัง 300 ชิ้นใหญ่เกิน)
  publishFarm(systemId, { t: 'village.decor', systemId });
  return prisma.farmDecor.findMany({
    where: { systemId },
    orderBy: { id: 'asc' },
    select: { id: true, kind: true, x: true, y: true, z: true, rot: true, scale: true, flip: true, variant: true },
  });
}

// ─────────────────────────────────────────────────────────────────────
//  3. จดหมาย
// ─────────────────────────────────────────────────────────────────────

export async function listLetters(user: AuthUser, systemId: number) {
  await mustView(user, systemId);
  const s = await prisma.crabSystem.findUniqueOrThrow({ where: { id: systemId }, select: { ownerId: true } });
  return prisma.farmLetter.findMany({ where: lettersWhere(user, systemId, s.ownerId === user.id), select: LETTER_SELECT, orderBy: { id: 'asc' } });
}

export async function writeLetter(user: AuthUser, systemId: number, input: { x: number; y: number; body: string; mood?: string | null }) {
  await mustView(user, systemId);
  const s = await prisma.crabSystem.findUniqueOrThrow({ where: { id: systemId }, select: { ownerId: true } });
  if (s.ownerId === user.id) throw badRequest('ฟาร์มของตัวเองไม่ต้องฝากจดหมาย');
  const mine = await prisma.farmLetter.count({ where: { systemId, authorId: user.id, deletedAt: null } });
  if (mine >= MAX_LETTERS_PER_AUTHOR) throw badRequest(`ฝากจดหมายไว้ในฟาร์มนี้ครบ ${MAX_LETTERS_PER_AUTHOR} ฉบับแล้ว`);
  const letter = await prisma.farmLetter.create({
    data: { systemId, authorId: user.id, x: input.x, y: input.y, body: input.body, mood: input.mood ?? null },
    select: LETTER_SELECT,
  });
  publishToUser(s.ownerId, { t: 'village.inbox' });
  publishFarm(systemId, { t: 'village.letter', systemId });
  return letter;
}

async function ownLetter(id: number) {
  const l = await prisma.farmLetter.findUnique({ where: { id }, select: { systemId: true, authorId: true, deletedAt: true, system: { select: { ownerId: true } } } });
  if (!l || l.deletedAt) throw notFound('ไม่พบจดหมายฉบับนี้');
  return l;
}

/** เจ้าของฟาร์มตอบ (ตอบซ้ำ = แก้คำตอบ · ผู้เขียนเห็น ⚠ อีกครั้ง) */
export async function replyLetter(user: AuthUser, id: number, reply: string) {
  const l = await ownLetter(id);
  if (l.system.ownerId !== user.id) throw notFound('ไม่พบจดหมายฉบับนี้');
  await prisma.farmLetter.update({ where: { id }, data: { reply, repliedAt: new Date(), readAt: new Date(), authorReadReplyAt: null } });
  publishToUser(l.authorId, { t: 'village.inbox' });
  publishFarm(l.systemId, { t: 'village.letter', systemId: l.systemId });
  return { ok: true };
}

/** เจ้าของเปิดอ่าน — ทีละฉบับ หรือทั้งฟาร์ม */
export async function markLetterRead(user: AuthUser, id: number) {
  const l = await ownLetter(id);
  if (l.system.ownerId === user.id) {
    await prisma.farmLetter.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });
  } else if (l.authorId === user.id) {
    // ผู้เขียนเปิดดูคำตอบแล้ว
    await prisma.farmLetter.updateMany({ where: { id, reply: { not: null }, authorReadReplyAt: null }, data: { authorReadReplyAt: new Date() } });
  } else throw notFound('ไม่พบจดหมายฉบับนี้');
  return { ok: true };
}

export async function markAllRead(user: AuthUser, systemId: number) {
  await ownSystem(user, systemId);
  const r = await prisma.farmLetter.updateMany({ where: { systemId, deletedAt: null, readAt: null }, data: { readAt: new Date() } });
  return { marked: r.count };
}

/** ลบ: ผู้เขียนลบของตัวเอง / เจ้าของลบอะไรก็ได้ในฟาร์มตัวเอง */
export async function deleteLetter(user: AuthUser, id: number) {
  const l = await ownLetter(id);
  if (l.authorId !== user.id && l.system.ownerId !== user.id) throw notFound('ไม่พบจดหมายฉบับนี้');
  await prisma.farmLetter.update({ where: { id }, data: { deletedAt: new Date() } });
  publishFarm(l.systemId, { t: 'village.letter', systemId: l.systemId });
  return { ok: true };
}
