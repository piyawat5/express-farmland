import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import { requireFarmView, systemIdFromParam } from '../middleware/auth';
import { farmPresence } from '../lib/realtime';
import * as svc from '../services/village.service';

// ════════════════════════════════════════════════════════════════════
//  H. หมู่บ้านฟาร์ม (Phase 23) — mount ที่ /api/village (ใต้ requireAuth)
//
//  สิทธิ์ 3 ระดับ:
//   - login เฉย ๆ  : สมุดรายชื่อ / ขอเข้าชม / กล่องขาเข้าของตัวเอง
//   - เข้าชมได้    : assertCanViewFarm ใน service (404 ถ้าไม่ได้รับอนุญาต ไม่ใช่ 403)
//   - เจ้าของฟาร์ม : assertCanEditSystem ใน service (ตกแต่ง / ตอบจดหมาย)
// ════════════════════════════════════════════════════════════════════

const systemIdParam = z.object({ systemId: z.coerce.number().int().positive() });

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'ต้องเป็นสี hex เช่น #33aa77');
const partKey = z.string().max(24);

/** .strict() กันยัด key มั่วลง Json column (ค่าที่รับมาถูกเก็บดิบ ๆ) */
const avatarBody = z
  .object({
    skin: partKey.optional(),
    face: partKey.optional(),
    hair: partKey.optional(),
    hairColor: hexColor.optional(),
    shirt: partKey.optional(),
    shirtColor: hexColor.optional(),
    pants: partKey.optional(),
    pantsColor: hexColor.optional(),
    hat: partKey.nullable().optional(),
    hatColor: hexColor.optional(),
    accessory: partKey.nullable().optional(),
  })
  .strict();

const tile = z.number().int().min(0).max(200);

const decorItem = z.object({
  kind: z.string().min(1).max(40),
  x: tile,
  y: tile,
  z: z.number().int().min(0).max(999).default(0),
  rot: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  scale: z.number().int().min(50).max(200).default(100),
  flip: z.boolean().default(false),
  variant: z.string().max(24).nullable().optional(),
});

const decorBody = z.object({ items: z.array(decorItem).max(300) });

const letterBody = z.object({
  x: tile,
  y: tile,
  body: z.string().min(1).max(500),
  mood: z.string().max(16).nullable().optional(),
});

const villageRouter = Router();

// ── สมุดรายชื่อ + โปรไฟล์ตัวเอง ────────────────────────────────────────
villageRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.listVillageUsers(req.user!)));
  }),
);

villageRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getMyVillage(req.user!)));
  }),
);

villageRouter.patch(
  '/me/avatar',
  validate({ body: avatarBody }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateFarmAvatar(req.user!.id, req.body)));
  }),
);

villageRouter.get(
  '/inbox',
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getInbox(req.user!)));
  }),
);

villageRouter.post(
  '/replies/seen',
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.markRepliesSeen(req.user!)));
  }),
);

// ── สิทธิ์เยี่ยมชม ────────────────────────────────────────────────────
villageRouter.post(
  '/access/request',
  validate({
    body: z.object({
      ownerId: z.number().int().positive(),
      message: z.string().max(200).nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const out = await svc.requestAccess(req.user!, req.body.ownerId, req.body.message);
    res.status(201).json(serialize(out));
  }),
);

villageRouter.post(
  '/access/:id/approve',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.decideAccess(req.user!, Number(req.params.id), true)));
  }),
);

villageRouter.post(
  '/access/:id/deny',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.decideAccess(req.user!, Number(req.params.id), false)));
  }),
);

villageRouter.delete(
  '/access/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.revokeAccess(req.user!, Number(req.params.id))));
  }),
);

// ── ฟาร์ม (snapshot / ตกแต่ง / ใครอยู่ในฟาร์ม) ────────────────────────
villageRouter.get(
  '/farms/:systemId',
  validate({ params: systemIdParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getFarmSnapshot(req.user!, Number(req.params.systemId))));
  }),
);

villageRouter.get(
  '/farms/:systemId/presence',
  validate({ params: systemIdParam }),
  requireFarmView(systemIdFromParam('systemId')),
  asyncHandler(async (req, res) => {
    res.json(serialize(farmPresence(Number(req.params.systemId))));
  }),
);

villageRouter.put(
  '/farms/:systemId/decor',
  validate({ params: systemIdParam, body: decorBody }),
  asyncHandler(async (req, res) => {
    const out = await svc.replaceDecor(req.user!, Number(req.params.systemId), req.body.items);
    res.json(serialize(out));
  }),
);

// ── จดหมาย ────────────────────────────────────────────────────────────
villageRouter.get(
  '/farms/:systemId/letters',
  validate({ params: systemIdParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.listLetters(req.user!, Number(req.params.systemId))));
  }),
);

villageRouter.post(
  '/farms/:systemId/letters',
  validate({ params: systemIdParam, body: letterBody }),
  asyncHandler(async (req, res) => {
    const out = await svc.createLetter(req.user!, Number(req.params.systemId), req.body);
    res.status(201).json(serialize(out));
  }),
);

villageRouter.post(
  '/farms/:systemId/letters/read-all',
  validate({ params: systemIdParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.markLettersRead(req.user!, Number(req.params.systemId))));
  }),
);

villageRouter.post(
  '/letters/:id/reply',
  validate({ params: idParam, body: z.object({ reply: z.string().min(1).max(500) }) }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.replyLetter(req.user!, Number(req.params.id), req.body.reply)));
  }),
);

villageRouter.delete(
  '/letters/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.deleteLetter(req.user!, Number(req.params.id))));
  }),
);

export default villageRouter;
