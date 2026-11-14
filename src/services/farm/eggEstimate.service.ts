import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { AppError, badRequest } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import type { AuthUser } from '../auth.service';

// ════════════════════════════════════════════════════════════════════
//  AI ประเมิน % ไข่จากรูปส่องไข่ (ย้ายจาก v1 มาใช้ตาราง CrabCheck)
//  อัปรูปเสร็จ → Claude ดูเทียบกับ "รูปตัวอย่างของฟาร์มนี้เอง" (รูปเก่า + % ที่เจ้าของเคยกรอก)
//  → เติม % ให้ในช่องอัตโนมัติ ผู้ใช้แก้ทับได้เสมอ (ช่วยข้อ 4.6.13.4 "ลืมกรอก % ไข่")
//
//  ⚠️ ลูกค้าใหม่ยังไม่มีรูปตัวอย่าง → ประเมินจากคำอธิบายสเกลอย่างเดียว (เชื่อได้น้อยกว่า)
//     ส่ง referenceCount กลับไป หน้าเว็บบอกผู้ใช้ว่า AI ยังไม่ค่อยรู้จักฟาร์มนี้
//  ⚠️ รูปตัวอย่างตัด "รอบที่บันทึกวันนี้" ออก → ชุดตัวอย่างนิ่งทั้งวัน = prompt cache ใช้ซ้ำได้ทั้งรอบส่องไข่
//  ⚠️ รอบที่ผู้ใช้รับค่า AI ตรงๆ (pct === aiPct) ไม่เอามาเป็นตัวอย่าง — ไม่งั้น AI เรียนจากเลขตัวเอง
//     แล้วสเกลลอยออกจากของคน · รอบที่ผู้ใช้ "แก้ค่า AI" มีค่าที่สุด → เลือกก่อน
//  ⚠️ ไม่ใช้นับพิกเซล: รูปจริงถ่ายคนละฉาก/แสงต่างกันมาก ต้องใช้โมเดลที่ดูเป็นแล้วเทียบกับสเกลของเจ้าของ
// ════════════════════════════════════════════════════════════════════

const REF_PER_BUCKET = 2; // ตัวอย่างต่อช่วง 10% → สูงสุด ~20 รูป
const REF_SCAN_LIMIT = 800;
const REF_WIDTH = 768; // ย่อรูปตัวอย่าง (ประหยัด token)
const TARGET_WIDTH = 1280; // รูปที่จะประเมินให้ละเอียดกว่า

export const EGG_CONFIDENCE = ['high', 'medium', 'low'] as const;
export type EggConfidence = (typeof EGG_CONFIDENCE)[number];

export type EggEstimate = {
  usable: boolean;
  /** null = รูปนี้ประเมินไม่ได้ */
  pct: number | null;
  confidence: EggConfidence;
  reason: string;
  /** จำนวนรูปตัวอย่างของฟาร์มที่ใช้เทียบ (0 = ยังไม่มี — ประเมินจากคำอธิบายอย่างเดียว) */
  referenceCount: number;
  /** % ที่เคยกรอกในรอบก่อนของปูตัวเดียวกัน (ถ้ามี) */
  previousPct: number | null;
  model: string;
};

let client: Anthropic | null = null;
export const eggAiConfigured = () => !!env.ANTHROPIC_API_KEY;
function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new AppError(503, 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — ใช้ AI ประเมินไข่ไม่ได้');
  // อ่านรูป ~20 รูปใช้เวลาหลายวินาที → timeout กว้างหน่อย, retry ครั้งเดียวพอ (ผู้ใช้รออยู่)
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 });
  return client;
}

// ── รูปบน Cloudinary ────────────────────────────────────────────────

const uploadPrefix = () => `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/image/upload/`;

/** รับเฉพาะรูปที่อัปผ่านระบบเรา — กันเอา endpoint ไปให้ AI อ่านรูปที่ไหนก็ได้ด้วย key ของเรา */
function assertOwnImage(url: string): void {
  if (!env.CLOUDINARY_CLOUD_NAME || !url.startsWith(uploadPrefix())) throw badRequest('ประเมินได้เฉพาะรูปที่อัปโหลดผ่านระบบ');
}

