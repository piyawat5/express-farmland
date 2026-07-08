import { Router } from 'express';
import multer from 'multer';
import { asyncHandler, AppError, badRequest } from '../lib/http';
import { serialize } from '../lib/serialize';
import { cloudinaryConfigured, uploadImage } from '../lib/cloudinary';

// ════════════════════════════════════════════════════════════════════
//  Uploads — รูปภาพประวัติพัฒนาการปู (เก็บบน Cloudinary, signed)
// ════════════════════════════════════════════════════════════════════

// เก็บไฟล์ใน memory แล้วส่ง buffer ต่อให้ Cloudinary (ไม่แตะดิสก์)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB/รูป
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new AppError(400, 'อัปโหลดได้เฉพาะไฟล์รูปภาพ'));
  },
});

const router = Router();

// POST /api/uploads/crab-image  (multipart field: image) → { url, publicId }
router.post(
  '/crab-image',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!cloudinaryConfigured()) {
      throw new AppError(503, 'ยังไม่ได้ตั้งค่า Cloudinary (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)');
    }
    if (!req.file) throw badRequest('ไม่พบไฟล์รูป (field "image")');
    const result = await uploadImage(req.file.buffer);
    res.status(201).json(serialize(result));
  }),
);

export default router;
