import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/http';
import { assertOwnership, canViewFarm, isAdmin } from '../lib/scope';
import { assertCanEditSystem, assertCanViewFarm } from '../middleware/auth';
import { publishFarm, publishToUser, revokeFarmAccess } from '../lib/realtime';
import type { AuthUser } from './auth.service';

// ════════════════════════════════════════════════════════════════════
//  H. หมู่บ้านฟาร์ม (Phase 23)
//
//  บริการ 3 อย่าง:
//   1. สมุดรายชื่อผู้ใช้ + ขอ/อนุมัติสิทธิ์เยี่ยมชมฟาร์ม (FarmAccess)
//   2. snapshot ฟาร์มสำหรับเดินเล่น (กล่องปูจริง + ของตกแต่ง + จดหมาย)
//   3. จดหมายที่ผู้มาเยือนฝากไว้ + คำตอบของเจ้าของ
//
//  ⚠️ ไฟล์นี้เป็น "การอ่านข้ามผู้ใช้" ที่แรกของแอป — ทุก select ต้องระบุ field ชัดเจน
//     ห้ามใช้ include/spread ทั้งแถวของ User เด็ดขาด (passwordHash / uiPrefs / lineId จะรั่ว)
// ════════════════════════════════════════════════════════════════════

/** field ที่ปลอดภัยจะให้ผู้ใช้คนอื่นเห็น — ใช้ที่เดียวทุกที่ที่ต้อง join User */
const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
  farmAvatar: true,
} as const;

export type VillageAccessState =
  | 'SELF' // ฟาร์มของเราเอง
  | 'APPROVED' // ได้รับอนุญาตแล้ว เข้าได้เลย
  | 'PENDING' // ขอไปแล้ว รอเจ้าของกด
  | 'DENIED' // ถูกปฏิเสธ (ขอใหม่ได้)
  | 'OPEN' // เจ้าของเปิดฟาร์มให้ทุกคน
  | 'NONE'; // ยังไม่เคยขอ

// ─────────────────────────────────────────────────────────────────────
//  1. สมุดรายชื่อ + สิทธิ์
// ─────────────────────────────────────────────────────────────────────

/** รายชื่อผู้ใช้ทั้งหมดในระบบ (ข้อ 1.3) พร้อมสถานะสิทธิ์เยี่ยมชมของ "เรา" ต่อคนนั้น */
export async function listVillageUsers(user: AuthUser) {
  const [users, grants] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      select: {
        ...PUBLIC_USER_SELECT,
        // email เป็นข้อมูลส่วนตัว — ให้เฉพาะ admin (คนทั่วไปเห็นแค่ชื่อ+รูป)
        email: isAdmin(user),
        systems: {
          where: { status: 'ACTIVE' },
          select: { id: true, name: true, villageOpen: true },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    // สิทธิ์ที่ "เรา" มีต่อฟาร์มของแต่ละคน (เราเป็น visitor)
    prisma.farmAccess.findMany({
      where: { visitorId: user.id },
      select: { id: true, ownerId: true, status: true, revokedAt: true },
    }),
  ]);

  const grantByOwner = new Map(grants.map((g) => [g.ownerId, g]));
  const admin = isAdmin(user);

  return users.map((u) => {
    const g = grantByOwner.get(u.id);
    const anyOpen = u.systems.some((s) => s.villageOpen);
    let access: VillageAccessState = 'NONE';
    if (u.id === user.id) access = 'SELF';
    else if (admin) access = 'APPROVED'; // admin เข้าได้ทุกฟาร์ม (god mode)
    else if (g?.status === 'APPROVED' && g.revokedAt == null) access = 'APPROVED';
    else if (anyOpen) access = 'OPEN';
    else if (g?.status === 'PENDING') access = 'PENDING';
    else if (g?.status === 'DENIED') access = 'DENIED';

    return {
      id: u.id,
      name: u.name,
      email: u.email || null, // false → Prisma คืน undefined; normalize เป็น null
      avatarUrl: u.avatarUrl,
      farmAvatar: u.farmAvatar,
      systems: u.systems,
      access,
      /** กดเข้าฟาร์มได้เลยไหม (ไม่ต้องขอก่อน) */
      canVisit: access === 'SELF' || access === 'APPROVED' || access === 'OPEN',
      accessId: g?.id ?? null,
    };
  });
}

