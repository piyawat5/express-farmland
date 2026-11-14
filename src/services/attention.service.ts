import { prisma } from '../lib/prisma';
import type { AuthUser } from './auth.service';

// ════════════════════════════════════════════════════════════════════
//  ป้าย ⚠ นำทาง — รวม "สิ่งที่ยังไม่ได้ทำ/ยังไม่ได้ตั้งค่า" ไว้ที่เดียว
//  หน้าเว็บใช้ชุดเดียวนี้วาด 3 อย่าง: ⚠ ที่เมนู/ปุ่ม · กล่องข้อความชี้ปุ่ม · รายการเริ่มต้นใช้งาน
//  เพิ่มรายการใหม่ = เพิ่มตัวตรวจในฟังก์ชันนี้ แล้วใส่ AttentionMark k="<target>" ที่ปุ่มเป้าหมาย
// ════════════════════════════════════════════════════════════════════

export type AttentionLevel =
  | 'setup' // ยังตั้งค่าไม่ครบ (อยู่ในรายการเริ่มต้นใช้งาน)
  | 'warn' // ควรทำ
  | 'urgent'; // ต้องทำเดี๋ยวนี้

export type AttentionItem = {
  key: string;
  level: AttentionLevel;
  /** เมนูใน sidebar ที่จะขึ้น ⚠ (ชื่อ route) */
  menu: string;
  /** ปุ่มเป้าหมายบนหน้านั้น — หน้าเว็บใช้วาง ⚠ + กล่องข้อความชี้ */
  target: string;
  title: string;
  /** ข้อความบนปุ่มพาไปทำ */
  cta: string;
  /** ตัวเลขประกอบ เช่น จำนวนล็อตที่ยังไม่ใส่ราคา */
  count?: number;
};

export async function getAttention(user: AuthUser): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const [me, systems, lotsNoCost, crabs] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { notifyEmail: true } }),
    prisma.crabSystem.count({ where: { ownerId: user.id } }),
    // ล็อตที่มีปูแล้วแต่ยังไม่ใส่ราคา (ลืมแล้วไปเจอตอนขาย = ปัญหาใหญ่ใน v1)
    prisma.crabLot.count({ where: { ownerId: user.id, totalCost: null, crabs: { some: { deletedAt: null } } } }),
    prisma.crab.count({ where: { ownerId: user.id, deletedAt: null } }),
  ]);

  if (systems === 0) {
    items.push({
      key: 'system_missing',
      level: 'setup',
      menu: 'crabs',
      target: 'crabs-add-system',
      title: 'ยังไม่ได้สร้างระบบปู',
      cta: 'สร้างระบบปู',
    });
  } else if (crabs === 0) {
    items.push({
      key: 'first_lot_missing',
      level: 'setup',
      menu: 'crabs',
      target: 'crabs-intake',
      title: 'ยังไม่มีปูในระบบ — รับปูล็อตแรกเข้ามาเลย',
      cta: 'รับปูเข้า',
    });
  }

  if (lotsNoCost > 0) {
    items.push({
      key: 'lot_cost_missing',
      level: 'warn',
      menu: 'crabs',
      target: 'crabs-lots',
      title: lotsNoCost === 1 ? 'มี 1 ล็อตที่ยังไม่ใส่ราคา' : `มี ${lotsNoCost} ล็อตที่ยังไม่ใส่ราคา`,
      cta: 'ใส่ราคา',
      count: lotsNoCost,
    });
  }

  if (me && !me.notifyEmail) {
    items.push({
      key: 'notify_email_missing',
      level: 'setup',
      menu: 'profile',
      target: 'profile-notify-email',
      title: 'ยังไม่ได้ใส่อีเมลรับแจ้งเตือน',
      cta: 'ใส่อีเมล',
    });
  }

  return items;
}
