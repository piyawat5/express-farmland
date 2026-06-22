import { prisma } from './prisma';
import { env } from '../config/env';
import { sendNotificationEmail } from './mailer';

// ── ปลายทางแจ้งเตือน: notifyEmail ของระบบ → user → เจ้าของระบบ → MAIL_TO ─
// (ข้อ 4) ถ้าระบบตั้ง notifyEmail ไว้ ให้ส่งไปที่นั่นก่อนเสมอ
type RecipientInfo = {
  user?: { email: string; notifyByEmail: boolean } | null;
  system?: {
    notifyEmail?: string | null;
    owner?: { email: string; notifyByEmail: boolean } | null;
  } | null;
};
// ปลายทาง = อีเมลเฉพาะระบบ → user เจ้าของงาน → เจ้าของระบบ → MAIL_TO (env)
// หมายเหตุ multi-user: เลิกใช้ fallback "user active คนแรก" เพราะจะส่งผิดคน —
// งานทุกใบมี userId (เจ้าของงาน) แล้ว ถ้า resolve ไม่ได้จริงๆ ใช้ MAIL_TO กลางเท่านั้น
function resolveRecipient(t: RecipientInfo): string | null {
  const systemEmail = t.system?.notifyEmail || null; // ข้อ 4 — ลำดับสูงสุด
  const userEmail = t.user?.notifyByEmail === false ? null : t.user?.email;
  const ownerEmail = t.system?.owner?.notifyByEmail === false ? null : t.system?.owner?.email;
  return systemEmail ?? userEmail ?? ownerEmail ?? env.MAIL_TO ?? null;
}

/**
 * ส่งแจ้งเตือน Task 1 ใบทางอีเมล แล้วบันทึก Notification + อัปเดตตัวนับ "ตามจิก"
 * ปลายทาง = email ของ user เจ้าของงาน → เจ้าของระบบ → MAIL_TO (fallback)
 * คืน true ถ้าส่งสำเร็จ
 */
export async function notifyTask(taskId: number): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      user: { select: { email: true, notifyByEmail: true } },
      system: { select: { name: true, notifyEmail: true, owner: { select: { email: true, notifyByEmail: true } } } },
    },
  });
  if (!task) return false;

  const to = resolveRecipient(task);

  const nth = task.notifyCount + 1;
  const subject = `🦀 ${nth > 1 ? `[เตือนซ้ำครั้งที่ ${nth}] ` : ''}${task.title}`;
  const lines = [
    task.detail ?? '',
    '',
    `📅 กำหนด: ${task.dueAt.toLocaleString('th-TH')}`,
    task.system?.name ? `🏠 ระบบ: ${task.system.name}` : '',
    nth > 1 ? `🔁 เตือนมาแล้ว ${task.notifyCount} ครั้ง — กรุณาบันทึกผลเมื่อทำเสร็จเพื่อหยุดการเตือน` : '',
  ].filter(Boolean);
  const content = lines.join('\n');

  if (!to) {
    // ไม่มีปลายทาง → log เป็น FAILED แต่ยังเดินตัวนับต่อ ไม่ให้ tick ค้าง
    await prisma.notification.create({
      data: { taskId, channel: 'EMAIL', subject, body: content, status: 'FAILED', error: 'ไม่มีปลายทางอีเมล' },
    });
    await prisma.task.update({
      where: { id: taskId },
      data: { lastNotifiedAt: new Date(), notifyCount: { increment: 1 } },
    });
    return false;
  }

  try {
    await sendNotificationEmail({ to, subject, content, heading: task.title });
    await prisma.notification.create({
      data: { taskId, channel: 'EMAIL', toAddress: to, subject, body: content, status: 'SENT' },
    });
    await prisma.task.update({
      where: { id: taskId },
      data: { lastNotifiedAt: new Date(), notifyCount: { increment: 1 } },
    });
    return true;
  } catch (err) {
    await prisma.notification.create({
      data: {
        taskId,
        channel: 'EMAIL',
        toAddress: to,
        subject,
        body: content,
        status: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
      },
    });
    // ยังเดินตัวนับ + lastNotifiedAt เพื่อไม่ให้ retry รัวทุก tick (รอรอบ reNotify ถัดไป)
    await prisma.task.update({
      where: { id: taskId },
      data: { lastNotifiedAt: new Date(), notifyCount: { increment: 1 } },
    });
    return false;
  }
}

