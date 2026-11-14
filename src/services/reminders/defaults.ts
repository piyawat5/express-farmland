import type { Prisma, Priority, ReminderKind, RepeatType } from '@prisma/client';
import { nextDueAfter } from './schedule';

// ════════════════════════════════════════════════════════════════════
//  แจ้งเตือนเริ่มต้น 6 เรื่อง (ข้อ 4.4.4) — สร้างให้เองตอนสร้างระบบปู · ลบไม่ได้ ได้แค่ปิด/ปรับรอบ/ปรับความสำคัญ
//  ⚠️ แก้รายการนี้ต้องแก้ src/api/mock/reminders.ts ของหน้าเว็บให้ตรงกันด้วย
// ════════════════════════════════════════════════════════════════════

export type DefaultRule = {
  key: ReminderKind;
  title: string;
  icon: string;
  priority: Priority;
  repeat: RepeatType;
  everyDays: number | null;
  timeOfDay: string;
};

export const DEFAULT_RULES: DefaultRule[] = [
  { key: 'WATER_TEST', title: 'วัดค่าน้ำ', icon: '💧', priority: 'HIGH', repeat: 'EVERY_DAYS', everyDays: 4, timeOfDay: '08:00' },
  { key: 'FEEDING', title: 'ให้อาหารปู', icon: '🍤', priority: 'HIGH', repeat: 'FEEDING_PLAN', everyDays: null, timeOfDay: '18:00' },
  { key: 'CRAB_CHECK', title: 'เช็คเนื้อ/ไข่ปู', icon: '🦀', priority: 'LOW', repeat: 'EVERY_DAYS', everyDays: 21, timeOfDay: '08:00' },
  { key: 'MICROBES', title: 'ใส่จุลินทรีย์', icon: '🧪', priority: 'MEDIUM', repeat: 'EVERY_DAYS', everyDays: 4, timeOfDay: '08:00' },
  { key: 'FRESHWATER', title: 'เติมน้ำจืด', icon: '🚰', priority: 'HIGH', repeat: 'EVERY_DAYS', everyDays: 3, timeOfDay: '08:00' },
  { key: 'FILTER', title: 'เปลี่ยนใยกรองละเอียด', icon: '🧽', priority: 'LOW', repeat: 'EVERY_DAYS', everyDays: 5, timeOfDay: '08:00' },
];

export const DEFAULT_ORDER = DEFAULT_RULES.map((r) => r.key as string);

/** อีโมจิของงานแต่ละแบบ (กฎที่ผู้ใช้สร้างเองเลือกอีโมจิเองได้) */
export const KIND_ICON: Record<ReminderKind, string> = {
  WATER_TEST: '💧',
  FEEDING: '🍤',
  CRAB_CHECK: '🦀',
  MICROBES: '🧪',
  FRESHWATER: '🚰',
  FILTER: '🧽',
  CUSTOM: '🔔',
  LOT_COST: '💰',
};

/** รอบเช็คปูถ้ายังไม่มีกฎ (ระบบเก่าก่อน P3) */
export const DEFAULT_CHECK_DAYS = 21;

/**
 * แถวกฎเริ่มต้นของระบบใหม่ — รอบแรกนับ "เหมือนเพิ่งทำวันนี้"
 * (ไม่งั้นสร้างระบบเสร็จ พรุ่งนี้เช้างานเด้งพร้อมกัน 4 เรื่อง — แบบนี้กระจายเป็นอีก 3/4/4/5 วัน)
 */
export function defaultRulesData(ownerId: number, systemId: number, now: Date): Prisma.ReminderRuleCreateManyInput[] {
  return DEFAULT_RULES.map((d) => ({
    ownerId,
    systemId,
    kind: d.key,
    defaultKey: d.key,
    title: d.title,
    icon: d.icon,
    priority: d.priority,
    repeat: d.repeat,
    everyDays: d.everyDays,
    timeOfDay: d.timeOfDay,
    // เช็คปู = ตามปูที่ถึงรอบ (nextDueAt ใช้เป็น "พักเตือนถึง") · ให้อาหาร = ตามแผน (P4)
    nextDueAt: d.repeat === 'EVERY_DAYS' && d.key !== 'CRAB_CHECK' ? nextDueAfter({ ...d, weekdays: null }, now) : null,
  }));
}
