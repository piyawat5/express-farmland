import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError, badRequest } from '../lib/http';

// ════════════════════════════════════════════════════════════════════
//  Auth — register / login / refresh / logout  (ข้อ 1.2.4)
//  access token = JWT อายุสั้น (ใส่ Authorization header ทุก request)
//  refresh token = สุ่ม เก็บ "hash" ลง DB เพื่อ revoke ได้; rotate ทุกครั้งที่ refresh
// ════════════════════════════════════════════════════════════════════

export type AuthUser = { id: number; role: Role; email: string };
type AccessPayload = { sub: number; role: Role; email: string };

/** แปลง "15m" / "30d" / "1h" / "60s" → มิลลิวินาที (ใช้คำนวณ expiry ของ token) */
function parseDurationMs(s: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(s.trim());
  if (!m) throw new Error(`รูปแบบ duration ไม่ถูกต้อง: ${s}`);
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return n * unit;
}

const ACCESS_TTL_SEC = Math.floor(parseDurationMs(env.ACCESS_TOKEN_TTL) / 1000);
const REFRESH_TTL_MS = parseDurationMs(env.REFRESH_TOKEN_TTL);

const sha256 = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

function signAccessToken(user: AuthUser): string {
  const payload: AccessPayload = { sub: user.id, role: user.role, email: user.email };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL_SEC });
}

/** verify access token → คืน AuthUser (โยน AppError 401 ถ้าไม่ valid/หมดอายุ) */
export function verifyAccessToken(token: string): AuthUser {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as unknown as AccessPayload;
    return { id: decoded.sub, role: decoded.role, email: decoded.email };
  } catch {
    throw new AppError(401, 'เซสชันหมดอายุหรือไม่ถูกต้อง');
  }
}

/** ออก refresh token ใหม่ (เก็บ hash ลง DB) — คืน token ดิบให้ client */
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

/** ออก access + refresh สำหรับ user (ใช้ตอน login / register / oauth) */
export async function issueTokens(
  user: { id: number; role: Role; email: string },
  userAgent?: string | null,
): Promise<TokenPair> {
  const authUser: AuthUser = { id: user.id, role: user.role, email: user.email };
  const accessToken = signAccessToken(authUser);
  const refreshToken = await issueRefreshToken(user.id, userAgent);
  return { accessToken, refreshToken, user: authUser };
}

const publicUser = (u: {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  avatarUrl?: string | null;
}) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  avatarUrl: u.avatarUrl ?? null,
});

// ── register (email + password) ───────────────────────────────────────
export async function register(
  input: { email: string; password: string; name?: string | null },
  userAgent?: string | null,
) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw badRequest('อีเมลนี้ถูกใช้สมัครแล้ว');

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: { email, name: input.name ?? null, passwordHash, role: 'FARM_OWNER' },
  });
  const tokens = await issueTokens(user, userAgent);
  return { ...tokens, user: publicUser(user) };
}

// ── login (email + password) ──────────────────────────────────────────
export async function login(
  input: { email: string; password: string },
  userAgent?: string | null,
) {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // ข้อความเดียวกันทั้งกรณีไม่มี user / รหัสผิด — กัน enumerate อีเมล
  if (!user || !user.passwordHash || !user.active) {
    throw new AppError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new AppError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');

  const tokens = await issueTokens(user, userAgent);
  return { ...tokens, user: publicUser(user) };
}

// ── refresh (rotate) ──────────────────────────────────────────────────
export async function refresh(rawToken: string, userAgent?: string | null) {
  const tokenHash = sha256(rawToken);
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!record || record.revokedAt || record.expiresAt < new Date() || !record.user.active) {
    throw new AppError(401, 'กรุณาเข้าสู่ระบบใหม่');
  }
  // rotation: ปิด token เดิม แล้วออกชุดใหม่
  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  const tokens = await issueTokens(record.user, userAgent);
  return { ...tokens, user: publicUser(record.user) };
}

// ── logout (revoke refresh token ปัจจุบัน) ────────────────────────────
export async function logout(rawToken: string | undefined) {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ── me (โปรไฟล์ปัจจุบัน) ───────────────────────────────────────────────
export async function getMe(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(401, 'ไม่พบผู้ใช้');
  return publicUser(user);
}