export type DigestResult = {
  pending: number; // จำนวนงานค้างทั้งหมดที่ถึงกำหนด
  recipients: number; // จำนวนปลายทางที่ส่งเมลสำเร็จ
  throttled: number; // จำนวนปลายทางที่ข้ามเพราะยังไม่ครบรอบเว้นช่วง
  sent: boolean;
};

/**
 * ส่ง "อีเมลสรุปรวม" งานที่ค้าง (PENDING + ถึงกำหนด) — ฉบับเดียวต่อปลายทาง
 * เช่น "คุณมีแจ้งเตือนทั้งหมด 5 รายการที่ยังไม่ได้ทำ" พร้อมลิสต์
 * ถ้าไม่มีงานค้าง → ไม่ส่งอะไรเลย (เงียบ)
 *
 * เว้นช่วง (throttle): เมลสรุปต่อปลายทางจะส่งซ้ำเร็วสุดทุก DIGEST_MIN_INTERVAL_MIN นาที
 * — เว้นแต่มีงานใหม่ที่ยังไม่เคยเตือน (lastNotifiedAt = null) จะส่งทันทีไม่รอครบรอบ
 *
 * ออกแบบให้เรียกจาก cron (Plesk Scheduled Task) ทุกรอบ
 */
export async function notifyPendingDigest(now = new Date()): Promise<DigestResult> {
  const tasks = await prisma.task.findMany({
    where: { status: 'PENDING', dueAt: { lte: now } },
    orderBy: { dueAt: 'asc' },
    include: {
      user: { select: { email: true, notifyByEmail: true } },
      system: { select: { name: true, notifyEmail: true, owner: { select: { email: true, notifyByEmail: true } } } },
    },
  });

  if (tasks.length === 0) return { pending: 0, recipients: 0, throttled: 0, sent: false };

  // จัดกลุ่มงานตามปลายทาง (แต่ละ user แยกกลุ่มกันเองตาม userId ของงาน)
  const groups = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const to = resolveRecipient(t);
    if (!to) continue;
    const list = groups.get(to) ?? [];
    list.push(t);
    groups.set(to, list);
  }

  const throttleMs = env.DIGEST_MIN_INTERVAL_MIN * 60_000;
  let recipients = 0;
  let throttled = 0;
  for (const [to, list] of groups) {
    // เว้นช่วง: ถ้าไม่มีงานใหม่ (ทุกใบเคยเตือนแล้ว) และยังไม่ครบรอบ → ข้าม
    const hasNew = list.some((t) => t.lastNotifiedAt == null);
    const lastSent = list.reduce<Date | null>(
      (acc, t) => (t.lastNotifiedAt && (!acc || t.lastNotifiedAt > acc) ? t.lastNotifiedAt : acc),
      null,
    );
    const throttleOk = lastSent == null || now.getTime() - lastSent.getTime() >= throttleMs;
    if (!hasNew && !throttleOk) {
      throttled++;
      continue;
    }

    const lines = list.map((t, i) => {
      const sys = t.system?.name ? ` (${t.system.name})` : '';
      const overdue = t.notifyCount > 0 ? ` — เตือนมาแล้ว ${t.notifyCount} ครั้ง` : '';
      return `${i + 1}. ${t.title} — กำหนด ${t.dueAt.toLocaleString('th-TH')}${sys}${overdue}`;
    });
    const content = [
      `คุณมีแจ้งเตือนทั้งหมด ${list.length} รายการที่ยังไม่ได้ทำ:`,
      '',
      ...lines,
      '',
      'กรุณาบันทึกผลเมื่อทำเสร็จเพื่อหยุดการเตือน',
    ].join('\n');
    const subject = `🦀 คุณมีงานค้าง ${list.length} รายการที่ยังไม่ได้ทำ`;
    const ids = list.map((t) => t.id);

    try {
      await sendNotificationEmail({ to, subject, content, heading: 'สรุปงานที่ค้างอยู่' });
      await prisma.notification.create({
        data: { taskId: ids[0], channel: 'EMAIL', toAddress: to, subject, body: content, status: 'SENT' },
      });
      await prisma.task.updateMany({
        where: { id: { in: ids } },
        data: { lastNotifiedAt: now, notifyCount: { increment: 1 } },
      });
      recipients++;
    } catch (err) {
      await prisma.notification.create({
        data: {
          taskId: ids[0],
          channel: 'EMAIL',
          toAddress: to,
          subject,
          body: content,
          status: 'FAILED',
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return { pending: tasks.length, recipients, throttled, sent: recipients > 0 };
}
