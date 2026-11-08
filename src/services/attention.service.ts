import { prisma } from '../lib/prisma';
import type { AuthUser } from './auth.service';

// ════════════════════════════════════════════════════════════════════
//  ป้าย ⚠ นำทาง — รวม "สิ่งที่ยังไม่ได้ทำ/ยังไม่ได้ตั้งค่า" ไว้ที่เดียว
//  หน้าเว็บใช้ชุดเดียวนี้วาด 3 อย่าง: ⚠ ที่เมนู/ปุ่ม · กล่องข้อความชี้ปุ่ม · รายการเริ่มต้นใช้งาน
//  เพิ่มรายการใหม่ = เพิ่มตัวตรวจในฟังก์ชันนี้ แล้วใส่ data-attention="<key>" ที่ปุ่มเป้าหมาย
//  (ระบบปู/ล็อต/อาหาร/น้ำ จะเพิ่มในเฟสของมัน — ดู docs/v2-plan.md ข้อ 4)
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
  /** ปุ่มเป้าหมายบนหน้านั้น (ค่า data-attention) — หน้าเว็บใช้วาง ⚠ + กล่องข้อความชี้ */
  target: string;
  title: string;
  /** ข้อความบนปุ่มพาไปทำ */
  cta: string;
};

export async function getAttention(user: AuthUser): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { notifyEmail: true } });

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
