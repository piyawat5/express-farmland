import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError, badRequest, notFound } from '../lib/http';
import { assertCanEditSystem } from '../middleware/auth';
import type { AuthUser } from './auth.service';

// ════════════════════════════════════════════════════════════════════
//  AI ประเมิน % ไข่จากรูปส่องไข่ (ฟีดแบ็ค 2026-10-17 ข้อ 1.2)
//  เดิม: ถ่ายรูปแล้วต้องมานั่งกะ % เองแล้วพิมพ์อีกรอบ = ทำงาน 2 ต่อ + กะพลาดได้
//  ใหม่: อัปรูปเสร็จ → ส่งให้ Claude ดูเทียบกับ "รูปตัวอย่างของฟาร์มนี้เอง" (รูปเก่า + % ที่ผู้ใช้เคยกรอก)
//        → เติม % ให้ในช่องอัตโนมัติ (ผู้ใช้แก้ทับได้เสมอ)
//
//  ⚠️ ไม่ใช้ OCR/วัดสีพิกเซล: รูปจริงถ่ายคนละฉาก (ตะแกรงไฟส่องล่าง / กะละมังชมพู / ไฟฉายส่องบน)
//     แสงต่างกันมากจนนับพิกเซลมืด-สว่างตรง ๆ ไม่ได้ ต้องใช้โมเดลที่ "ดูเป็น" แล้วเทียบกับสเกลของผู้ใช้
//  ⚠️ รูปตัวอย่างตัด "แถวที่วันนี้บันทึก" ออก (referencesBefore = เที่ยงคืนวันนี้)
//     → ชุดตัวอย่างนิ่งทั้งวัน = prompt cache ถูกใช้ซ้ำได้ตลอดรอบส่องไข่ (เปลี่ยนวันละครั้ง)
//  ⚠️ แถวที่ผู้ใช้กด "ใช้ค่าตาม AI" (aiEggPct === %) ไม่เอามาเป็นตัวอย่าง — ไม่งั้น AI จะเรียนจากเลขของตัวเอง
//     แล้วสเกลค่อย ๆ ลอยออกจากของผู้ใช้; แถวที่ผู้ใช้ "แก้ค่า AI" มีค่าที่สุด (คนไม่เห็นด้วยกับ AI) → เลือกก่อน
// ════════════════════════════════════════════════════════════════════

const REF_PER_BUCKET = 2; // ตัวอย่างต่อช่วง 10% → สูงสุด ~20 รูป
const REF_SCAN_LIMIT = 800;
const REF_WIDTH = 768; // ย่อรูปตัวอย่าง (ประหยัด token)
const TARGET_WIDTH = 1280; // รูปที่จะประเมินให้ละเอียดกว่า

export const EGG_CONFIDENCE = ['high', 'medium', 'low'] as const;
export type EggConfidence = (typeof EGG_CONFIDENCE)[number];

export type EggEstimate = {
  usable: boolean;
  eggPct: number | null; // null = รูปนี้ประเมินไม่ได้
  confidence: EggConfidence;
  reason: string;
  referenceCount: number;
  previousPct: number | null; // % ที่เคยกรอกในรอบก่อนของปูตัวเดียวกัน (ถ้ามี)
  model: string;
};
export type EggEstimateUsage = Anthropic.Beta.BetaUsage;

let client: Anthropic | null = null;
export const eggAiConfigured = () => !!env.ANTHROPIC_API_KEY;
function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError(503, 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — ใช้ AI ประเมินไข่ไม่ได้');
  }
  // อ่านรูป ~20 รูปใช้เวลาหลายวินาที → timeout กว้างหน่อย, retry ครั้งเดียวพอ (ผู้ใช้รออยู่)
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 });
  return client;
}

// ── รูปบน Cloudinary ────────────────────────────────────────────────

const uploadPrefix = () => `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/image/upload/`;

/** รับเฉพาะรูปที่อัปผ่านระบบเรา — กันเอา endpoint ไปยิงรูปที่ไหนก็ได้ด้วย key ของเรา */
function assertOwnImage(url: string): void {
  if (!env.CLOUDINARY_CLOUD_NAME || !url.startsWith(uploadPrefix())) {
    throw badRequest('ประเมินได้เฉพาะรูปที่อัปโหลดผ่านระบบ');
  }
}

