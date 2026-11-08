import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler, AppError, badRequest } from '../lib/http';
import { cloudinaryConfigured, uploadImage } from '../lib/cloudinary';
import { validate } from '../middleware/validate';

// ════════════════════════════════════════════════════════════════════
//  Uploads — รูปทั้งระบบเก็บบน Cloudinary (signed ผ่าน backend)
//  POST /api/uploads/image?kind=slip|crab|bug  (multipart field: image) → { url, publicId }
//  ใช้ได้แค่ requireAuth (ไม่ต้องมีสิทธิ์ใช้งาน) เพราะหน้ารอเปิดใช้งานต้องอัปสลิปได้
// ════════════════════════════════════════════════════════════════════

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB/รูป
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new AppError(400, 'อัปโหลดได้เฉพาะไฟล์รูปภาพ'));
  },
});

const FOLDERS = { slip: 'farmland-v2/slip', crab: 'farmland-v2/crab', bug: 'farmland-v2/bug' } as const;

const router = Router();

router.post(
  '/image',
  validate({ query: z.object({ kind: z.enum(['slip', 'crab', 'bug']).default('crab') }) }),
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!cloudinaryConfigured()) {
      throw new AppError(503, 'ยังไม่ได้ตั้งค่าที่เก็บรูป (CLOUDINARY_*)');
    }
    if (!req.file) throw badRequest('ไม่พบไฟล์รูป (field "image")');
    const kind = (req.query.kind as keyof typeof FOLDERS) ?? 'crab';
    // แยกโฟลเดอร์ตามผู้ใช้ → ตามลบ/ตรวจทีหลังได้ง่าย
    res.status(201).json(await uploadImage(req.file.buffer, `${FOLDERS[kind]}/u${req.user!.id}`));
  }),
);

export default router;
