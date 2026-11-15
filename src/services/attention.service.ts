import { prisma } from '../lib/prisma';
import type { AuthUser } from './auth.service';
import { dueSummary } from './reminders/task.service';
import { forecast } from './feed/stock.service';
import { waterAttention } from './water/water.service';
import { unreadForUser } from './community/bug.service';

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
  const [me, systems, lotsNoCost, crabs, due, bugs] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { notifyEmail: true } }),
    prisma.crabSystem.count({ where: { ownerId: user.id } }),
    // ล็อตที่มีปูแล้วแต่ยังไม่ใส่ราคา (ลืมแล้วไปเจอตอนขาย = ปัญหาใหญ่ใน v1)
    prisma.crabLot.count({ where: { ownerId: user.id, totalCost: null, crabs: { some: { deletedAt: null } } } }),
    prisma.crab.count({ where: { ownerId: user.id, deletedAt: null } }),
    dueSummary(user.id),
    unreadForUser(user.id),
  ]);

  // งานแจ้งเตือนที่ถึงเวลาแล้ว (P3) — มีงานด่วน = urgent (หน้าเว็บเด้งป๊อปอัปทุก 1 ชม.)
  if (due.total > 0) {
    items.push({
      key: 'tasks_due',
      level: due.high > 0 ? 'urgent' : 'warn',
      menu: 'reminders',
      target: 'reminders-today',
      title: due.high > 0 ? `มีงานด่วน ${due.high} เรื่องที่ยังไม่ได้ทำ` : `มีงานที่ต้องทำ ${due.total} เรื่อง`,
      cta: 'ดูงาน',
      count: due.total,
    });
  }

  // ── น้ำ (P5) ──
  if (systems > 0) {
    const w = await waterAttention(user.id);
    if (w.missingTargets) {
      items.push({
        key: 'water_targets_missing',
        level: 'setup',
        menu: 'water',
        target: 'water-targets',
        title: `ยังไม่ได้ตั้งเกณฑ์ค่าน้ำ ${w.missingTargets} ค่า`,
        cta: 'ตั้งเกณฑ์',
        count: w.missingTargets,
      });
    }
    if (w.pending) {
      items.push({
        key: 'water_action',
        level: 'warn',
        menu: 'water',
        target: 'water-advice',
        title: `ค่าน้ำหลุดเกณฑ์ ${w.pending} ค่า — ดูว่าต้องใส่อะไร`,
        cta: 'ดู',
        count: w.pending,
      });
    }
  }

  // ── อาหารปู (P4) ──
  if (systems > 0) {
    const [plans, stocked, foods, fc, review] = await Promise.all([
      prisma.feedingPlan.count({ where: { ownerId: user.id } }),
      prisma.feedItem.count({ where: { ownerId: user.id, stockSet: true, active: true } }),
      prisma.feedItem.findMany({ where: { ownerId: user.id, active: true }, select: { id: true, name: true } }),
      forecast(user.id),
      prisma.feedingRound.count({ where: { ownerId: user.id, reviewPending: true } }),
    ]);
    if (plans < systems) {
      items.push({
        key: 'feeding_plan_missing',
        level: 'setup',
        menu: 'feed',
        target: 'feed-plan',
        title: 'ยังไม่ได้ตั้งแผนให้อาหาร',
        cta: 'ตั้งแผน',
      });
    }
    if (!stocked) {
      items.push({
        key: 'feed_stock_missing',
        level: 'setup',
        menu: 'feed',
        target: 'feed-stock',
        title: 'ยังไม่ได้ใส่จำนวนอาหารที่มี',
        cta: 'ใส่สต็อก',
      });
    }
    const low = foods.filter((f) => fc.get(f.id)?.low);
    if (low.length) {
      items.push({
        key: 'feed_low',
        level: 'warn',
        menu: 'feed',
        target: 'feed-stock',
        title: `${low.map((f) => f.name).join(', ')}ใกล้หมด — พอไม่ถึง 2 รอบ`,
        cta: 'ซื้อเพิ่ม',
        count: low.length,
      });
    }
    if (review) {
      items.push({
        key: 'feeding_review',
        level: 'warn',
        menu: 'crabs',
        target: 'crabs-feed-review',
        title: 'มีรอบให้อาหารที่ระบบปิดให้ รอคุณยืนยัน',
        cta: 'ดู',
        count: review,
      });
    }
  }

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

  // ── แจ้งปัญหา (P8): ทีมงานตอบ/เปลี่ยนสถานะแล้ว ผู้ใช้ยังไม่ได้เปิดอ่าน ──
  if (bugs.count > 0) {
    items.push({
      key: 'bug_reply',
      level: 'warn',
      menu: 'community',
      target: 'community-bugs',
      title: bugs.needInfo ? 'ทีมงานขอข้อมูลเพิ่มเรื่องที่คุณแจ้ง' : 'ทีมงานตอบเรื่องที่คุณแจ้งแล้ว',
      cta: 'อ่าน',
      count: bugs.count,
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
