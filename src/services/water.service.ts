import { Prisma, WaterParam } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';
import { evaluateWaterValues, type DosingRecommendation, type WaterValues } from './dosing.service';
import { closeTaskByRecord, createTask, findOpenTask } from './task.service';

// ── โมดูล C (น้ำ): WaterTest + WaterTarget ───────────────────────────

async function assertSystem(systemId: number) {
  const exists = await prisma.crabSystem.findUnique({ where: { id: systemId }, select: { id: true } });
  if (!exists) throw notFound('ไม่พบระบบปูนี้');
}

// ── WaterTarget (ช่วงเป้าหมาย min/max ต่อระบบ) ───────────────────────

export function listWaterTargets(systemId: number) {
  return prisma.waterTarget.findMany({ where: { systemId }, orderBy: { id: 'asc' } });
}

/** ตั้งค่าเป้าหมายของพารามิเตอร์หนึ่ง (upsert ตาม systemId+parameter) */
export async function upsertWaterTarget(
  systemId: number,
  data: { parameter: WaterParam; minTarget?: number | null; maxTarget?: number | null; unit?: string | null },
) {
  await assertSystem(systemId);
  return prisma.waterTarget.upsert({
    where: { systemId_parameter: { systemId, parameter: data.parameter } },
    update: {
      minTarget: data.minTarget ?? null,
      maxTarget: data.maxTarget ?? null,
      ...(data.unit !== undefined ? { unit: data.unit } : {}),
    },
    create: {
      systemId,
      parameter: data.parameter,
      minTarget: data.minTarget ?? null,
      maxTarget: data.maxTarget ?? null,
      unit: data.unit ?? null,
    },
  });
}

// ── WaterTest ────────────────────────────────────────────────────────

export function listWaterTests(systemId: number, page: { skip?: number; take?: number } = {}) {
  return prisma.waterTest.findMany({
    where: { systemId },
    orderBy: { testedAt: 'desc' },
    skip: page.skip,
    take: page.take ?? 50,
  });
}

export async function getWaterTest(id: number) {
  const test = await prisma.waterTest.findUnique({
    where: { id },
    include: { dosingRecords: true },
  });
  if (!test) throw notFound('ไม่พบผลวัดน้ำนี้');
  return test;
}

/** ดึงค่าน้ำจาก record มาเป็น WaterValues สำหรับ evaluate */
function toValues(t: {
  ph: Prisma.Decimal | null;
  alkalinity: Prisma.Decimal | null;
  magnesium: Prisma.Decimal | null;
  calcium: Prisma.Decimal | null;
  salinity: Prisma.Decimal | null;
  ammonia: Prisma.Decimal | null;
  nitrite: Prisma.Decimal | null;
}): WaterValues {
  return {
    ph: t.ph,
    alkalinity: t.alkalinity,
    magnesium: t.magnesium,
    calcium: t.calcium,
    salinity: t.salinity,
    ammonia: t.ammonia,
    nitrite: t.nitrite,
  };
}

/** สรุปคำแนะนำที่ "ต้องลงมือ" เป็นข้อความ detail ของ Task ปรุงน้ำ */
function summarizeRecommendations(recs: DosingRecommendation[]): string {
  return recs
    .map((r) => {
      const head = `• ${r.parameter} = ${r.current} (${r.status})`;
      if (r.action === 'DOSE' && r.substance && r.dose != null) {
        return `${head} → เติม ${r.substance.name} ${r.dose} ${r.doseUnit ?? r.substance.unit}`;
      }
      return r.message ? `${head} → ${r.message}` : head;
    })
    .join('\n');
}

/**
 * บันทึกผลวัดน้ำ แล้ว:
 * 1) ปิด Task "วัดค่าน้ำ" ที่ค้างอยู่ของระบบ (DONE + ลิงก์ WaterTest นี้)
 * 2) ประเมินคำแนะนำการปรุงน้ำ
 * 3) ถ้ามีค่าหลุดเป้า → สร้าง Task "ปรุงน้ำ" ต่อทันที (event chain, childTask)
 */
export async function createWaterTest(data: Prisma.WaterTestUncheckedCreateInput) {
  await assertSystem(data.systemId);
  const waterTest = await prisma.waterTest.create({ data });

  // 1) ปิด Task วัดน้ำที่ค้าง (ถ้ามี) — การปิดงานต้องมาจาก record จริง (CLAUDE.md ข้อ 6)
  const openTask = await findOpenTask(waterTest.systemId, 'WATER_TEST');
  if (openTask) {
    await closeTaskByRecord(openTask.id, { linkType: 'WaterTest', linkId: waterTest.id });
    await prisma.waterTest.update({ where: { id: waterTest.id }, data: { taskId: openTask.id } });
  }

  // 2) ประเมินค่า
  const recommendations = await evaluateWaterValues(waterTest.systemId, toValues(waterTest));

  // 3) event chain: ถ้ามีค่าหลุดเป้า → สร้าง Task ปรุงน้ำ (กันซ้ำถ้ายังมีงานปรุงน้ำค้าง)
  let dosingTaskId: number | null = null;
  const actionable = recommendations.filter((r) => r.status !== 'OK' && r.status !== 'NO_TARGET');
  if (actionable.length > 0 && !(await findOpenTask(waterTest.systemId, 'DOSING'))) {
    const task = await createTask({
      systemId: waterTest.systemId,
      type: 'DOSING',
      title: 'ปรุงน้ำตามผลวัดล่าสุด',
      detail: summarizeRecommendations(actionable),
      parentTaskId: openTask?.id ?? null,
      payload: { waterTestId: waterTest.id },
    });
    dosingTaskId = task.id;
  }

  return { waterTest, recommendations, closedTaskId: openTask?.id ?? null, dosingTaskId };
}

export async function updateWaterTest(id: number, data: Prisma.WaterTestUncheckedUpdateInput) {
  await getWaterTest(id);
  return prisma.waterTest.update({ where: { id }, data });
}

export async function deleteWaterTest(id: number) {
  await getWaterTest(id);
  await prisma.waterTest.delete({ where: { id } });
}

/** ประเมินคำแนะนำจากค่าที่กรอกเข้ามาตรงๆ โดยไม่บันทึก (preview ก่อนวัดจริง) */
export async function previewDosing(systemId: number, values: WaterValues) {
  await assertSystem(systemId);
  return evaluateWaterValues(systemId, values);
}
