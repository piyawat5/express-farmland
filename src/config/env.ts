import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// ── Timezone ─────────────────────────────────────────────────────────
// host (Plesk) อาจรันเป็น UTC → cron "0 20 * * *" และ default 08:00 จะเพี้ยน 7 ชม.
// บังคับ process timezone เป็นเวลาไทยเสมอ (single user ไทย) — ตั้งก่อนใช้ Date ใดๆ
// override ได้ผ่าน env TZ ถ้าจำเป็น
process.env.TZ = process.env.TZ || 'Asia/Bangkok';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SHADOW_DATABASE_URL: z.string().optional(),

  // Email (Host Atom SMTP)
  SMTP_HOST: z.string().default('thsv35.hostatom.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  EMAIL_USER: z.string().optional(), // user สำหรับ auth + ที่อยู่ผู้ส่ง
  EMAIL_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(), // ถ้าไม่ตั้ง ใช้ EMAIL_USER
  MAIL_TO: z.string().optional(), // fallback ปลายทาง (ปกติ resolve จาก User.email)

  // Auth (JWT access + refresh)
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  ACCESS_TOKEN_TTL: z.string().default('15m'), // อายุ access token (เช่น 15m, 1h)
  REFRESH_TOKEN_TTL: z.string().default('30d'), // อายุ refresh token (เช่น 30d)
  FRONTEND_URL: z.string().default('http://localhost:5173'), // ใช้ตอน OAuth redirect (Phase 2)

  // OAuth (Phase 2 — optional จนกว่าจะตั้งค่า)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  LINE_CHANNEL_ID: z.string().optional(),
  LINE_CHANNEL_SECRET: z.string().optional(),
  OAUTH_CALLBACK_BASE: z.string().optional(), // เช่น http://localhost:3000/api/auth/oauth

  // Scheduler
  SCHEDULER_SECRET: z.string().min(1, 'SCHEDULER_SECRET is required'),
  ENABLE_INTERNAL_CRON: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // เว้นช่วงเมลสรุป: ต่อให้ cron วิ่งถี่ เมลสรุปจะส่งซ้ำเร็วสุดทุกกี่นาที
  // (งานใหม่ที่ยังไม่เคยเตือน จะเด้งทันทีโดยไม่รอครบรอบ)
  DIGEST_MIN_INTERVAL_MIN: z.coerce.number().int().min(0).default(60),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
