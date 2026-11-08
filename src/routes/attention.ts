import { Router } from 'express';
import { asyncHandler } from '../lib/http';
import { getAttention } from '../services/attention.service';

// GET /api/attention → รายการป้าย ⚠ นำทางของผู้ใช้ปัจจุบัน
const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ items: await getAttention(req.user!) });
  }),
);

export default router;
