import { Router } from 'express';
import healthRoutes from './health';
import { systemRouter, boxRouter, filterTankRouter } from './systems';
import crabRoutes from './crabs';
import { waterSystemRouter, waterTestRouter } from './water';
import { substanceRouter, dosingSystemRouter, calibrationRouter, ruleRouter } from './dosing';
import { schedulerRouter, reminderRuleRouter, taskRouter, systemEventRouter } from './scheduler';

const api = Router();

api.use(healthRoutes);

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
// D. Reminder engine (scheduler tick + กฎ + งาน + event chain)
api.use('/scheduler', schedulerRouter);
api.use('/reminder-rules', reminderRuleRouter);
api.use('/tasks', taskRouter);
api.use('/systems', systemEventRouter);

// โมดูลถัดไปจะ mount ที่นี่ (เรียงตาม phase):
// api.use('/contacts', contactRoutes);    // E. คู่ค้า
// api.use('/dashboard', dashboardRoutes); // F. การเงิน

export default api;
