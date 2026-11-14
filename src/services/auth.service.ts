import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Prisma, type Role, type User, type WeightUnit } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError, badRequest } from '../lib/http';
import { getAccess } from './subscription.service';
import { parseHours } from './reminders/schedule';

// ════════════════════════════════════════════════════════════════════
//  Auth — register / login / refresh / logout / me
//  access token = JWT อายุสั้น · refresh token = สุ่ม เก็บ hash ใน DB (rotate ทุกครั้ง)
//  สมัครได้ทุกคน แต่จะใช้ระบบตัวจริงได้ต้องมีสิทธิ์ใช้งาน (ดู subscription.service)
// ════════════════════════════════════════════════════════════════════

export type AuthUser = { id: number; role: Role; email: string };
type AccessPayload = { sub: number; role: Role; email: string };

/** แปลง "15m" / "30d" / "1h" / "60s" → มิลลิวินาที */
function parseDurationMs(s: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(s.trim());
  if (!m) throw new Error(`รูปแบบ duration ไม่ถูกต้อง: ${s}`);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return Number(m[1]) * unit;
}

const ACCESS_TTL_SEC = Math.floor(parseDurationMs(env.ACCESS_TOKEN_TTL) / 1000);
const REFRESH_TTL_MS = parseDurationMs(env.REFRESH_TOKEN_TTL);

const sha256 = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

function signAccessToken(user: AuthUser): string {
  const payload: AccessPayload = { sub: user.id, role: user.role, email: user.email };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL_SEC });
}

/** verify access token → AuthUser (โยน 401 ถ้าไม่ valid/หมดอายุ) */
export function verifyAccessToken(token: string): AuthUser {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as unknown as AccessPayload;
    return { id: decoded.sub, role: decoded.role, email: decoded.email };
  } catch {
    throw new AppError(401, 'เซสชันหมดอายุหรือไม่ถูกต้อง');
  }
}

async function issueRefreshToken(userId: number, userAgent?: string | null): Promise<string> {
  const raw = crypto.randomBytes(48).toString('hex');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: userAgent ?? null,
    },
  });
  return raw;
}

export type TokenPair = { accessToken: string; refreshToken: string; user: AuthUser };

/** ออก access + refresh (ใช้ตอน login / register / oauth / refresh) */
export async function issueTokens(
  user: { id: number; role: Role; email: string },
  userAgent?: string | null,
): Promise<TokenPair> {
  const authUser: AuthUser = { id: user.id, role: user.role, email: user.email };
  const accessToken = signAccessToken(authUser);
  const refreshToken = await issueRefreshToken(user.id, userAgent);
  return { accessToken, refreshToken, user: authUser };
}

/** บันทึกเวลาเข้าใช้ล่าสุด (โชว์ในหลังบ้าน) — ไม่ให้พังทั้ง flow ถ้าเขียนไม่สำเร็จ */
export async function touchLogin(userId: number) {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
}

/** ข้อมูลของ "ตัวเอง" ที่ส่งให้หน้าเว็บ — ห้ามใช้ตัวนี้ตอนส่งข้อมูลคนอื่น (มี uiPrefs) */
export const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  avatarUrl: u.avatarUrl,
  notifyEmail: u.notifyEmail,
  weightUnit: u.weightUnit,
  /** ชั่วโมงที่ส่งอีเมลสรุปงานค้าง เช่น [8, 12, 16, 20] */
  emailHours: parseHours(u.emailHours),
  hasPassword: !!u.passwordHash,
  /** อีเมลเทียมของ LINE/Facebook ที่ไม่ให้อีเมล — หน้าเว็บไม่ควรโชว์/ใช้ส่งเมล */
  emailIsPlaceholder: u.email.endsWith('@oauth.local'),
  uiPrefs: (u.uiPrefs as Record<string, unknown> | null) ?? null,
  createdAt: u.createdAt,
});

export async function register(
  input: { email: string; password: string; name?: string | null },
  userAgent?: string | null,
) {
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw badRequest('อีเมลนี้ถูกใช้สมัครแล้ว');

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: { email, name: input.name ?? null, passwordHash, role: 'USER', lastLoginAt: new Date() },
  });
  const tokens = await issueTokens(user, userAgent);
  return { ...tokens, user: publicUser(user) };
}

