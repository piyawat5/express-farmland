import { z } from 'zod';

/** :id param → number (ใช้ซ้ำในทุก route ที่อ้าง record ด้วย id) */
export const idParam = z.object({
  id: z.coerce.number().int().positive(),
});

/** query แบ่งหน้าแบบเบาๆ */
export const pageQuery = z.object({
  skip: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});
