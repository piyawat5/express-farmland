import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/http';
import { realtimeInfo } from '../lib/realtime';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'express-farmland',
    version: 2,
    time: new Date().toISOString(),
    // realtime (WebSocket) ซิงค์รอบให้อาหารหลายเครื่อง — หน้าเว็บอ่านค่านี้ก่อนต่อ (ปิด = ใช้ polling)
    realtime: realtimeInfo(),
  });
});

// เช็คว่าต่อ DB ได้จริงไหม
router.get(
  '/health/db',
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  }),
);

export default router;
