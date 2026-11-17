import { prisma } from '../lib/prisma';
import type { AuthUser } from './auth.service';
import { dueSummary } from './reminders/task.service';
import { forecast } from './feed/stock.service';
import { waterAttention } from './water/water.service';
import { unreadForUser } from './community/bug.service';
import { villageAttention } from './village/village.service';

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
  /** เรื่องนี้เป็นของระบบไหนบ้าง — หน้าเว็บโชว์ ⚠ บนปุ่มเฉพาะตอนเลือกระบบนั้นอยู่ (เมนูยังขึ้นถ้ามีระบบไหนค้าง) */
  systemIds?: number[];
  /** อาหารที่เกี่ยวข้อง — หน้าเว็บวาง ⚠ ที่ปุ่ม "ซื้อ" ของอาหารนั้น */
  itemIds?: number[];
};

/** "ระบบปู 2" เมื่อมีหลายระบบ — มีระบบเดียวไม่ต้องบอกชื่อ */
const sysPrefix = (names: string[], total: number) => (total > 1 && names.length ? `${names.join(', ')}: ` : '');

export async function getAttention(user: AuthUser): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const [me, systems, lotsNoCost, crabs, due, bugs, village] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { notifyEmail: true } }),
    prisma.crabSystem.count({ where: { ownerId: user.id } }),
    // ล็อตที่มีปูแล้วแต่ยังไม่ใส่ราคา (ลืมแล้วไปเจอตอนขาย = ปัญหาใหญ่ใน v1)
    prisma.crabLot.count({ where: { ownerId: user.id, totalCost: null, crabs: { some: { deletedAt: null } } } }),
    prisma.crab.count({ where: { ownerId: user.id, deletedAt: null } }),
    dueSummary(user.id),
    unreadForUser(user.id),
    villageAttention(user.id),
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
  // ลำดับนำทางในหน้าน้ำ: ตั้งเกณฑ์ (ปุ่มตั้งเกณฑ์) → วัดครั้งแรก (ปุ่มบันทึกค่าน้ำ) → หลุดเกณฑ์ (คำแนะนำ)
  if (systems > 0) {
    const w = await waterAttention(user.id);
    if (w.missing.length) {
      const n = w.missing.reduce((s, x) => s + x.count, 0);
      items.push({
        key: 'water_targets_missing',
        level: 'setup',
        menu: 'water',
        target: 'water-targets',
        title: `${sysPrefix(w.missing.map((x) => x.name), w.systems)}ยังไม่ได้ตั้งเกณฑ์ค่าน้ำ ${n} ค่า`,
        cta: 'ตั้งเกณฑ์',
        count: n,
        systemIds: w.missing.map((x) => x.systemId),
      });
    }
    if (w.noTest.length) {
      items.push({
        key: 'water_first_test',
        level: 'setup',
        menu: 'water',
        target: 'water-record',
        title: `${sysPrefix(w.noTest.map((x) => x.name), w.systems)}ตั้งเกณฑ์แล้ว วัดค่าน้ำครั้งแรกเลย`,
        cta: 'บันทึกค่าน้ำ',
        systemIds: w.noTest.map((x) => x.systemId),
      });
    }
    if (w.pending.length) {
      const n = w.pending.reduce((s, x) => s + x.count, 0);
      items.push({
        key: 'water_action',
        level: 'warn',
        menu: 'water',
        target: 'water-advice',
        title: `${sysPrefix(w.pending.map((x) => x.name), w.systems)}ค่าน้ำหลุดเกณฑ์ ${n} ค่า ดูว่าต้องใส่อะไร`,
        cta: 'ดู',
        count: n,
        systemIds: w.pending.map((x) => x.systemId),
      });
    }
  }

  // ── อาหารปู (P4) ── ลำดับนำทาง: ตั้งแผน (ต่อระบบ) → ใส่จำนวนอาหารที่อยู่ในแผน (ปุ่ม "ซื้อ" ของอาหารนั้น)
  if (systems > 0) {
    const [allSystems, plans, foods, fc, review] = await Promise.all([
      prisma.crabSystem.findMany({ where: { ownerId: user.id }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      prisma.feedingPlan.findMany({ where: { ownerId: user.id }, select: { systemId: true, itemId: true, altItemId: true, pattern: true } }),
      prisma.feedItem.findMany({ where: { ownerId: user.id, active: true }, select: { id: true, name: true, stockSet: true } }),
      forecast(user.id),
      prisma.feedingRound.count({ where: { ownerId: user.id, reviewPending: true } }),
    ]);
    const planned = new Set(plans.map((p) => p.systemId));
    const noPlan = allSystems.filter((s) => !planned.has(s.id));
    if (noPlan.length) {
      items.push({
        key: 'feeding_plan_missing',
        level: 'setup',
        menu: 'feed',
        target: 'feed-plan',
        title: `${sysPrefix(noPlan.map((s) => s.name), allSystems.length)}ยังไม่ได้ตั้งแผนให้อาหาร`,
        cta: 'ตั้งแผน',
        systemIds: noPlan.map((s) => s.id),
      });
    }
    // อาหารเริ่มต้น (ปลา/หอย) มีให้แล้ว · ที่ต้องใส่จำนวนคืออาหารที่อยู่ในแผน (อย่างอื่นไม่บังคับ)
    // ยังไม่มีแผนเลย = นับแบบเดิม (ยังไม่มีอาหารไหนใส่จำนวน) ให้รายการเริ่มต้นใช้งานยังเห็นขั้นนี้
    const inPlan = new Set(plans.flatMap((p) => [p.itemId, p.pattern === 'ALTERNATE' ? p.altItemId : null]).filter((x): x is number => x != null));
    const unstocked = plans.length ? foods.filter((f) => inPlan.has(f.id) && !f.stockSet) : foods.some((f) => f.stockSet) ? [] : foods;
    if (unstocked.length) {
      items.push({
        key: 'feed_stock_missing',
        level: 'setup',
        menu: 'feed',
        target: 'feed-stock-set',
        title: plans.length ? `ใส่จำนวน${unstocked.map((f) => f.name).join(', ')}ที่มี ระบบจะเตือนก่อนหมด` : 'ยังไม่ได้ใส่จำนวนอาหารที่มี',
        cta: 'ใส่จำนวน',
        itemIds: unstocked.map((f) => f.id),
      });
    }
    const low = foods.filter((f) => fc.get(f.id)?.low);
    if (low.length) {
      items.push({
        key: 'feed_low',
        level: 'warn',
        menu: 'feed',
        target: 'feed-low',
        title: `${low.map((f) => f.name).join(', ')}ใกล้หมด พอไม่ถึง 2 รอบ`,
        cta: 'ซื้อเพิ่ม',
        count: low.length,
        itemIds: low.map((f) => f.id),
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
      title: 'ยังไม่มีปูในระบบ รับปูล็อตแรกเข้ามาเลย',
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

  // ── หมู่บ้านฟาร์ม (P9): มีคนขอเข้าชม / จดหมายใหม่ในฟาร์มเรา / เจ้าของฟาร์มตอบจดหมายของเรา ──
  if (village.requests > 0) {
    items.push({
      key: 'village_request',
      level: 'warn',
      menu: 'village',
      target: 'village-requests',
      title: village.requests === 1 ? 'มีคนขอเข้าชมฟาร์มของคุณ' : `มี ${village.requests} คนขอเข้าชมฟาร์มของคุณ`,
      cta: 'ดูคำขอ',
      count: village.requests,
    });
  }
  if (village.letters + village.replies > 0) {
    items.push({
      key: 'village_mail',
      level: 'warn',
      menu: 'village',
      target: 'village-mail',
      title: village.letters ? `มีจดหมายใหม่ในฟาร์มของคุณ ${village.letters} ฉบับ` : 'เพื่อนบ้านตอบจดหมายของคุณแล้ว',
      cta: 'อ่าน',
      count: village.letters + village.replies,
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
