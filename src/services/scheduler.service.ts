import { prisma } from '../lib/prisma';
import { notifyPendingDigest } from '../lib/notify';
import { createTaskFromRule, hasOpenTaskForRule } from './task.service';
import { computeNextRunAt } from './reminder.service';
import { generateRestockTasks } from './inventory.service';
import { generateCrabCheckTasks } from './crabCheck.service';

// ── โมดูล D: Scheduler — เรียกจาก Plesk Scheduled Task (cron) ทุกรอบ ──
//
// 1) generateDueTasks — กฎที่ถึงรอบ (nextRunAt <= now) → สร้าง Task + เลื่อน nextRunAt
// 2) notifyPendingDigest — ถ้ามี Task ค้าง (PENDING + ถึงกำหนด) → ส่ง "เมลสรุปรวม" ฉบับเดียว
//    ถ้าไม่มีงานค้าง → เงียบ (ไม่ส่ง)
//
// ความถี่ "ตามจิก" = ความถี่ cron ที่ตั้งไว้บน Plesk (เช่นทุก 15 นาที)
// ดูข้อจำกัด Passenger ใน CLAUDE.md: ห้ามพึ่ง in-process cron เป็นกลไกหลัก

export type TickResult = {
  now: string;
  generated: number; // จำนวน Task ที่สร้างใหม่จากกฎ
  restock: number; // จำนวน Task RESTOCK ที่สร้างใหม่จากของใกล้หมด
  crabCheck: number; // จำนวน Task CRAB_CHECK ที่สร้างใหม่ (ปูถึงกำหนดเช็ค, ข้อ 3)
  pending: number; // จำนวนงานค้างทั้งหมดที่ถึงกำหนด
  emailsSent: number; // จำนวนเมลสรุปที่ส่ง (0 = ไม่มีงานค้าง/ส่งไม่สำเร็จ)
};

/** กฎที่ถึงรอบ → สร้าง Task (กันสร้างซ้ำถ้ายังมีงานเดิมค้าง) แล้วเลื่อน nextRunAt */
async function generateDueTasks(now: Date): Promise<number> {
  const rules = await prisma.reminderRule.findMany({
    where: { active: true, nextRunAt: { lte: now } },
  });

  let created = 0;
  for (const rule of rules) {
    if (!(await hasOpenTaskForRule(rule.id))) {
      await createTaskFromRule(rule, rule.nextRunAt ?? now);
      created++;
    }
    // เลื่อนรอบถัดไปไม่ว่าจะสร้างหรือไม่ (กันค้างวน)
    const next = computeNextRunAt(rule, now);
    await prisma.reminderRule.update({
      where: { id: rule.id },
      data: { lastRunAt: now, nextRunAt: next },
    });
  }
  return created;
}

/** เรียกจาก endpoint /scheduler/tick หรือ internal cron ตอน dev */
export async function tick(now = new Date()): Promise<TickResult> {
  const generated = await generateDueTasks(now);
  const restock = await generateRestockTasks(now); // ของใกล้หมด → Task RESTOCK
  const crabCheck = await generateCrabCheckTasks(now); // ปูถึงกำหนดเช็ค → Task CRAB_CHECK (ข้อ 3)
  const digest = await notifyPendingDigest(now);
  return {
    now: now.toISOString(),
    generated,
    restock,
    crabCheck,
    pending: digest.pending,
    emailsSent: digest.recipients,
  };
}