/** ข้อมูลหมู่บ้านของ "ตัวเอง" — ฟาร์มที่มี + คำขอเข้า/ออก + หน้าตาตัวละคร */
export async function getMyVillage(user: AuthUser) {
  const [me, systems, given, received] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: PUBLIC_USER_SELECT }),
    prisma.crabSystem.findMany({
      where: { ownerId: user.id },
      select: { id: true, name: true, villageOpen: true },
      orderBy: { id: 'asc' },
    }),
    prisma.farmAccess.findMany({
      where: { ownerId: user.id },
      select: {
        id: true,
        status: true,
        message: true,
        requestedAt: true,
        decidedAt: true,
        revokedAt: true,
        visitor: { select: PUBLIC_USER_SELECT },
      },
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
    }),
    prisma.farmAccess.findMany({
      where: { visitorId: user.id },
      select: {
        id: true,
        status: true,
        message: true,
        requestedAt: true,
        decidedAt: true,
        revokedAt: true,
        owner: { select: PUBLIC_USER_SELECT },
      },
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
    }),
  ]);
  if (!me) throw notFound('ไม่พบผู้ใช้นี้');
  return { me, systems, grantsGiven: given, grantsReceived: received };
}

/** เปลี่ยนหน้าตาตัวละคร (ข้อ 1.5.5) */
export async function updateFarmAvatar(userId: number, config: Record<string, unknown>) {
  const updated = await prisma.user.update({
    where: { id: userId },
    // Json nullable: ส่ง object เสมอ (ไม่มีเคส null จาก route นี้) — แต่กันไว้ตาม normalizeSystemData
    data: { farmAvatar: (config as Prisma.InputJsonValue) ?? Prisma.DbNull },
    select: PUBLIC_USER_SELECT,
  });
  return updated;
}

/**
 * กล่องขาเข้า — ที่มาของทั้ง badge และป๊อปอัพ (ข้อ 1.4 / 1.5.4)
 * ⚠️ derive จากข้อมูลจริงล้วน ไม่มีตาราง notification แยก (ดูเหตุผลใน CLAUDE.md)
 *    ใช้ทั้งตอนเปิดแอป และตอน WebSocket หลุดแล้วต่อกลับ (backfill สิ่งที่พลาดไป)
 */
export async function getInbox(user: AuthUser) {
  const [pending, unreadLetters, unreadReplies] = await Promise.all([
    prisma.farmAccess.findMany({
      where: { ownerId: user.id, status: 'PENDING' },
      select: {
        id: true,
        message: true,
        requestedAt: true,
        visitor: { select: PUBLIC_USER_SELECT },
      },
      orderBy: { requestedAt: 'asc' },
    }),
    prisma.farmLetter.count({
      where: { deletedAt: null, readAt: null, system: { ownerId: user.id } },
    }),
    prisma.farmLetter.count({
      where: { deletedAt: null, authorId: user.id, reply: { not: null }, authorReadReplyAt: null },
    }),
  ]);
  return { pending, unreadLetters, unreadReplies };
}

/** ขออนุญาตเยี่ยมชมฟาร์มของคนอื่น (ข้อ 1.3) */
export async function requestAccess(user: AuthUser, ownerId: number, message?: string | null) {
  if (ownerId === user.id) throw new AppError(400, 'ไม่ต้องขอเข้าฟาร์มตัวเอง');
  const owner = await prisma.user.findFirst({
    where: { id: ownerId, active: true },
    select: { id: true },
  });
  if (!owner) throw notFound('ไม่พบผู้ใช้คนนี้');

  const existing = await prisma.farmAccess.findUnique({
    where: { ownerId_visitorId: { ownerId, visitorId: user.id } },
    select: { id: true, status: true, revokedAt: true },
  });
  // อนุมัติอยู่แล้วและยังไม่ถูกถอน → ไม่ต้องรบกวนเจ้าของซ้ำ
  if (existing?.status === 'APPROVED' && existing.revokedAt == null) {
    return { access: existing, alreadyApproved: true };
  }

  const access = await prisma.farmAccess.upsert({
    where: { ownerId_visitorId: { ownerId, visitorId: user.id } },
    create: { ownerId, visitorId: user.id, message: message ?? null, status: 'PENDING' },
    // ขอใหม่หลังถูกปฏิเสธ/ถอน → กลับเป็น PENDING และล้างผลตัดสินเดิม
    update: {
      status: 'PENDING',
      message: message ?? null,
      requestedAt: new Date(),
      decidedAt: null,
      revokedAt: null,
    },
    select: {
      id: true,
      status: true,
      message: true,
      requestedAt: true,
      visitor: { select: PUBLIC_USER_SELECT },
    },
  });

  // เด้งป๊อปอัพที่เครื่องเจ้าของทันที ไม่ว่าเขาจะอยู่หน้าไหน (ข้อ 1.4)
  publishToUser(ownerId, { t: 'village.request', access });
  return { access, alreadyApproved: false };
}