/** ย่อรูป + บังคับเป็น .jpg (iPhone อัป HEIC มาได้ แต่ Claude อ่าน HEIC ไม่ได้) */
function sizedUrl(url: string, width: number): string {
  const resized = url.replace('/image/upload/', `/image/upload/c_limit,w_${width},q_auto/`);
  return resized.replace(/\.[a-z0-9]+$/i, '.jpg');
}

// ── รูปตัวอย่างของฟาร์ม (few-shot) ─────────────────────────────────────

type LabeledPhoto = { checkId: number; crabId: number; pct: number; url: string; checkedAt: Date; corrected: boolean };

/** รอบเช็คที่มีทั้งรูปและ % ของปูไข่ในฟาร์มของ ownerId (ใหม่ → เก่า) */
async function labeledPhotos(ownerId: number, before: Date): Promise<LabeledPhoto[]> {
  const rows = await prisma.crabCheck.findMany({
    where: {
      checkedAt: { lt: before },
      photoUrl: { not: null },
      pct: { not: null },
      crab: { ownerId, type: 'EGG', deletedAt: null },
    },
    select: { id: true, crabId: true, checkedAt: true, photoUrl: true, pct: true, aiPct: true },
    orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
    take: REF_SCAN_LIMIT,
  });
  return rows
    .filter((r) => r.aiPct == null || r.aiPct !== r.pct) // รับค่า AI ตรงๆ = ไม่มีข้อมูลจากคน
    .map((r) => ({
      checkId: r.id,
      crabId: r.crabId,
      pct: r.pct!,
      url: r.photoUrl!,
      checkedAt: r.checkedAt,
      corrected: r.aiPct != null,
    }));
}

/** ช่วงละ REF_PER_BUCKET รูป (รอบที่ผู้ใช้แก้ AI ก่อน แล้วใหม่สุด) → เรียง % น้อย→มาก */
function pickReferences(photos: LabeledPhoto[], excludeCrabId?: number): LabeledPhoto[] {
  const buckets = new Map<number, LabeledPhoto[]>();
  for (const p of photos) {
    if (excludeCrabId != null && p.crabId === excludeCrabId) continue;
    const b = Math.min(9, Math.floor(p.pct / 10));
    buckets.set(b, [...(buckets.get(b) ?? []), p]);
  }
  const picked: LabeledPhoto[] = [];
  for (const list of buckets.values()) {
    const ordered = [...list.filter((p) => p.corrected), ...list.filter((p) => !p.corrected)];
    picked.push(...ordered.slice(0, REF_PER_BUCKET));
  }
  return picked.sort((a, b) => a.pct - b.pct || a.checkId - b.checkId);
}

/** รอบก่อนของปูตัวเดียวกัน (มีรูป + %) — ใช้ดูว่าไข่โตขึ้นจากเดิมแค่ไหน */
async function previousOfCrab(crabId: number): Promise<LabeledPhoto | null> {
  const r = await prisma.crabCheck.findFirst({
    where: { crabId, photoUrl: { not: null }, pct: { not: null } },
    orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, crabId: true, checkedAt: true, photoUrl: true, pct: true },
  });
  return r ? { checkId: r.id, crabId: r.crabId, pct: r.pct!, url: r.photoUrl!, checkedAt: r.checkedAt, corrected: false } : null;
}

// ── prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You estimate egg (ovary) fullness of female mud crabs from candling photos taken on small Thai crab-fattening farms.

How the photos are taken: the farmer shines a bright light through the crab's carapace in a dim place (a lamp under a net, or a flashlight), so the shell glows. Inside, the developing ovary shows up as an opaque, often granular orange-to-dark-red mass, while parts without ovary let more light through. As the crab fills, the mass spreads outward from the middle until it reaches the edges of the carapace under the lateral spines. Lighting, background, angle and exposure vary a lot between photos, so judge how much of the carapace interior the ovary covers, not how bright or dark the picture is overall.