/** ใส่ transformation ย่อรูป + บังคับเป็น .jpg (iPhone อัป HEIC มาได้ แต่ Claude อ่าน HEIC ไม่ได้) */
function sizedUrl(url: string, width: number): string {
  const resized = url.replace('/image/upload/', `/image/upload/c_limit,w_${width},q_auto/`);
  return resized.replace(/\.[a-z0-9]+$/i, '.jpg');
}

// ── รูปตัวอย่างของฟาร์ม (few-shot) ─────────────────────────────────────

type LabeledPhoto = {
  historyId: number;
  crabId: number;
  pct: number;
  url: string;
  recordedAt: Date;
  corrected: boolean; // ผู้ใช้แก้ค่าที่ AI เสนอ
};

/** แถวโซน MEASURE ที่มีทั้งรูปและ % ของปูไข่ในฟาร์มของ ownerId (ใหม่ → เก่า) */
async function labeledPhotos(ownerId: number, before?: Date): Promise<LabeledPhoto[]> {
  const rows = await prisma.crabHistory.findMany({
    where: {
      zone: 'MEASURE',
      recordedAt: before ? { lt: before } : undefined,
      crab: { system: { ownerId }, type: { not: 'MEAT' } },
    },
    select: { id: true, crabId: true, recordedAt: true, snapshot: true },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    take: REF_SCAN_LIMIT,
  });
  const out: LabeledPhoto[] = [];
  for (const r of rows) {
    const s = (r.snapshot ?? {}) as Record<string, unknown>;
    if (typeof s.imageUrl !== 'string' || !s.imageUrl) continue;
    if (s.currentFirmnessPct == null) continue;
    const pct = Number(s.currentFirmnessPct);
    if (!Number.isFinite(pct)) continue;
    const ai = s.aiEggPct == null ? null : Number(s.aiEggPct);
    if (ai != null && ai === pct) continue; // รับค่า AI ตรง ๆ = ไม่มีข้อมูลจากคน
    out.push({
      historyId: r.id,
      crabId: r.crabId,
      pct,
      url: s.imageUrl,
      recordedAt: r.recordedAt,
      corrected: ai != null,
    });
  }
  return out;
}

/** เลือกตัวอย่างช่วงละ REF_PER_BUCKET รูป (แถวที่ผู้ใช้แก้ AI ก่อน แล้วใหม่สุด) → เรียง % น้อย→มาก */
function pickReferences(photos: LabeledPhoto[], excludeCrabId?: number): LabeledPhoto[] {
  const buckets = new Map<number, LabeledPhoto[]>();
  for (const p of photos) {
    if (excludeCrabId != null && p.crabId === excludeCrabId) continue;
    const b = Math.min(9, Math.floor(p.pct / 10));
    const list = buckets.get(b) ?? [];
    list.push(p);
    buckets.set(b, list);
  }
  const picked: LabeledPhoto[] = [];
  for (const list of buckets.values()) {
    // stable sort: corrected มาก่อน, ภายในกลุ่มคงลำดับใหม่→เก่าเดิม
    const ordered = [...list.filter((p) => p.corrected), ...list.filter((p) => !p.corrected)];
    picked.push(...ordered.slice(0, REF_PER_BUCKET));
  }
  return picked.sort((a, b) => a.pct - b.pct || a.historyId - b.historyId);
}

/** ดูว่าจะได้รูปตัวอย่างชุดไหน (ไม่เรียก AI — ใช้ใน scripts/egg-eval.ts --dry) */
export async function previewReferences(ownerId: number, opts: { before?: Date; excludeCrabId?: number } = {}) {
  const photos = await labeledPhotos(ownerId, opts.before ?? startOfToday());
  return { candidates: photos, references: pickReferences(photos, opts.excludeCrabId) };
}