/** เจ้าของกดอนุมัติ/ปฏิเสธคำขอ (ข้อ 1.4) */
export async function decideAccess(user: AuthUser, accessId: number, approve: boolean) {
  const access = await prisma.farmAccess.findUnique({
    where: { id: accessId },
    select: { id: true, ownerId: true, visitorId: true },
  });
  if (!access) throw notFound('ไม่พบคำขอนี้');
  assertOwnership(user, access.ownerId);

  const updated = await prisma.farmAccess.update({
    where: { id: accessId },
    data: {
      status: approve ? 'APPROVED' : 'DENIED',
      decidedAt: new Date(),
      revokedAt: null,
    },
    select: {
      id: true,
      status: true,
      decidedAt: true,
      owner: { select: PUBLIC_USER_SELECT },
      visitor: { select: PUBLIC_USER_SELECT },
    },
  });

  const systemIds = await ownedSystemIdList(access.ownerId);
  publishToUser(access.visitorId, {
    t: 'village.access',
    ownerId: access.ownerId,
    systemIds,
    granted: approve,
  });
  return updated;
}

/** ถอนสิทธิ์ (เจ้าของ) หรือยกเลิกคำขอ (ผู้ขอ) — เตะคนที่ยืนอยู่ในฟาร์มออกทันที */
export async function revokeAccess(user: AuthUser, accessId: number) {
  const access = await prisma.farmAccess.findUnique({
    where: { id: accessId },
    select: { id: true, ownerId: true, visitorId: true },
  });
  if (!access) throw notFound('ไม่พบคำขอนี้');
  // เจ้าของถอนสิทธิ์ได้ / ผู้ขอยกเลิกคำขอตัวเองได้ / admin ได้หมด
  if (!isAdmin(user) && access.ownerId !== user.id && access.visitorId !== user.id) {
    throw notFound('ไม่พบคำขอนี้');
  }

  const updated = await prisma.farmAccess.update({
    where: { id: accessId },
    data: { status: 'DENIED', revokedAt: new Date(), decidedAt: new Date() },
    select: { id: true, status: true, revokedAt: true },
  });

  const systemIds = await ownedSystemIdList(access.ownerId);
  revokeFarmAccess(access.visitorId, systemIds, access.ownerId);
  return updated;
}

/** systemId ทั้งหมดของเจ้าของคนหนึ่ง (ใช้บอก client ว่าสิทธิ์ที่เพิ่งเปลี่ยนครอบคลุมห้องไหนบ้าง) */
async function ownedSystemIdList(ownerId: number): Promise<number[]> {
  const rows = await prisma.crabSystem.findMany({ where: { ownerId }, select: { id: true } });
  return rows.map((r) => r.id);
}

// ─────────────────────────────────────────────────────────────────────
//  2. snapshot ฟาร์ม (สำหรับเดินเล่น)
// ─────────────────────────────────────────────────────────────────────

/**
 * ข้อมูลทุกอย่างที่หน้าฟาร์มต้องใช้ ในคำขอเดียว
 * ⚠️ ไม่มีข้อมูลเชิงธุรกิจของปูเลย (ต้นทุน/ราคา/โน้ต) — หน้าหมู่บ้านคือ "สถานที่" ไม่ใช่หน้าข้อมูล
 *    แขกเห็นแค่ว่ากล่องไหนมีปูกี่ตัว เพื่อให้ฟาร์มดูมีชีวิต
 */