export async function login(input: { email: string; password: string }, userAgent?: string | null) {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // ข้อความเดียวกันทุกกรณี — กันไล่เดาว่าอีเมลไหนมีบัญชี
  if (!user || !user.passwordHash) throw new AppError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new AppError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  if (!user.active) throw new AppError(403, 'บัญชีนี้ถูกระงับ กรุณาติดต่อแอดมิน');

  await touchLogin(user.id);
  const tokens = await issueTokens(user, userAgent);
  return { ...tokens, user: publicUser(user) };
}

export async function refresh(rawToken: string, userAgent?: string | null) {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { user: true },
  });
  if (!record || record.revokedAt || record.expiresAt < new Date() || !record.user.active) {
    throw new AppError(401, 'กรุณาเข้าสู่ระบบใหม่');
  }
  // rotation: ปิดตัวเดิมแบบมีเงื่อนไข → token เดียวกันใช้ refresh ซ้ำไม่ได้แม้ยิงพร้อมกัน
  const changed = await prisma.refreshToken.updateMany({
    where: { id: record.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (changed.count !== 1) throw new AppError(401, 'กรุณาเข้าสู่ระบบใหม่');
  const tokens = await issueTokens(record.user, userAgent);
  return { ...tokens, user: publicUser(record.user) };
}

export async function logout(rawToken: string | undefined) {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** โปรไฟล์ตัวเอง + สิทธิ์ใช้งาน (หน้าเว็บใช้ตัดสินว่าจะพาไปหน้าไหน) */
export async function getMe(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { oauthAccounts: { select: { provider: true } } },
  });
  if (!user) throw new AppError(401, 'ไม่พบผู้ใช้');
  const access = await getAccess(userId, { fresh: true });
  return {
    ...publicUser(user),
    providers: user.oauthAccounts.map((a) => a.provider),
    access,
  };
}

export async function updateProfile(
  userId: number,
  input: { name?: string | null; notifyEmail?: string | null; weightUnit?: WeightUnit; emailHours?: number[] },
) {
  const data: Prisma.UserUpdateInput = {};
  if (input.name !== undefined) data.name = input.name?.trim() || null;
  // เว้นว่าง = ไม่ส่งอีเมลแจ้งเตือน
  if (input.notifyEmail !== undefined) data.notifyEmail = input.notifyEmail?.trim().toLowerCase() || null;
  if (input.weightUnit !== undefined) data.weightUnit = input.weightUnit;
  if (input.emailHours !== undefined) data.emailHours = parseHours(input.emailHours.join(',')).join(',');
  await prisma.user.update({ where: { id: userId }, data });
  return getMe(userId);
}

/** ค่าหน้าเว็บส่วนตัว (merge ทับของเดิม) — ธีม, เสียง, หน้าแรก, ทัวร์ที่ดูแล้ว */
export async function updateUiPrefs(userId: number, patch: Record<string, unknown>) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uiPrefs: true } });
  if (!user) throw new AppError(401, 'ไม่พบผู้ใช้');
  const merged = { ...((user.uiPrefs as Record<string, unknown> | null) ?? {}), ...patch };
  await prisma.user.update({ where: { id: userId }, data: { uiPrefs: merged as Prisma.InputJsonValue } });
  return merged;
}

/** ตั้ง/เปลี่ยนรหัสผ่าน — บัญชีที่มีรหัสอยู่แล้วต้องใส่รหัสเดิม (บัญชี OAuth ตั้งครั้งแรกได้เลย) */
export async function changePassword(userId: number, input: { currentPassword?: string; newPassword: string }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(401, 'ไม่พบผู้ใช้');
  if (user.passwordHash) {
    const ok = input.currentPassword ? await bcrypt.compare(input.currentPassword, user.passwordHash) : false;
    if (!ok) throw badRequest('รหัสผ่านเดิมไม่ถูกต้อง');
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(input.newPassword, 10) },
  });
}
