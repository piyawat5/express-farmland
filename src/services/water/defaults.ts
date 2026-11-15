import { prisma } from '../../lib/prisma';

// ════════════════════════════════════════════════════════════════════
//  ค่าน้ำเริ่มต้นของทุกระบบ (ข้อ 5.7) — สร้างตอนสร้างระบบปู / เปิดหน้าน้ำครั้งแรก
//  ⚠️ ต้องตรงกับหน้าเว็บ src/api/mock/water.ts
//  - ไม่ใส่เกณฑ์ให้ (ยกเว้นหน่วยความเค็ม) — ชุดทดสอบแต่ละฟาร์มใช้หน่วยไม่เหมือนกัน
//    (ฟาร์มหนึ่งวัด Mg เป็น "หยด" 24–30 อีกฟาร์มเป็น ppm 900–1250) → ผู้ใช้ตั้งเองครั้งแรก (⚠ water_targets_missing)
//  - สีขวดตามน้ำยาทดสอบจริง (ผู้ใช้กำหนดตอน v1): pH น้ำเงิน · อัลคาไลน์ เทา · Mg/Ca ม่วง · K ขาว · แอมโมเนีย เขียว · ไนไตรท์ แดง
// ════════════════════════════════════════════════════════════════════

export const DEFAULT_WATER_PARAMS = [
  { key: 'PH', name: 'pH', unit: '', color: '#1976d2' },
  { key: 'ALK', name: 'อัลคาไลน์', unit: '', color: '#6b7280' },
  { key: 'MG', name: 'แมกนีเซียม', unit: '', color: '#8b5cf6' },
  { key: 'CA', name: 'แคลเซียม', unit: '', color: '#6d28d9' },
  { key: 'SAL', name: 'ความเค็ม', unit: 'ppt', color: '#0891b2' },
  { key: 'NH3', name: 'แอมโมเนีย', unit: '', color: '#16a34a' },
  { key: 'NO2', name: 'ไนไตรท์', unit: '', color: '#dc2626' },
  { key: 'K', name: 'โพแทสเซียม', unit: '', color: '#fafafa' },
] as const;

/** สารปรุงน้ำเริ่มต้น (แค่ชื่อ — เพิ่มเองได้ตรงช่องเลือก) */
export const DEFAULT_SUBSTANCES = ['เบกกิ้งโซดา', 'แมกนีเซียม', 'แคลเซียม', 'โพแทสเซียม', 'เกลือ'];

export const defaultParamsData = (ownerId: number, systemId: number) =>
  DEFAULT_WATER_PARAMS.map((p, i) => ({ ...p, ownerId, systemId, sortOrder: i + 1 }));

/** ระบบที่สร้างก่อน P5 ยังไม่มีค่าน้ำ → สร้างให้ตอนเปิดหน้าน้ำ (กันซ้ำด้วย unique systemId+key) */
export async function ensureWaterParams(ownerId: number, systemId: number) {
  const n = await prisma.waterParam.count({ where: { systemId } });
  if (n) return;
  await prisma.waterParam.createMany({ data: defaultParamsData(ownerId, systemId), skipDuplicates: true });
}

export async function ensureSubstances(ownerId: number) {
  const n = await prisma.waterSubstance.count({ where: { ownerId } });
  if (n) return;
  await prisma.waterSubstance.createMany({ data: DEFAULT_SUBSTANCES.map((name) => ({ ownerId, name })), skipDuplicates: true });
}
