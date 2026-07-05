import { prisma } from '../lib/prisma';
import { createTask } from './task.service';

// ── เตือนเช็คไข่/เนื้อตามอายุการเลี้ยง (ข้อ 3) ─────────────────────────
//
// เกณฑ์ตั้งต่อระบบ (CrabSystem.eggCheckDays / meatCheckDays):
//   ปูที่ยังมีชีวิต + เลี้ยงครบเกณฑ์ (นับจาก lastCheckedAt ?? purchaseDate) → สร้าง Task CRAB_CHECK
// task ปิดเมื่อ: บันทึกค่าวัดใหม่ (โซน MEASURE ใน crab.service) หรือกด "ทำเสร็จแล้ว"
// mirror รูปแบบ generateRestockTasks/ensureRestockTask ใน inventory.service.ts

const MS_PER_DAY = 1000 * 60 * 60 * 24;

type DueCrab = {
  id: number;
  code: string | null;
  type: 'EGG' | 'MEAT';
  days: number;
  threshold: number;
};

/** สร้าง Task CRAB_CHECK ให้ปูตัวนี้ (กันซ้ำถ้ามี PENDING อยู่แล้ว) — คืน 1 ถ้าสร้างใหม่ */
async function ensureCrabCheckTask(
  crab: DueCrab,
  system: { id: number; ownerId: number | null },
  now: Date,
): Promise<number> {
  const existing = await prisma.task.count({
    where: { status: 'PENDING', type: 'CRAB_CHECK', linkType: 'Crab', linkId: crab.id },
  });
  if (existing > 0) return 0;
  const what = crab.type === 'EGG' ? '%ไข่' : 'ความแน่นเนื้อ';
  await createTask({
    type: 'CRAB_CHECK',
    systemId: system.id,
    userId: system.ownerId,
    title: `ถึงกำหนดเช็ค${what}: ${crab.code ?? '#' + crab.id}`,
    detail: `เลี้ยงมา ${crab.days} วันแล้ว (เกณฑ์ ${crab.threshold} วัน) — ควรเช็ค${what}`,
    dueAt: now,
    linkType: 'Crab',
    linkId: crab.id,
  });
  return 1;
}

/**
 * กวาดปูที่ถึงกำหนดเช็คทั้งหมด → สร้าง Task CRAB_CHECK (เรียกจาก scheduler.tick)
 * คืนจำนวน Task ที่สร้างใหม่
 */
export async function generateCrabCheckTasks(now: Date): Promise<number> {
  const systems = await prisma.crabSystem.findMany({
    where: { OR: [{ eggCheckDays: { not: null } }, { meatCheckDays: { not: null } }] },
    select: { id: true, ownerId: true, eggCheckDays: true, meatCheckDays: true },
  });
  if (systems.length === 0) return 0;

  let created = 0;
  for (const sys of systems) {
    const crabs = await prisma.crab.findMany({
      where: {
        systemId: sys.id,
        status: { in: ['FATTENING', 'READY'] },
        type: { in: ['EGG', 'MEAT'] },
      },
      select: { id: true, code: true, type: true, purchaseDate: true, lastCheckedAt: true },
    });
    for (const c of crabs) {
      const threshold = c.type === 'EGG' ? sys.eggCheckDays : sys.meatCheckDays;
      if (threshold == null) continue;
      const since = c.lastCheckedAt ?? c.purchaseDate;
      if (!since) continue; // ไม่มีวันอ้างอิง → ข้าม
      const days = Math.floor((now.getTime() - since.getTime()) / MS_PER_DAY);
      if (days < threshold) continue;
      created += await ensureCrabCheckTask(
        { id: c.id, code: c.code, type: c.type as 'EGG' | 'MEAT', days, threshold },
        sys,
        now,
      );
    }
  }
  return created;
}
