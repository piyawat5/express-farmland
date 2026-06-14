/**
 * Seed ข้อมูลจริงของผู้ใช้ — รัน: `npm run prisma:seed`
 * ออกแบบให้รันซ้ำได้ (idempotent): upsert / skipDuplicates ทุกที่
 *
 * scope รอบนี้ = โครงสร้างโมดูล A + master list (User, ระบบ, กล่อง, ถังกรอง,
 * WaterTarget เปล่า, Substance) — ยังไม่ seed ReminderRule/DosingRule
 *
 * ⚠️ ค่าตัวเลขส่วนใหญ่เป็น placeholder ให้ผู้ใช้ปรับเอง:
 *  - WaterTarget min/max = null (ผู้ใช้กรอกช่วงเป้าหมายเอง เช่น alkalinity 10–14 หยด)
 *  - การคำนวณ dosing จริงอิง calibration ต่อระบบ (ดู memory: dosing-calibration-model)
 */
import { PrismaClient, SubstanceCategory, WaterParam } from '@prisma/client';
import { nextCronAfter } from '../src/lib/cron';

const prisma = new PrismaClient();

// ── ค่าคงที่ของระบบจริง ──────────────────────────────────────────────
const OWNER_EMAIL = 'jame.piyawat111@gmail.com';
const SYSTEM_NAME = 'ระบบข้างบ้าน';
const WATER_VOLUME_L = 500;

// กล่อง 30 ใบ แบบ grid: แถว = ตัวอักษร (A,B,C) × คอลัมน์ = เลข (1..10)
// ซ้ายบนสุด = A1 — ขยายเป็นร้อยกล่องได้ง่ายในอนาคต
const BOX_ROWS = ['A', 'B', 'C'];
const BOX_COLS = 10;

const FILTER_TANK_COUNT = 3;

// หน่วยวัดของแต่ละพารามิเตอร์ (min/max ให้ผู้ใช้กรอกเอง)
const WATER_TARGETS: { parameter: WaterParam; unit: string }[] = [
  { parameter: 'PH', unit: 'pH' },
  { parameter: 'ALKALINITY', unit: 'หยด' }, // วัดแบบ titration → นับหยด
  { parameter: 'MAGNESIUM', unit: 'ppm' },
  { parameter: 'CALCIUM', unit: 'ppm' },
  { parameter: 'SALINITY', unit: 'ppt' },
  { parameter: 'AMMONIA', unit: 'ppm' },
  { parameter: 'NITRITE', unit: 'ppm' },
];

// master list สาร/จุลินทรีย์ (หน่วย/ปริมาณ ผู้ใช้ปรับเองได้)
const SUBSTANCES: {
  name: string;
  category: SubstanceCategory;
  unit: string;
  needsPrep?: boolean;
  prepLeadDays?: number;
  needsRepurchase?: boolean;
  note?: string;
}[] = [
  { name: 'แร่ธาตุรวม', category: 'MINERAL', unit: 'ช้อนแกง' },
  { name: 'แมกนีเซียม', category: 'MINERAL', unit: 'ช้อนแกง' },
  { name: 'แคลเซียม', category: 'MINERAL', unit: 'ช้อนแกง' },
  { name: 'เบกกิ้งโซดา', category: 'MINERAL', unit: 'ช้อนแกง', note: 'ใช้ดัน alkalinity ขึ้น' },
  { name: 'เกลือ', category: 'MINERAL', unit: 'กรัม', note: 'ปรับ salinity' },
  {
    name: 'จุลินทรีย์สังเคราะห์แสง',
    category: 'MICROORGANISM',
    unit: 'มล.',
    needsPrep: true,
    prepLeadDays: 7,
    note: 'ต้องเพาะล่วงหน้านาน',
  },
  {
    name: 'จุลินทรีย์ ปม.1',
    category: 'MICROORGANISM',
    unit: 'มล.',
    needsPrep: true,
    prepLeadDays: 1,
  },
  {
    name: 'แบคทีเรีย biodigest',
    category: 'MICROORGANISM',
    unit: 'มล.',
    needsRepurchase: true,
    note: 'ต้องซื้อเรื่อยๆ',
  },
];

