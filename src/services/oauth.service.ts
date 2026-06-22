import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { OAuthProvider } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../lib/http';
import { issueTokens, type TokenPair } from './auth.service';

// ════════════════════════════════════════════════════════════════════
//  OAuth — login with Google / LINE (authorization-code flow, ข้อ 1.2.3)
//  เขียนเอง ไม่เพิ่ม passport; ใช้ global fetch (Node 18+)
//  ไม่เก็บ password — ผูกบัญชีผ่าน OAuthAccount (provider + providerAccountId)
// ════════════════════════════════════════════════════════════════════

// base ของ callback (ต้องตรงกับที่ลงทะเบียนใน Google/LINE console)
const CALLBACK_BASE = env.OAUTH_CALLBACK_BASE ?? 'http://localhost:3000/api/auth/oauth';

type ProviderKey = 'google' | 'line';

function normalizeProvider(p: string): { key: ProviderKey; enumVal: OAuthProvider } {
  if (p === 'google') return { key: 'google', enumVal: 'GOOGLE' };
  if (p === 'line') return { key: 'line', enumVal: 'LINE' };
  throw new AppError(400, 'provider ไม่รองรับ (google/line เท่านั้น)');
}

const redirectUri = (key: ProviderKey) => `${CALLBACK_BASE}/${key}/callback`;

function assertConfigured(key: ProviderKey) {
  if (key === 'google' && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)) {
    throw new AppError(500, 'ยังไม่ได้ตั้งค่า Google OAuth (GOOGLE_CLIENT_ID/SECRET)');
  }
  if (key === 'line' && (!env.LINE_CHANNEL_ID || !env.LINE_CHANNEL_SECRET)) {
    throw new AppError(500, 'ยังไม่ได้ตั้งค่า LINE OAuth (LINE_CHANNEL_ID/SECRET)');
  }
}

// state = JWT อายุสั้น ป้องกัน CSRF (stateless ไม่ต้องเก็บ session)
function makeState(key: ProviderKey): string {
  return jwt.sign({ p: key, n: crypto.randomBytes(8).toString('hex') }, env.JWT_ACCESS_SECRET, {
    expiresIn: '10m',
  });
}
function verifyState(key: ProviderKey, state: string): void {
  try {
    const decoded = jwt.verify(state, env.JWT_ACCESS_SECRET) as unknown as { p?: string };
    if (decoded.p !== key) throw new Error('provider mismatch');
  } catch {
    throw new AppError(400, 'state ไม่ถูกต้องหรือหมดอายุ (กรุณาเข้าสู่ระบบใหม่)');
  }
}

/** สร้าง URL ไปหน้า consent ของ provider */
export function getAuthorizeUrl(provider: string): string {
  const { key } = normalizeProvider(provider);
  assertConfigured(key);
  const state = makeState(key);

  if (key === 'google') {
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri('google'),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }
  // LINE
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.LINE_CHANNEL_ID!,
    redirect_uri: redirectUri('line'),
    state,
    scope: 'profile openid email',
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}

type Profile = { providerAccountId: string; email: string | null; name: string | null };

async function googleProfile(code: string): Promise<Profile> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri('google'),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new AppError(401, 'แลก token กับ Google ไม่สำเร็จ');
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) throw new AppError(401, 'ไม่ได้รับ access token จาก Google');

  const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) throw new AppError(401, 'ดึงโปรไฟล์ Google ไม่สำเร็จ');
  const info = (await infoRes.json()) as { id: string; email?: string; name?: string };
  return { providerAccountId: info.id, email: info.email ?? null, name: info.name ?? null };
}

async function lineProfile(code: string): Promise<Profile> {
  const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri('line'),
      client_id: env.LINE_CHANNEL_ID!,
      client_secret: env.LINE_CHANNEL_SECRET!,
    }),
  });
  if (!tokenRes.ok) throw new AppError(401, 'แลก token กับ LINE ไม่สำเร็จ');
  const token = (await tokenRes.json()) as { access_token?: string; id_token?: string };

  // id_token เป็น JWT (HS256 ด้วย channel secret) มี sub/email/name — ใช้ดึง email (ถ้าได้สิทธิ์)
  if (token.id_token) {
    try {
      const payload = jwt.verify(token.id_token, env.LINE_CHANNEL_SECRET!, {
        algorithms: ['HS256'],
        audience: env.LINE_CHANNEL_ID,
        issuer: 'https://access.line.me',
      }) as unknown as { sub: string; email?: string; name?: string };
      return { providerAccountId: payload.sub, email: payload.email ?? null, name: payload.name ?? null };
    } catch {
      // verify id_token ไม่ผ่าน → fallback ไปดึง profile (จะไม่มี email)
    }
  }

  if (!token.access_token) throw new AppError(401, 'ไม่ได้รับ token จาก LINE');
  const profRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!profRes.ok) throw new AppError(401, 'ดึงโปรไฟล์ LINE ไม่สำเร็จ');
  const prof = (await profRes.json()) as { userId: string; displayName?: string };
  return { providerAccountId: prof.userId, email: null, name: prof.displayName ?? null };
}

/** แลก code → โปรไฟล์ → หา/สร้าง user → ออก token (rotate-able) */
export async function handleCallback(
  provider: string,
  code: string,
  state: string,
  userAgent?: string | null,
): Promise<TokenPair> {
  const { key, enumVal } = normalizeProvider(provider);
  assertConfigured(key);
  verifyState(key, state);

  const profile = key === 'google' ? await googleProfile(code) : await lineProfile(code);

  // 1) เคยผูกบัญชี provider นี้แล้ว → ใช้ user เดิม
  const existing = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: { provider: enumVal, providerAccountId: profile.providerAccountId },
    },
    include: { user: true },
  });
  if (existing) {
    if (!existing.user.active) throw new AppError(403, 'บัญชีถูกปิดใช้งาน');
    return issueTokens(existing.user, userAgent);
  }

  // 2) ยังไม่ผูก → หา user จาก email (ผูกเข้าบัญชีเดิม) ไม่งั้นสร้างใหม่
  //    ถ้า provider ไม่คืน email (เช่น LINE ยังไม่ได้สิทธิ์) → ใช้ email เทียมกัน user ชนกัน
  const email = profile.email ?? `${key}_${profile.providerAccountId}@oauth.local`;
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: profile.name,
        role: 'FARM_OWNER',
        passwordHash: null,
        lineId: key === 'line' ? profile.providerAccountId : null,
      },
    });
  }
  await prisma.oAuthAccount.create({
    data: { userId: user.id, provider: enumVal, providerAccountId: profile.providerAccountId },
  });
  return issueTokens(user, userAgent);
}

/** ปลายทาง frontend ที่ส่ง token กลับไป (ผ่าน hash) */
export const frontendCallbackUrl = () => `${env.FRONTEND_URL}/oauth/callback`;
