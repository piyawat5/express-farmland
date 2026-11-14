import { Router } from 'express';
import { requireActiveSubscription, requireAdmin, requireAuth } from '../middleware/auth';
import healthRoutes from './health';
import authRoutes from './auth';
import billingRoutes, { publicShopHandler } from './billing';
import uploadRoutes from './uploads';
import adminRoutes from './admin';
import attentionRoutes from './attention';
import { contactRouter, crabCheckRouter, crabRouter, eggAiRouter, lotRouter, systemRouter } from './farm';

// ════════════════════════════════════════════════════════════════════
//  ลำดับชั้นสิทธิ์ (สำคัญ — เพิ่ม route ใหม่ให้ถูกชั้น):
//    1. public           health, auth
//    2. ล็อกอินแล้ว        billing (หน้ารอเปิดใช้งาน), uploads, admin (+requireAdmin)
//    3. มีสิทธิ์ใช้งาน      ทุกอย่างของฟาร์ม
// ════════════════════════════════════════════════════════════════════

const api = Router();

// ── 1. public ─────────────────────────────────────────────────────────
api.use(healthRoutes);
api.use('/auth', authRoutes); // /me ใช้ requireAuth ในตัว
api.get('/public/shop', publicShopHandler); // ช่องทางติดต่อ (หน้านโยบาย/ลบข้อมูล ที่ไม่ต้องล็อกอิน)

// ── 2. ล็อกอินแล้ว (ยังไม่ต้องจ่ายเงิน) ─────────────────────────────────
api.use(requireAuth);
api.use('/billing', billingRoutes);
api.use('/uploads', uploadRoutes);
api.use('/admin', requireAdmin, adminRoutes);

// ── 3. ต้องมีสิทธิ์ใช้งาน ────────────────────────────────────────────────
api.use(requireActiveSubscription);
api.use('/attention', attentionRoutes);
// ฟาร์ม (P2)
api.use('/systems', systemRouter);
api.use('/contacts', contactRouter);
api.use('/lots', lotRouter);
api.use('/crabs', crabRouter);
api.use('/crab-checks', crabCheckRouter);
api.use('/egg-ai', eggAiRouter);

export default api;
