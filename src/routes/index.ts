import { Router } from 'express';
import healthRoutes from './health';
import authRoutes from './auth';
import { requireAuth } from '../middleware/auth';
import { systemRouter, boxRouter, filterTankRouter } from './systems';
import crabRoutes from './crabs';
import { waterSystemRouter, waterTestRouter } from './water';
import { substanceRouter, dosingSystemRouter, calibrationRouter, ruleRouter } from './dosing';
import { schedulerRouter, reminderRuleRouter, taskRouter, systemEventRouter } from './scheduler';
import { contactRouter, transactionRouter, outreachRouter } from './commerce';
import { ledgerRouter, dashboardRouter } from './finance';
import inventoryRoutes from './inventory';
import uploadRoutes from './uploads';

const api = Router();

// ── public / secret-protected (ไม่ต้อง login) ────────────────────────
api.use(healthRoutes);
api.use('/auth', authRoutes); // register/login/refresh — public; /me มี requireAuth ในตัว
api.use('/scheduler', schedulerRouter); // ป้องกันด้วย x-scheduler-secret (Plesk cron) — ไม่ใช้ JWT

// ── ทุก endpoint ใต้จากนี้ต้อง login ──────────────────────────────────
api.use(requireAuth);

// A. ฮาร์ดแวร์
api.use('/systems', systemRouter);
api.use('/boxes', boxRouter);
api.use('/filter-tanks', filterTankRouter);
// B. ปู
api.use('/crabs', crabRoutes);
// C. น้ำ + การปรุงน้ำ (หลาย router ซ้อนบน /systems ได้ — แยกตามโมดูล)
api.use('/systems', waterSystemRouter);
api.use('/systems', dosingSystemRouter);
api.use('/water-tests', waterTestRouter);
api.use('/substances', substanceRouter);
api.use('/dosing-calibrations', calibrationRouter);
api.use('/dosing-rules', ruleRouter);
// D. Reminder engine (กฎ + งาน + event chain) — tick อยู่ใน schedulerRouter ด้านบน
api.use('/reminder-rules', reminderRuleRouter);
api.use('/tasks', taskRouter);
api.use('/systems', systemEventRouter);
// E. คู่ค้า & การซื้อขาย (Contact / Transaction / OutreachLog)
api.use('/contacts', contactRouter);
api.use('/transactions', transactionRouter);
api.use('/outreach', outreachRouter);
// F. การเงิน (สมุดบัญชี + dashboard/analytics)
api.use('/ledger', ledgerRouter);
api.use('/dashboard', dashboardRouter);
// G. คลังของ (อาหาร/สาร/อุปกรณ์ + แจ้งเตือนใกล้หมด)
api.use('/inventory', inventoryRoutes);
// รูปภาพประวัติพัฒนาการปู (Cloudinary)
api.use('/uploads', uploadRoutes);

export default api;
