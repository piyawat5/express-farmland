/** AppError — โยน error พร้อม HTTP status เพื่อให้ error middleware จัดการ */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (msg = 'ไม่พบข้อมูล') => new AppError(404, msg);
export const badRequest = (msg = 'ข้อมูลไม่ถูกต้อง', details?: unknown) =>
  new AppError(400, msg, details);

/** ห่อ async route handler ให้ส่ง error เข้า next() อัตโนมัติ */
import type { NextFunction, Request, Response } from 'express';

export const asyncHandler =
  <T>(fn: (req: Request, res: Response, next: NextFunction) => Promise<T>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);