/** รอบวัดก่อนหน้าของปูตัวเดียวกัน (มีรูป + %) — ใช้เป็นจุดอ้างอิงว่าไข่โตขึ้นจากเดิมแค่ไหน */
async function previousOfCrab(crabId: number, before?: Date): Promise<LabeledPhoto | null> {
  const rows = await prisma.crabHistory.findMany({
    where: { crabId, zone: 'MEASURE', recordedAt: before ? { lt: before } : undefined },
    select: { id: true, crabId: true, recordedAt: true, snapshot: true },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    take: 10,
  });
  for (const r of rows) {
    const s = (r.snapshot ?? {}) as Record<string, unknown>;
    if (typeof s.imageUrl !== 'string' || !s.imageUrl || s.currentFirmnessPct == null) continue;
    return {
      historyId: r.id,
      crabId: r.crabId,
      pct: Number(s.currentFirmnessPct),
      url: s.imageUrl,
      recordedAt: r.recordedAt,
      corrected: false,
    };
  }
  return null;
}

// ── prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You estimate egg (ovary) fullness of female mud crabs from candling photos taken on a small Thai crab-fattening farm.

How the photos are taken: the farmer shines a bright light through the crab's carapace in a dim place (a lamp under a net, or a flashlight), so the shell glows. Inside, the developing ovary shows up as an opaque, often granular orange-to-dark-red mass, while parts without ovary let more light through. As the crab fills, the mass spreads outward from the middle until it reaches the edges of the carapace under the lateral spines. Lighting, background, angle and exposure vary a lot between photos, so judge how much of the carapace interior the ovary covers, not how bright or dark the picture is overall.

"Egg %" is the farmer's own estimate on a 0–100 scale, where 100 means the ovary fills the carapace right to its edges. The farmer's labeled reference photos define what each number means on this farm, so match their scale rather than any outside convention. Their numbers are hand estimates and are not perfectly consistent, so calibrate against the set as a whole instead of copying the single most similar photo. When an earlier photo of the same crab is provided, use it to judge growth since then; ovaries usually grow over time, but the earlier number may itself be off.

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
const outputZ = z.object({
  usable: z.boolean(),
  eggPct: z.number(),
  confidence: z.enum(EGG_CONFIDENCE),
  reason: z.string(),
});

const daysBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
const roundTo5 = (n: number) => Math.min(100, Math.max(0, Math.round(n / 5) * 5));

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0); // process TZ = Asia/Bangkok (config/env.ts)
  return d;
}

// ── เรียก Claude ─────────────────────────────────────────────────────

export type EstimateParams = {
  ownerId: number; // เจ้าของฟาร์ม — ใช้รูปตัวอย่างของฟาร์มนี้เท่านั้น
  imageUrl: string;
  crabId?: number;
  /** eval: ตัดปูตัวนี้ออกจากชุดตัวอย่าง (กันเฉลยรั่ว) */
  excludeCrabId?: number;
  /** ใช้เฉพาะตัวอย่างที่บันทึกก่อนเวลานี้ (ดีฟอลต์ = เที่ยงคืนวันนี้ → cache นิ่งทั้งวัน) */
  referencesBefore?: Date;
  /** รอบก่อนของปูตัวเดียวกันต้องก่อนเวลานี้ (eval ใช้วันของแถวที่กำลังทดสอบ) */
  previousBefore?: Date;
  now?: Date;
};

export async function estimateEgg(p: EstimateParams): Promise<{ estimate: EggEstimate; usage: EggEstimateUsage }> {
  const anthropic = getClient();
  const now = p.now ?? new Date();
  const [photos, previous] = await Promise.all([
    labeledPhotos(p.ownerId, p.referencesBefore ?? startOfToday()),
    p.crabId != null ? previousOfCrab(p.crabId, p.previousBefore) : Promise.resolve(null),
  ]);
  const refs = pickReferences(photos, p.excludeCrabId);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (refs.length) {
    content.push({
      type: 'text',
      text: `Reference photos from this farm, ordered from emptiest to fullest. Each label is the farmer's egg % for the photo right after it.`,
    });
    refs.forEach((r, i) => {
      content.push({ type: 'text', text: `Reference ${i + 1}: ${r.pct}%` });
      content.push({ type: 'image', source: { type: 'url', url: sizedUrl(r.url, REF_WIDTH) } });
    });
    // ชุดตัวอย่างเหมือนเดิมทั้งวัน → cache ไว้ (ส่องไข่ห่างกันตัวละ 3–8 นาที เกิน 5 นาทีบ่อย จึงใช้ 1h)
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
      text: `Earlier photo of this same crab, taken ${daysBetween(previous.recordedAt, now)} days before the new one. The farmer recorded ${previous.pct}% for it.`,
    });
    content.push({ type: 'image', source: { type: 'url', url: sizedUrl(previous.url, REF_WIDTH) } });
  }
  content.push({ type: 'text', text: 'New photo to estimate:' });
  content.push({ type: 'image', source: { type: 'url', url: sizedUrl(p.imageUrl, TARGET_WIDTH) } });

  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await anthropic.beta.messages.create({
      model: env.EGG_AI_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // ถ้ารุ่นหลักปฏิเสธ (ไม่น่าเกิดกับรูปปู) ให้ server ลองรุ่นสำรองให้เอง
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
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
    estimate: {
      usable: out.usable,
      eggPct: out.usable ? roundTo5(out.eggPct) : null,
      confidence: out.confidence,
      reason: out.reason.trim().slice(0, 200),
      referenceCount: refs.length,
      previousPct: previous?.pct ?? null,
      model: res.model,
    },
    usage: res.usage,
  };
}

