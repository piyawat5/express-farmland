import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { env } from '../config/env';

// ── Cloudinary — เก็บรูปประวัติพัฒนาการปู (โซน MEASURE) ──
// signed upload ผ่าน backend (มี API secret) — FE อัปไฟล์มาที่ /api/uploads/crab-image
// env: CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
//   (ผู้ใช้ใส่ค่าจริงทีหลัง — ถ้ายังไม่ตั้ง endpoint จะตอบ 503 ชัดเจน)

let configured = false;

/** ตั้งค่า cloudinary จาก env (ครั้งเดียว) — คืน true ถ้ามี env ครบ */
export function cloudinaryConfigured(): boolean {
  if (configured) return true;
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return false;
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
  return true;
}

export type UploadedImage = { url: string; publicId: string };

/** อัปโหลด buffer รูปขึ้น Cloudinary → คืน { url, publicId } */
export function uploadImage(buffer: Buffer, folder = 'farmland/crab'): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result?: UploadApiResponse) => {
        if (err || !result) return reject(err ?? new Error('อัปโหลดรูปไม่สำเร็จ'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

/** ลบรูปบน Cloudinary ด้วย publicId — best-effort (เงียบถ้าพัง) */
export async function deleteImage(publicId: string | null | undefined): Promise<void> {
  if (!publicId || !cloudinaryConfigured()) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  } catch {
    /* ลบไม่สำเร็จ = ปล่อยผ่าน ไม่ให้ block flow หลัก */
  }
}
