import type { Priority } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/http';
import { escapeHtml, sendHtmlEmail } from '../../lib/mailer';
import { getAccess } from '../subscription.service';
import { KIND_ICON } from './defaults';
import { dayDiff, parseHours } from './schedule';
import { syncOwner } from './task.service';

// ════════════════════════════════════════════════════════════════════
//  อีเมลสรุปงานค้าง (ข้อ 4.4.3 / 5.8) — ส่งตาม "ชั่วโมงที่ผู้ใช้เลือก" (ค่าเริ่มต้น 08/12/16/20)
//  Plesk Scheduled Task เรียก /api/scheduler/tick ทุก 15 นาที → แอปเลือกเองว่าใครถึงเวลาส่ง
//  - ส่งชั่วโมงละไม่เกิน 1 ฉบับต่อคน (User.lastDigestAt + conditional updateMany กัน tick ซ้อน)
//  - ไม่มีงานค้าง = ไม่ส่ง · ไม่มีอีเมลรับแจ้งเตือน = ไม่ส่ง · หมดสิทธิ์ใช้งาน = ไม่ส่ง
// ════════════════════════════════════════════════════════════════════


const GROUPS: { p: Priority; label: string; color: string }[] = [
  { p: 'HIGH', label: '🔴 ด่วนมาก', color: '#dc2626' },
  { p: 'MEDIUM', label: '🟠 ปานกลาง', color: '#d97706' },
  { p: 'LOW', label: '🟢 ทั่วไป', color: '#16a34a' },
];

type DigestUser = { id: number; name: string | null; notifyEmail: string | null };

/** ประกอบ + ส่งอีเมลสรุปของผู้ใช้ 1 คน — sent=false คือไม่มีงานค้าง (ไม่ส่ง) */
async function sendDigest(u: DigestUser, now: Date, opts: { test?: boolean } = {}): Promise<{ sent: boolean; count: number }> {
  if (!u.notifyEmail) return { sent: false, count: 0 };
  await syncOwner(u.id, now, { force: true });
  const tasks = await prisma.task.findMany({
    where: { ownerId: u.id, status: 'OPEN', dueAt: { lte: now } },
    orderBy: { dueAt: 'asc' },
    select: {
      kind: true,
      title: true,
      priority: true,
      dueAt: true,
      rule: { select: { icon: true } },
      system: { select: { name: true } },
    },
  });
  if (!tasks.length && !opts.test) return { sent: false, count: 0 };

  const multiSystem = new Set(tasks.map((t) => t.system?.name)).size > 1;
  const sections = GROUPS.map((g) => {
    const list = tasks.filter((t) => t.priority === g.p);
    if (!list.length) return '';
    const items = list
      .map((t) => {
        const late = dayDiff(t.dueAt, now);
        const bits = [
          multiSystem && t.system?.name ? escapeHtml(t.system.name) : null,
          late > 0 ? `<span style="color:#dc2626">เลยมา ${late} วัน</span>` : 'วันนี้',
        ].filter(Boolean);
        return `<li style="margin: 6px 0; font-size: 16px;">${t.rule?.icon ?? KIND_ICON[t.kind]} <b>${escapeHtml(t.title)}</b> <span style="color:#64748b">· ${bits.join(' · ')}</span></li>`;
      })
      .join('');
    return `<h3 style="color:${g.color}; margin: 18px 0 4px; font-size: 17px;">${g.label} (${list.length})</h3><ul style="padding-left: 20px; margin: 0;">${items}</ul>`;
  }).join('');

  const hello = `<p style="font-size: 16px; color: #334155;">สวัสดีครับ${u.name ? ` คุณ${escapeHtml(u.name)}` : ''} — ${
    tasks.length ? `มีงานที่ยังไม่ได้ทำ <b>${tasks.length} เรื่อง</b>` : 'ตอนนี้ไม่มีงานค้าง ✓'
  }</p>`;
  const testNote = opts.test ? '<p style="color:#64748b; font-size: 14px;">(อีเมลทดสอบ — ถ้าได้รับฉบับนี้ แปลว่าตั้งค่าอีเมลถูกต้องแล้ว)</p>' : '';
  const button = `<div style="text-align:center; margin-top: 22px;"><a href="${env.FRONTEND_URL}/reminders" style="display:inline-block; background:#0d9488; color:#fff; text-decoration:none; padding: 12px 26px; border-radius: 10px; font-size: 17px;">เปิดดูงานทั้งหมด</a></div>`;

  const high = tasks.filter((t) => t.priority === 'HIGH').length;
  const subject = opts.test
    ? '🦀 ทดสอบอีเมลแจ้งเตือน'
    : `🦀 ${high ? `ด่วน ${high} เรื่อง · ` : ''}งานค้าง ${tasks.length} เรื่อง`;

  await sendHtmlEmail({ to: u.notifyEmail, subject, heading: 'งานที่ยังไม่ได้ทำ', html: hello + testNote + sections + button });
  return { sent: true, count: tasks.length };
}

/** ทุก tick: ใครถึงชั่วโมงส่งแล้วยังไม่ได้ส่งในชั่วโมงนี้ → ส่ง */
export async function runDigests(now = new Date()) {
  const hour = now.getHours();
  const slotStart = new Date(now.getTime());
  slotStart.setMinutes(0, 0, 0);
  const notSentThisHour = { OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: slotStart } }] };

  const users = await prisma.user.findMany({
    where: { active: true, notifyEmail: { not: null }, ...notSentThisHour },
    select: { id: true, name: true, notifyEmail: true, emailHours: true },
  });

  let checked = 0;
  let sent = 0;
  let failed = 0;
  for (const u of users) {
    if (!parseHours(u.emailHours).includes(hour)) continue;
    const access = await getAccess(u.id).catch(() => null);
    if (!access?.active) continue;
    // จองชั่วโมงนี้ก่อนส่ง — tick 2 ตัวซ้อนกันจะได้ส่งแค่ฉบับเดียว
    const claim = await prisma.user.updateMany({ where: { id: u.id, ...notSentThisHour }, data: { lastDigestAt: now } });
    if (claim.count === 0) continue;
    checked++;
    try {
      if ((await sendDigest(u, now)).sent) sent++;
    } catch (err) {
      failed++;
      // eslint-disable-next-line no-console
      console.error(`digest to user ${u.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return { checked, sent, failed };
}

// ── ปุ่ม "ส่งอีเมลทดสอบ" ในหน้าโปรไฟล์ (กันกดรัว: 1 ครั้ง/นาที/คน) ──
const lastTest = new Map<number, number>();

export async function sendTestDigest(userId: number) {
  const t = lastTest.get(userId);
  if (t && Date.now() - t < 60_000) throw new AppError(429, 'เพิ่งส่งไป รอสัก 1 นาทีแล้วลองใหม่');
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, notifyEmail: true } });
  if (!u?.notifyEmail) throw new AppError(400, 'ใส่อีเมลรับแจ้งเตือนก่อน');
  if (!env.EMAIL_USER) throw new AppError(503, 'ระบบยังไม่ได้ตั้งค่าการส่งอีเมล');
  lastTest.set(userId, Date.now());
  try {
    const r = await sendDigest(u, new Date(), { test: true });
    return { sentTo: u.notifyEmail, tasks: r.count };
  } catch (err) {
    lastTest.delete(userId);
    throw new AppError(502, 'ส่งอีเมลไม่สำเร็จ ลองใหม่อีกครั้ง', err instanceof Error ? err.message : undefined);
  }
}
