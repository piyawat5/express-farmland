import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/http';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'express-farmland', time: new Date().toISOString() });
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