async function main() {
  // 1) เจ้าของระบบ
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { notifyByEmail: true, active: true },
    create: { email: OWNER_EMAIL, name: 'เจ้าของฟาร์ม', notifyByEmail: true },
  });
  console.log(`👤 user: ${owner.email} (id ${owner.id})`);

  // 2) CrabSystem (ไม่มี unique บน name → หาเองก่อน)
  let system = await prisma.crabSystem.findFirst({
    where: { name: SYSTEM_NAME, ownerId: owner.id },
  });
  if (!system) {
    system = await prisma.crabSystem.create({
      data: { name: SYSTEM_NAME, ownerId: owner.id, waterVolumeL: WATER_VOLUME_L },
    });
  } else {
    system = await prisma.crabSystem.update({
      where: { id: system.id },
      data: { waterVolumeL: WATER_VOLUME_L },
    });
  }
  console.log(`🦀 system: ${system.name} (id ${system.id}, ${WATER_VOLUME_L} L)`);

  // 3) กล่องปู (grid A1..C10) — skipDuplicates กัน seed ซ้ำ
  const boxRows = BOX_ROWS.flatMap((row) =>
    Array.from({ length: BOX_COLS }, (_, i) => ({
      systemId: system!.id,
      code: `${row}${i + 1}`,
    })),
  );
  const boxes = await prisma.crabBox.createMany({ data: boxRows, skipDuplicates: true });
  console.log(`📦 boxes: +${boxes.count} (รวมเป้าหมาย ${boxRows.length})`);

  // 4) ถังกรอง (ไม่มี unique → สร้างเฉพาะถ้ายังไม่มี)
  const existingTanks = await prisma.filterTank.count({ where: { systemId: system.id } });
  if (existingTanks < FILTER_TANK_COUNT) {
    const toCreate = Array.from({ length: FILTER_TANK_COUNT - existingTanks }, (_, i) => ({
      systemId: system!.id,
      name: `ถังกรอง ${existingTanks + i + 1}`,
    }));
    await prisma.filterTank.createMany({ data: toCreate });
    console.log(`🧪 filter tanks: +${toCreate.length} (รวม ${FILTER_TANK_COUNT})`);
  } else {
    console.log(`🧪 filter tanks: มีครบ ${existingTanks} แล้ว`);
  }

  // 5) WaterTarget 7 พารามิเตอร์ (min/max เปล่า ให้ผู้ใช้กรอกเอง)
  for (const t of WATER_TARGETS) {
    await prisma.waterTarget.upsert({
      where: { systemId_parameter: { systemId: system.id, parameter: t.parameter } },
      update: { unit: t.unit },
      create: { systemId: system.id, parameter: t.parameter, unit: t.unit },
    });
  }
  console.log(`🎯 water targets: ${WATER_TARGETS.length} พารามิเตอร์ (min/max ยังว่าง)`);

  // 6) Substance master list
  for (const s of SUBSTANCES) {
    await prisma.substance.upsert({
      where: { name: s.name },
      update: {
        category: s.category,
        unit: s.unit,
        needsPrep: s.needsPrep ?? false,
        prepLeadDays: s.prepLeadDays ?? null,
        needsRepurchase: s.needsRepurchase ?? false,
        note: s.note ?? null,
      },
      create: {
        name: s.name,
        category: s.category,
        unit: s.unit,
        needsPrep: s.needsPrep ?? false,
        prepLeadDays: s.prepLeadDays ?? null,
        needsRepurchase: s.needsRepurchase ?? false,
        note: s.note ?? null,
      },
    });
  }
  console.log(`⚗️  substances: ${SUBSTANCES.length} ตัว`);

  // 7) ReminderRule ตัวอย่าง (idempotent — หาเองด้วย systemId+type+title)
  //    ค่าตัวเลข (รอบวัน/เวลา) เป็น placeholder ให้ผู้ใช้ปรับเอง
  const now = new Date();
  const REMINDER_RULES = [
    {
      type: 'WATER_TEST' as const,
      title: 'วัดค่าน้ำประจำ',
      scheduleKind: 'INTERVAL_DAYS' as const,
      intervalValue: 3, // ทุก 3 วัน
      reNotifyEveryMin: 15, // ตามจิกทุก 15 นาทีจนกว่าจะบันทึกผลวัด
      nextRunAt: now, // ให้ tick แรกสร้าง Task ทันที (สำหรับทดสอบ vertical slice)
    },
    {
      type: 'FEEDING' as const,
      title: 'ให้อาหารปู (วันเว้นวัน 2 ทุ่ม)',
      scheduleKind: 'CRON' as const,
      cronExpr: '0 20 */2 * *',
      timeOfDay: '20:00',
      reNotifyEveryMin: 30,
      nextRunAt: nextCronAfter('0 20 */2 * *', now),
    },
    {
      type: 'WATER_TEST' as const,
      title: 'วัดค่าน้ำหลังเติมน้ำจืด',
      scheduleKind: 'EVENT' as const,
      triggerEvent: 'AFTER_FRESHWATER' as const,
      reNotifyEveryMin: 15,
      nextRunAt: null, // EVENT — สร้างจากเหตุการณ์ ไม่ใช่ตามเวลา
    },
  ];

  for (const r of REMINDER_RULES) {
    const existing = await prisma.reminderRule.findFirst({
      where: { systemId: system.id, type: r.type, title: r.title },
    });
    if (existing) {
      await prisma.reminderRule.update({ where: { id: existing.id }, data: { ...r, systemId: system.id } });
    } else {
      await prisma.reminderRule.create({ data: { ...r, systemId: system.id } });
    }
  }
  console.log(`🔔 reminder rules: ${REMINDER_RULES.length} กฎ (วัดน้ำ/ให้อาหาร/วัดน้ำหลังเติมน้ำจืด)`);

  console.log('✅ seed เสร็จสมบูรณ์');
}

main()
  .catch((e) => {
    console.error('❌ seed ล้มเหลว:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
