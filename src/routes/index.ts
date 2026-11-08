import { Router } from 'express';
import { requireActiveSubscription, requireAdmin, requireAuth } from '../middleware/auth';
import healthRoutes from './health';
import authRoutes from './auth';
import billingRoutes from './billing';
import uploadRoutes from './uploads';
import adminRoutes from './admin';
import attentionRoutes from './attention';

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

// ── 2. ล็อกอินแล้ว (ยังไม่ต้องจ่ายเงิน) ─────────────────────────────────
api.use(requireAuth);
api.use('/billing', billingRoutes);
api.use('/uploads', uploadRoutes);
api.use('/admin', requireAdmin, adminRoutes);

// ── 3. ต้องมีสิทธิ์ใช้งาน ────────────────────────────────────────────────
api.use(requireActiveSubscription);
api.use('/attention', attentionRoutes);

export default api;
