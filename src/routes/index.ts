import { Router } from 'express';
import { requireActiveSubscription, requireAdmin, requireAuth } from '../middleware/auth';
import healthRoutes from './health';
import authRoutes from './auth';
import billingRoutes, { publicShopHandler } from './billing';
import uploadRoutes from './uploads';
import adminRoutes from './admin';
import attentionRoutes from './attention';
import { contactRouter, crabCheckRouter, crabRouter, eggAiRouter, lotRouter, systemRouter } from './farm';
import { reminderRouter, schedulerRouter } from './reminders';
import { feedRouter } from './feed';
import { waterRouter } from './water';
import { ledgerRouter, saleRouter } from './sales';
import { announcementRouter, bugRouter, ideaRouter, learnRouter } from './community';
import villageRouter from './village';
import { markDirty } from '../services/reminders/task.service';

// ════════════════════════════════════════════════════════════════════
//  ลำดับชั้นสิทธิ์ (สำคัญ — เพิ่ม route ใหม่ให้ถูกชั้น):
//    1. public           health, auth, scheduler (ใช้ secret แทนการล็อกอิน)
//    2. ล็อกอินแล้ว        billing (หน้ารอเปิดใช้งาน), uploads, admin (+requireAdmin), แจ้งปัญหา, ประกาศ, คลิปสอน
//    3. มีสิทธิ์ใช้งาน      ทุกอย่างของฟาร์ม
// ════════════════════════════════════════════════════════════════════

const api = Router();

// ── 1. public ─────────────────────────────────────────────────────────
api.use(healthRoutes);
api.use('/auth', authRoutes); // /me ใช้ requireAuth ในตัว
api.get('/public/shop', publicShopHandler); // ช่องทางติดต่อ (หน้านโยบาย/ลบข้อมูล ที่ไม่ต้องล็อกอิน)
api.use('/scheduler', schedulerRouter); // Plesk Scheduled Task ทุก 15 นาที (ส่งอีเมลแจ้งเตือนตามเวลา)

// ── 2. ล็อกอินแล้ว (ยังไม่ต้องจ่ายเงิน) ─────────────────────────────────
api.use(requireAuth);
api.use('/billing', billingRoutes);
api.use('/uploads', uploadRoutes);
api.use('/admin', requireAdmin, adminRoutes);
// ชุมชน (P8) — ยังไม่ได้จ่ายก็แจ้งปัญหา/อ่านประกาศได้
api.use('/bugs', bugRouter);
api.use('/announcements', announcementRouter);
api.use('/learn', learnRouter);

// ── 3. ต้องมีสิทธิ์ใช้งาน ────────────────────────────────────────────────
api.use(requireActiveSubscription);
// ข้อมูลฟาร์มเปลี่ยน (ใส่ราคาล็อต / เช็คปู / รับปู) → งานแจ้งเตือนอัตโนมัติต้องคำนวณใหม่ทันทีในคำขอถัดไป
api.use((req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => markDirty(req.user!.id));
  next();
});
api.use('/attention', attentionRoutes);
// ฟาร์ม (P2)
api.use('/systems', systemRouter);
api.use('/contacts', contactRouter);
api.use('/lots', lotRouter);
api.use('/crabs', crabRouter);
api.use('/crab-checks', crabCheckRouter);
api.use('/egg-ai', eggAiRouter);
// แจ้งเตือน (P3)
api.use('/reminders', reminderRouter);
// อาหารปู (P4)
api.use('/feed', feedRouter);
// น้ำ (P5)
api.use('/water', waterRouter);
// ขาย & บัญชี (P6)
api.use('/sales', saleRouter);
api.use('/ledger', ledgerRouter);
// ไอเดีย (P8)
api.use('/ideas', ideaRouter);
// หมู่บ้านฟาร์ม (P9)
api.use('/village', villageRouter);

export default api;
