import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { idParam } from '../lib/validation';
import { validate } from '../middleware/validate';
import * as ideas from '../services/community/idea.service';
import * as bugs from '../services/community/bug.service';
import * as news from '../services/community/announcement.service';
import { getContent } from '../services/community/content.service';

// ════════════════════════════════════════════════════════════════════
//  ชุมชน & สอน (P8)
//    /ideas          ชั้น "มีสิทธิ์ใช้งาน"   ไอเดีย + ❤
//    /bugs           ชั้น "ล็อกอินแล้ว"     แจ้งปัญหา (คนที่ยังไม่ได้จ่ายก็แจ้งได้ — แผนข้อ 2)
//    /announcements  ชั้น "ล็อกอินแล้ว"     ประกาศ + รับทราบ
//    /learn          ชั้น "ล็อกอินแล้ว"     ลิงก์คลิปสอน
// ════════════════════════════════════════════════════════════════════

/** รูปต้องมาจากที่เก็บรูปของระบบ (POST /uploads/image) — กันลิงก์รูปจากที่อื่นโผล่ในหลังบ้าน */
export const photosBody = z
  .array(
    z.object({
      url: z
        .string()
        .max(1000)
        .regex(/^https:\/\/res\.cloudinary\.com\//, 'รูปต้องอัปโหลดผ่านระบบ'),
      publicId: z.string().max(300).nullable().optional(),
    }),
  )
  .max(3, 'แนบรูปได้ไม่เกิน 3 รูป');

/** ลิงก์ที่แอดมินใส่ (คลิป/ประกาศ) — http(s) เท่านั้น */
export const httpUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/\S+$/i, 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://');

const ideaStatus = z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'DECLINED']);
const paging = {
  skip: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
};
const flag = z.enum(['1', 'true', '0', 'false']).transform((v) => v === '1' || v === 'true');

// ── ไอเดีย ────────────────────────────────────────────────────────────
export const ideaRouter = Router();

const ideaTitle = z.string().trim().min(3, 'ชื่อไอเดียสั้นไป').max(120, 'ชื่อไอเดียยาวไป (ไม่เกิน 120 ตัวอักษร)');
const ideaBody = z.string().trim().max(3000, 'รายละเอียดยาวไป').nullable().optional();

ideaRouter.get(
  '/',
  validate({ query: z.object({ status: ideaStatus.optional(), mine: flag.optional(), sort: z.enum(['top', 'new']).optional(), ...paging }) }),
  asyncHandler(async (req, res) => {
    res.json(await ideas.listIdeas(req.user!, req.query as unknown as ideas.IdeaQuery));
  }),
);

ideaRouter.post(
  '/',
  validate({ body: z.object({ title: ideaTitle, body: ideaBody }) }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await ideas.createIdea(req.user!, req.body));
  }),
);

ideaRouter.patch(
  '/:id',
  validate({ params: idParam, body: z.object({ title: ideaTitle.optional(), body: ideaBody }) }),
  asyncHandler(async (req, res) => {
    res.json(await ideas.updateIdea(req.user!, Number(req.params.id), req.body));
  }),
);

ideaRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await ideas.removeIdea(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);

/** ❤ — ส่งสถานะที่ต้องการ (ไม่ใช่สลับ) กดซ้ำ/ยิงซ้ำได้ผลเดิม */
ideaRouter.put(
  '/:id/like',
  validate({ params: idParam, body: z.object({ liked: z.boolean() }) }),
  asyncHandler(async (req, res) => {
    res.json(await ideas.setLike(req.user!, Number(req.params.id), req.body.liked));
  }),
);

// ── แจ้งปัญหา ─────────────────────────────────────────────────────────
export const bugRouter = Router();

const bugText = z.string().trim().min(1, 'เล่าสั้นๆ ว่าเกิดอะไรขึ้น').max(4000, 'ข้อความยาวไป');

bugRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await bugs.listMyBugs(req.user!));
  }),
);

bugRouter.post(
  '/',
  validate({
    body: z.object({
      body: bugText,
      photos: photosBody.optional(),
      page: z.string().trim().max(300).nullable().optional(),
      pageTitle: z.string().trim().max(100).nullable().optional(),
      device: z
        .object({
          ua: z.string().max(500).optional(),
          screen: z.string().max(40).optional(),
          theme: z.string().max(40).optional(),
          app: z.string().max(40).optional(),
          lang: z.string().max(20).optional(),
        })
        .nullable()
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await bugs.createBug(req.user!, req.body));
  }),
);

bugRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(await bugs.getMyBug(req.user!, Number(req.params.id)));
  }),
);

bugRouter.post(
  '/:id/comments',
  validate({ params: idParam, body: z.object({ body: bugText, photos: photosBody.optional() }) }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await bugs.commentMyBug(req.user!, Number(req.params.id), req.body));
  }),
);

// ── ประกาศ ────────────────────────────────────────────────────────────
export const announcementRouter = Router();

announcementRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await news.listActive(req.user!));
  }),
);

announcementRouter.post(
  '/:id/ack',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await news.ack(req.user!, Number(req.params.id));
    res.status(204).end();
  }),
);

// ── สอนใช้งาน ─────────────────────────────────────────────────────────
export const learnRouter = Router();

learnRouter.get(
  '/videos',
  asyncHandler(async (_req, res) => {
    res.json((await getContent()).videos);
  }),
);

export { ideaStatus, flag, paging };