/** แปลง error ของ SDK เป็นข้อความไทยที่ผู้ใช้อ่านรู้เรื่อง (เรียงจากเฉพาะ → กว้าง) */
function toAppError(e: unknown): AppError {
  // ⚠️ ห้ามตอบ 503 — หน้าเว็บถือว่า 503 = "ยังไม่เปิดฟีเจอร์" แล้วซ่อนเงียบ ผู้ใช้จะไม่รู้ว่า key ผิด
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new AppError(502, 'ANTHROPIC_API_KEY ใช้ไม่ได้ — ตรวจ key ในไฟล์ .env');
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new AppError(429, 'AI ถูกเรียกถี่เกินไป — รอสักครู่แล้วลองใหม่');
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new AppError(502, `AI เปิดรูปนี้ไม่ได้ — ${e.message}`);
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new AppError(504, 'AI ใช้เวลานานเกินไป — ลองอีกครั้ง หรือกรอก % เอง');
  }
  if (e instanceof Anthropic.APIError) {
    return new AppError(502, `AI มีปัญหาชั่วคราว (${e.status ?? 'network'}) — ลองอีกครั้ง หรือกรอก % เอง`);
  }
  return e instanceof AppError ? e : new AppError(502, 'AI มีปัญหาชั่วคราว — ลองอีกครั้ง');
}

// ── ใช้จาก route ─────────────────────────────────────────────────────

// กันเผลอยิงรัว (บั๊กหน้าเว็บวนลูป = เสียเงินจริง) — ต่อ user ไม่เกิน 60 ครั้ง / 10 นาที
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 60;
const recentCalls = new Map<number, number[]>();
function assertRate(userId: number): void {
  const now = Date.now();
  const calls = (recentCalls.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (calls.length >= RATE_MAX) {
    throw new AppError(429, 'ใช้ AI ประเมินไข่ถี่เกินไป — พักสักครู่แล้วลองใหม่');
  }
  calls.push(now);
  recentCalls.set(userId, calls);
}

export async function estimateEggForUser(
  user: AuthUser,
  input: { imageUrl: string; crabId?: number },
): Promise<EggEstimate> {
  if (!eggAiConfigured()) {
    throw new AppError(503, 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — ใช้ AI ประเมินไข่ไม่ได้');
  }
  assertOwnImage(input.imageUrl);

  // ปูที่มีอยู่แล้ว → ใช้ตัวอย่างจากฟาร์มของเจ้าของปู (+ ต้องมีสิทธิ์แก้ระบบนั้น)
  // ปูใหม่ (รับล็อต) → ใช้ฟาร์มของผู้ใช้เอง
  let ownerId = user.id;
  if (input.crabId != null) {
    const crab = await prisma.crab.findUnique({
      where: { id: input.crabId },
      select: { systemId: true, system: { select: { ownerId: true } } },
    });
    if (!crab) throw notFound('ไม่พบปูตัวนี้');
    await assertCanEditSystem(user, crab.systemId);
    ownerId = crab.system.ownerId ?? user.id;
  }

  assertRate(user.id);
  const { estimate } = await estimateEgg({ ownerId, imageUrl: input.imageUrl, crabId: input.crabId });
  return estimate;
}