"Egg %" is the farmer's own estimate on a 0–100 scale, where 100 means the ovary fills the carapace right to its edges. When the farmer's labeled reference photos are provided, they define what each number means on this farm, so match their scale rather than any outside convention. Their numbers are hand estimates and are not perfectly consistent, so calibrate against the set as a whole instead of copying the single most similar photo. When there are few or no reference photos, use the description above and lower your confidence accordingly. When an earlier photo of the same crab is provided, use it to judge growth since then; ovaries usually grow over time, but the earlier number may itself be off.

If the new photo is not a candling shot (ordinary daylight with the shell not lit through), the carapace is mostly out of frame, or it is too blurred or dark to judge, set usable to false. A wrong number is worse than no number here, because the farmer saves it straight into their records.

Fields:
- usable: whether the photo can be judged.
- eggPct: your estimate rounded to the nearest 5 (use 0 when usable is false).
- confidence: high, medium or low.
- reason: one short sentence in Thai (under about 80 characters) naming what you saw, for example "ไข่ลามเกือบถึงขอบกระดอง เหลือช่องใสด้านขวา". It is shown to the farmer next to the number.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    usable: { type: 'boolean' },
    eggPct: { type: 'integer' },
    confidence: { type: 'string', enum: [...EGG_CONFIDENCE] },
    reason: { type: 'string' },
  },
  required: ['usable', 'eggPct', 'confidence', 'reason'],
  additionalProperties: false,
};
const outputZ = z.object({ usable: z.boolean(), eggPct: z.number(), confidence: z.enum(EGG_CONFIDENCE), reason: z.string() });

const daysBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
const roundTo5 = (n: number) => Math.min(100, Math.max(0, Math.round(n / 5) * 5));
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0); // process TZ = Asia/Bangkok (config/env.ts)
  return d;
}

async function estimate(ownerId: number, imageUrl: string, crabId?: number): Promise<EggEstimate> {
  const anthropic = getClient();
  const [photos, previous] = await Promise.all([
    labeledPhotos(ownerId, startOfToday()),
    crabId != null ? previousOfCrab(crabId) : Promise.resolve(null),
  ]);
  const refs = pickReferences(photos);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (refs.length) {
    content.push({
      type: 'text',
      text: 'Reference photos from this farm, ordered from emptiest to fullest. Each label is the farmer\'s egg % for the photo right after it.',
    });
    refs.forEach((r, i) => {
      content.push({ type: 'text', text: `Reference ${i + 1}: ${r.pct}%` });
      content.push({ type: 'image', source: { type: 'url', url: sizedUrl(r.url, REF_WIDTH) } });
    });
    // ชุดตัวอย่างเหมือนเดิมทั้งวัน → cache (ส่องไข่ห่างกันตัวละ 3–8 นาที เกิน 5 นาทีบ่อย จึงใช้ 1h)
    content[content.length - 1] = {
      ...(content[content.length - 1] as Anthropic.Beta.BetaImageBlockParam),
      cache_control: { type: 'ephemeral', ttl: '1h' },
    };
  } else {
    content.push({ type: 'text', text: 'This farm has no labeled reference photos yet, so rely on the description of the scale.' });
  }
  if (previous) {
    content.push({
      type: 'text',
      text: `Earlier photo of this same crab, taken ${daysBetween(previous.checkedAt, new Date())} days before the new one. The farmer recorded ${previous.pct}% for it.`,
    });
    content.push({ type: 'image', source: { type: 'url', url: sizedUrl(previous.url, REF_WIDTH) } });
  }
  content.push({ type: 'text', text: 'New photo to estimate:' });
  content.push({ type: 'image', source: { type: 'url', url: sizedUrl(imageUrl, TARGET_WIDTH) } });

  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await anthropic.beta.messages.create({
      model: env.EGG_AI_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // รุ่นหลักปฏิเสธ (ไม่น่าเกิดกับรูปปู) → server ลองรุ่นสำรองให้เอง
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    throw toAppError(e);
  }

  if (res.stop_reason === 'refusal') throw new AppError(502, 'AI ไม่ประเมินรูปนี้ — กรอก % เองได้เลย');
  if (res.stop_reason === 'max_tokens') throw new AppError(502, 'AI ตอบไม่จบ — ลองอีกครั้ง หรือกรอก % เอง');
  const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text');
  if (!text) throw new AppError(502, 'AI ไม่ได้ส่งผลกลับมา — ลองอีกครั้ง');
  let out: z.infer<typeof outputZ>;
  try {
    out = outputZ.parse(JSON.parse(text.text));
  } catch {
    throw new AppError(502, 'อ่านผลจาก AI ไม่ได้ — ลองอีกครั้ง');
  }

  return {
    usable: out.usable,
    pct: out.usable ? roundTo5(out.eggPct) : null,
    confidence: out.confidence,
    reason: out.reason.trim().slice(0, 200),
    referenceCount: refs.length,
    previousPct: previous?.pct ?? null,
    model: res.model,
  };
}

/** error ของ SDK → ข้อความไทย (เฉพาะ → กว้าง) */
function toAppError(e: unknown): AppError {
  // ⚠️ ห้ามตอบ 503 — หน้าเว็บถือว่า 503 = "ยังไม่เปิดฟีเจอร์" แล้วซ่อนเงียบ ผู้ใช้จะไม่รู้ว่า key ผิด
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new AppError(502, 'ANTHROPIC_API_KEY ใช้ไม่ได้ — ตรวจ key ในไฟล์ .env');
  }
  if (e instanceof Anthropic.RateLimitError) return new AppError(429, 'AI ถูกเรียกถี่เกินไป — รอสักครู่แล้วลองใหม่');
  if (e instanceof Anthropic.BadRequestError) return new AppError(502, `AI เปิดรูปนี้ไม่ได้ — ${e.message}`);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AppError(504, 'AI ใช้เวลานานเกินไป — ลองอีกครั้ง หรือกรอก % เอง');
  if (e instanceof Anthropic.APIError) {
    return new AppError(502, `AI มีปัญหาชั่วคราว (${e.status ?? 'network'}) — ลองอีกครั้ง หรือกรอก % เอง`);
  }
  return e instanceof AppError ? e : new AppError(502, 'AI มีปัญหาชั่วคราว — ลองอีกครั้ง');
}