export async function getFarmSnapshot(user: AuthUser, systemId: number) {
  await assertCanViewFarm(user, systemId);

  const system = await prisma.crabSystem.findUnique({
    where: { id: systemId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      villageOpen: true,
      owner: { select: PUBLIC_USER_SELECT },
    },
  });
  if (!system) throw notFound('ไม่พบฟาร์มนี้');

  const isOwner = isAdmin(user) || system.ownerId === user.id;

  const [boxes, decor, letters] = await Promise.all([
    prisma.crabBox.findMany({
      where: { systemId },
      select: {
        id: true,
        code: true,
        label: true,
        color: true,
        status: true,
        _count: { select: { crabs: { where: { deletedAt: null, status: { not: 'SOLD' } } } } },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.farmDecor.findMany({ where: { systemId }, orderBy: { id: 'asc' } }),
    // เจ้าของเห็นจดหมายทุกฉบับ; ผู้มาเยือนเห็นเฉพาะของตัวเอง (+ คำตอบ)
    prisma.farmLetter.findMany({
      where: { systemId, deletedAt: null, ...(isOwner ? {} : { authorId: user.id }) },
      select: {
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
        author: { select: PUBLIC_USER_SELECT },
      },
      orderBy: { id: 'asc' },
    }),
  ]);

  return {
    system: {
      id: system.id,
      name: system.name,
      ownerId: system.ownerId,
      owner: system.owner,
      villageOpen: system.villageOpen,
    },
    boxes: boxes.map((b) => ({
      id: b.id,
      code: b.code,
      label: b.label,
      color: b.color,
      status: b.status,
      crabCount: b._count.crabs,
    })),
    decor,
    letters,
    canEdit: isOwner,
  };
}

// ─────────────────────────────────────────────────────────────────────
//  3. ของตกแต่ง (ข้อ 1.6)
// ─────────────────────────────────────────────────────────────────────

export type DecorInput = {
  kind: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  flip: boolean;
  variant?: string | null;
};

/**
 * บันทึกผังตกแต่งทั้งชุด (แทนที่ของเดิมทั้งหมด)
 * เลือกแบบ replace-all แทน CRUD รายชิ้นโดยตั้งใจ: UI เป็นลากวางแล้วกด "บันทึก" ทีเดียว
 * → ตัด logic reconcile optimistic update ทิ้งทั้งหมด และ ≤300 แถวบน MySQL เร็วกว่าที่คิดมาก
 */
export async function replaceDecor(user: AuthUser, systemId: number, items: DecorInput[]) {
  await assertCanEditSystem(user, systemId);
  await prisma.$transaction([
    prisma.farmDecor.deleteMany({ where: { systemId } }),
    prisma.farmDecor.createMany({
      data: items.map((it) => ({
        systemId,
        kind: it.kind,
        x: it.x,
        y: it.y,
        z: it.z,
        rot: it.rot,
        scale: it.scale,
        flip: it.flip,
        variant: it.variant ?? null,
      })),
    }),
  ]);
  // แค่ "เคาะ" ให้คนที่อยู่ในฟาร์มไปโหลดใหม่ — ไม่ส่งผังไปกับ event (กันชน maxPayload 16KB)
  publishFarm(systemId, { t: 'village.decor', systemId });
  return prisma.farmDecor.findMany({ where: { systemId }, orderBy: { id: 'asc' } });
}

// ─────────────────────────────────────────────────────────────────────
//  4. จดหมาย (ข้อ 1.5.2 – 1.5.4)
// ─────────────────────────────────────────────────────────────────────

/** จำนวนจดหมายสูงสุดที่ 1 คนฝากไว้ในฟาร์มหนึ่งได้ (กันสแปม/รกฟาร์ม) */
const MAX_LETTERS_PER_AUTHOR = 20;

export async function listLetters(user: AuthUser, systemId: number) {
  await assertCanViewFarm(user, systemId);
  const system = await prisma.crabSystem.findUnique({
    where: { id: systemId },
    select: { ownerId: true },
  });
  const isOwner = isAdmin(user) || system?.ownerId === user.id;
  return prisma.farmLetter.findMany({
    where: { systemId, deletedAt: null, ...(isOwner ? {} : { authorId: user.id }) },
    select: {
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
      author: { select: PUBLIC_USER_SELECT },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createLetter(
  user: AuthUser,
  systemId: number,
  input: { x: number; y: number; body: string; mood?: string | null },
) {
  await assertCanViewFarm(user, systemId);
  const mine = await prisma.farmLetter.count({
    where: { systemId, authorId: user.id, deletedAt: null },
  });
  if (mine >= MAX_LETTERS_PER_AUTHOR) {
    throw new AppError(400, `ฝากจดหมายไว้ในฟาร์มนี้ครบ ${MAX_LETTERS_PER_AUTHOR} ฉบับแล้ว รอเจ้าของอ่านก่อนนะ`);
  }

  const letter = await prisma.farmLetter.create({
    data: {
      systemId,
      authorId: user.id,
      x: input.x,
      y: input.y,
      body: input.body,
      mood: input.mood ?? null,
    },
    select: {
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
      author: { select: PUBLIC_USER_SELECT },
    },
  });

  const system = await prisma.crabSystem.findUnique({
    where: { id: systemId },
    select: { ownerId: true },
  });
  // แจ้งเจ้าของ (badge เด้งแม้ไม่ได้อยู่ในฟาร์ม) + เคาะคนที่กำลังเดินอยู่ให้โหลดหมุดใหม่
  if (system?.ownerId != null && system.ownerId !== user.id) {
    publishToUser(system.ownerId, { t: 'village.letter', systemId });
  }
  publishFarm(systemId, { t: 'village.letter', systemId });
  return letter;
}

export async function replyLetter(user: AuthUser, letterId: number, reply: string) {
  const letter = await prisma.farmLetter.findUnique({
    where: { id: letterId },
    select: { id: true, systemId: true, authorId: true, deletedAt: true },
  });
  if (!letter || letter.deletedAt) throw notFound('ไม่พบจดหมายฉบับนี้');
  await assertCanEditSystem(user, letter.systemId); // ตอบได้เฉพาะเจ้าของฟาร์ม

  const updated = await prisma.farmLetter.update({
    where: { id: letterId },
    data: {
      reply,
      repliedAt: new Date(),
      readAt: new Date(),
      authorReadReplyAt: null, // ผู้เขียนยังไม่เห็นคำตอบใหม่ → badge เด้งฝั่งเขา
    },
    select: { id: true, reply: true, repliedAt: true, readAt: true },
  });
  publishToUser(letter.authorId, { t: 'village.letter', systemId: letter.systemId });
  publishFarm(letter.systemId, { t: 'village.letter', systemId: letter.systemId });
  return updated;
}

/** เจ้าของกดอ่านจดหมายทั้งฟาร์มรวดเดียว (ดีกว่ายิงทีละฉบับ N ครั้ง) */
export async function markLettersRead(user: AuthUser, systemId: number) {
  await assertCanEditSystem(user, systemId);
  const res = await prisma.farmLetter.updateMany({
    where: { systemId, deletedAt: null, readAt: null },
    data: { readAt: new Date() },
  });
  return { marked: res.count };
}

/** ผู้เขียนกดรับทราบคำตอบแล้ว → เคลียร์ badge ฝั่งผู้เยี่ยม */
export async function markRepliesSeen(user: AuthUser) {
  const res = await prisma.farmLetter.updateMany({
    where: { authorId: user.id, deletedAt: null, reply: { not: null }, authorReadReplyAt: null },
    data: { authorReadReplyAt: new Date() },
  });
  return { marked: res.count };
}

/** ลบจดหมาย — ผู้เขียนลบของตัวเองได้ / เจ้าของฟาร์มลบอะไรก็ได้ในฟาร์มตัวเอง */
export async function deleteLetter(user: AuthUser, letterId: number) {
  const letter = await prisma.farmLetter.findUnique({
    where: { id: letterId },
    select: { id: true, systemId: true, authorId: true },
  });
  if (!letter) throw notFound('ไม่พบจดหมายฉบับนี้');
  if (letter.authorId !== user.id) await assertCanEditSystem(user, letter.systemId);

  await prisma.farmLetter.update({ where: { id: letterId }, data: { deletedAt: new Date() } });
  publishFarm(letter.systemId, { t: 'village.letter', systemId: letter.systemId });
  return { ok: true };
}

/** re-export ให้ route ใช้ได้โดยไม่ต้อง import ข้ามชั้น */
export { canViewFarm };
