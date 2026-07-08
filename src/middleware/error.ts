import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../lib/http';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'ข้อมูลไม่ถูกต้อง',
      details: err.flatten().fieldErrors,
    });
  }

  // อัปโหลดไฟล์ (multer) — เช่น ไฟล์ใหญ่เกิน limit
  if (err instanceof MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์รูปใหญ่เกิน 8MB' : 'อัปโหลดไฟล์ไม่สำเร็จ';
    return res.status(400).json({ error: msg, details: err.code });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'ข้อมูลซ้ำ (unique constraint)', meta: err.meta });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'ไม่พบข้อมูลที่อ้างอิง' });
    }
  }

  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'ไม่พบ endpoint นี้' });
}