// กันเผลอยิงรัว (บั๊กหน้าเว็บวนลูป = เสียเงินจริง) — ต่อคนไม่เกิน 60 ครั้ง / 10 นาที
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 60;
const recentCalls = new Map<number, number[]>();
function assertRate(userId: number): void {
  const now = Date.now();
  const calls = (recentCalls.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (calls.length >= RATE_MAX) throw new AppError(429, 'ใช้ AI ประเมินไข่ถี่เกินไป — พักสักครู่แล้วลองใหม่');
  calls.push(now);
  recentCalls.set(userId, calls);
}

/** route เรียกตัวนี้ — ปูที่มีอยู่แล้วต้องเป็นปูไข่ของผู้ใช้เอง · ปูใหม่ (กำลังรับเข้า) ไม่ต้องส่ง crabId */
export async function estimateEggForUser(user: AuthUser, input: { imageUrl: string; crabId?: number }): Promise<EggEstimate> {
  if (!eggAiConfigured()) throw new AppError(503, 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — ใช้ AI ประเมินไข่ไม่ได้');
  assertOwnImage(input.imageUrl);
  if (input.crabId != null) {
    const crab = assertOwned(
      await prisma.crab.findFirst({ where: { id: input.crabId, deletedAt: null }, select: { ownerId: true, type: true } }),
      user,
      'ปูตัวนี้',
    );
    if (crab.type !== 'EGG') throw badRequest('AI ประเมินได้เฉพาะปูไข่');
  }
  assertRate(user.id);
  return estimate(user.id, input.imageUrl, input.crabId);
}

/** หน้าเว็บถามก่อนว่าเปิดใช้ไหม (ไม่ต้องเสียค่า AI) */
export const eggAiStatus = () => ({ enabled: eggAiConfigured() && !!env.CLOUDINARY_CLOUD_NAME });
