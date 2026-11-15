import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import { validate } from '../middleware/validate';
import * as svc from '../services/village/village.service';

// ════════════════════════════════════════════════════════════════════
//  หมู่บ้านฟาร์ม (P9) — /api/village · ชั้น "มีสิทธิ์ใช้งาน"
//  สิทธิ์: เจ้าของ = ฟาร์มตัวเองได้ทุกอย่าง · แขก = ต้องเข้าร่วมหมู่บ้าน + (ฟาร์มเปิด หรือได้รับอนุญาต)
//  เข้าไม่ได้ = 404 (ไม่ใช่ 403) กันไล่เดา id
//  ตำแหน่ง/ท่าทางตัวละครวิ่งทาง WebSocket อย่างเดียว (ไม่มี REST เขียนตำแหน่งโดยตั้งใจ)
// ════════════════════════════════════════════════════════════════════

const router = Router();
const systemParam = z.object({ systemId: z.coerce.number().int().positive() });

/** ค่าสีถูกวาดลง SVG ที่เครื่องคนอื่น → ต้องเป็น hex เป๊ะ ๆ */
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'สีต้องเป็นแบบ #33aa77');
const part = z.string().regex(/^[a-z0-9_-]{1,24}$/i, 'คีย์ไม่ถูกต้อง');

/** .strict() กันยัดคีย์มั่วลงคอลัมน์ Json (เก็บดิบ ๆ แล้วส่งให้คนอื่น) */
const avatarBody = z
  .object({
    skin: part.optional(),
    face: part.optional(),
    hair: part.optional(),
    hairColor: hex.optional(),
    shirt: part.optional(),
    shirtColor: hex.optional(),
    pants: part.optional(),
    pantsColor: hex.optional(),
    hat: part.nullable().optional(),
    hatColor: hex.optional(),
    accessory: part.nullable().optional(),
    mount: part.nullable().optional(),
    mountColor: hex.optional(),
    riding: z.boolean().optional(),
    pet: part.nullable().optional(),
    petColor: hex.optional(),
  })
  .strict();

const tile = z.number().int().min(0).max(200);

const decorBody = z.object({
  items: z
    .array(
      z.object({
        kind: part.max(40),
        x: tile,
        y: tile,
        z: z.number().int().min(0).max(999).default(0),
        rot: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
        scale: z.number().int().min(50).max(200).default(100),
        flip: z.boolean().default(false),
        variant: z.string().max(24).nullable().optional(),
      }),
    )
    .max(300, 'วางของได้ไม่เกิน 300 ชิ้นต่อฟาร์ม'),
});

const text = (max: number, msg: string) => z.string().trim().min(1, msg).max(max, `ยาวเกิน ${max} ตัวอักษร`);

// ── ตัวเรา / สมุดรายชื่อ ──────────────────────────────────────────────
router.get('/me', asyncHandler(async (req, res) => res.json(serialize(await svc.getMyVillage(req.user!)))));

router.put(
  '/me/joined',
  validate({ body: z.object({ joined: z.boolean() }) }),
  asyncHandler(async (req, res) => res.json(await svc.setJoined(req.user!, req.body.joined))),
);

router.put(
  '/me/avatar',
  validate({ body: avatarBody }),
  asyncHandler(async (req, res) => res.json(await svc.updateFarmAvatar(req.user!, req.body))),
);

router.get('/users', asyncHandler(async (req, res) => res.json(await svc.listVillageUsers(req.user!))));

// ── สิทธิ์เข้าชม ──────────────────────────────────────────────────────
router.post(
  '/access',
  validate({ body: z.object({ ownerId: z.number().int().positive(), message: z.string().trim().max(200).nullable().optional() }) }),
  asyncHandler(async (req, res) => res.status(201).json(await svc.requestAccess(req.user!, req.body.ownerId, req.body.message || null))),
);
router.post(
  '/access/:id/approve',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await svc.decideAccess(req.user!, Number(req.params.id), true))),
);
router.post(
  '/access/:id/deny',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await svc.decideAccess(req.user!, Number(req.params.id), false))),
);
router.delete(
  '/access/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await svc.revokeAccess(req.user!, Number(req.params.id)))),
);

// ── ฟาร์ม ────────────────────────────────────────────────────────────
router.get(
  '/farms/:systemId',
  validate({ params: systemParam }),
  asyncHandler(async (req, res) => res.json(serialize(await svc.getFarm(req.user!, Number(req.params.systemId))))),
);
router.patch(
  '/farms/:systemId',
  validate({ params: systemParam, body: z.object({ villageOpen: z.boolean() }) }),
  asyncHandler(async (req, res) => res.json(await svc.setVillageOpen(req.user!, Number(req.params.systemId), req.body.villageOpen))),
);
router.get(
  '/farms/:systemId/logbook',
  validate({ params: systemParam }),
  asyncHandler(async (req, res) => res.json(serialize(await svc.getLogbook(req.user!, Number(req.params.systemId))))),
);
router.put(
  '/farms/:systemId/decor',
  validate({ params: systemParam, body: decorBody }),
  asyncHandler(async (req, res) => res.json(await svc.saveDecor(req.user!, Number(req.params.systemId), req.body.items))),
);

// ── จดหมาย ────────────────────────────────────────────────────────────
router.get(
  '/farms/:systemId/letters',
  validate({ params: systemParam }),
  asyncHandler(async (req, res) => res.json(serialize(await svc.listLetters(req.user!, Number(req.params.systemId))))),
);
router.post(
  '/farms/:systemId/letters',
  validate({
    params: systemParam,
    body: z.object({ x: tile, y: tile, body: text(500, 'พิมพ์ข้อความก่อน'), mood: part.max(16).nullable().optional() }),
  }),
  asyncHandler(async (req, res) => res.status(201).json(serialize(await svc.writeLetter(req.user!, Number(req.params.systemId), req.body)))),
);
router.post(
  '/farms/:systemId/letters/read-all',
  validate({ params: systemParam }),
  asyncHandler(async (req, res) => res.json(await svc.markAllRead(req.user!, Number(req.params.systemId)))),
);
router.post(
  '/letters/:id/reply',
  validate({ params: idParam, body: z.object({ reply: text(500, 'พิมพ์คำตอบก่อน') }) }),
  asyncHandler(async (req, res) => res.json(await svc.replyLetter(req.user!, Number(req.params.id), req.body.reply))),
);
router.post(
  '/letters/:id/read',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await svc.markLetterRead(req.user!, Number(req.params.id)))),
);
router.delete(
  '/letters/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await svc.deleteLetter(req.user!, Number(req.params.id)))),
);

export default router;
