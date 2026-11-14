import nodemailer from 'nodemailer';
import { env } from '../config/env';

/**
 * SMTP transporter — ใช้อีเมลโดเมนตัวเองบน Host Atom
 * port 587 + secure:false = STARTTLS, port 465 + secure:true = SSL
 */
export const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth:
    env.EMAIL_USER && env.EMAIL_PASS
      ? { user: env.EMAIL_USER, pass: env.EMAIL_PASS }
      : undefined,
});

/** ครอบเนื้อหาด้วย template อีเมลธีมปูคอนโด */
export function renderEmail(content: string, heading = 'แจ้งเตือนงานเลี้ยงปู'): string {
  return `
  <div style="font-family: Arial, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f0f4f8;">
    <div style="background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.08);">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #e76f51; margin: 0;">🦀 ระบบปูคอนโด</h1>
        <p style="color: #2a9d8f; margin-top: 4px;">${heading}</p>
      </div>
      <div style="border-left: 4px solid #2a9d8f; padding-left: 16px; margin: 20px 0;">
        <p style="color: #333; font-size: 16px; line-height: 1.7; white-space: pre-line;">${content}</p>
      </div>
      <div style="margin-top: 28px; padding-top: 18px; border-top: 1px solid #eee; text-align: center; color: #999; font-size: 12px;">
        <p>ส่งอัตโนมัติจากระบบจัดการเลี้ยงปูคอนโด (RAS)</p>
      </div>
    </div>
  </div>`;
}

export interface SendMailInput {
  to?: string; // ถ้าไม่ระบุ ใช้ MAIL_TO จาก env
  subject?: string;
  content: string; // ข้อความ จะถูกครอบด้วย template ให้
  heading?: string;
}

/** ส่งอีเมลแจ้งเตือน 1 ฉบับ */
export async function sendNotificationEmail(input: SendMailInput) {
  const to = input.to ?? env.MAIL_TO;
  if (!to) throw new Error('ไม่ได้กำหนดปลายทางอีเมล (ตั้ง MAIL_TO ใน .env)');

  return transporter.sendMail({
    from: env.MAIL_FROM ?? env.EMAIL_USER,
    to,
    subject: input.subject ?? 'แจ้งเตือนจากระบบปูคอนโด',
    html: renderEmail(input.content, input.heading),
  });
}

/** escape ข้อความที่ผู้ใช้พิมพ์เอง ก่อนใส่ลง HTML ของอีเมล */
export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** กรอบอีเมล v2 (สีหลัก teal เหมือนหน้าเว็บ) — innerHtml ต้อง escape ข้อความผู้ใช้มาแล้ว */
export function renderEmailHtml(innerHtml: string, heading: string): string {
  return `
  <div style="font-family: Kanit, Tahoma, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 16px; background-color: #f0fdfa;">
    <div style="background-color: #ffffff; padding: 24px; border-radius: 14px; border: 1px solid #ccfbf1;">
      <div style="text-align: center; margin-bottom: 18px;">
        <div style="font-size: 30px;">🦀</div>
        <h1 style="color: #0f766e; margin: 4px 0 0; font-size: 22px;">${escapeHtml(heading)}</h1>
      </div>
      ${innerHtml}
      <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #eee; text-align: center; color: #94a3b8; font-size: 12px;">
        ส่งอัตโนมัติจากระบบจัดการปู · ตั้งเวลาส่ง/ปิดอีเมลได้ที่เมนูบัญชี &amp; การแจ้งเตือน
      </div>
    </div>
  </div>`;
}

/** ส่งอีเมล HTML ที่ประกอบเองแล้ว (สรุปงานค้าง) */
export async function sendHtmlEmail(input: { to: string; subject: string; heading: string; html: string }) {
  return transporter.sendMail({
    from: env.MAIL_FROM ?? env.EMAIL_USER,
    to: input.to,
    subject: input.subject,
    html: renderEmailHtml(input.html, input.heading),
  });
}

/** ตรวจว่าเชื่อมต่อ SMTP ได้ไหม (ใช้ตอน startup / debug) */
export async function verifyMailer(): Promise<boolean> {
  try {
    await transporter.verify();
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('SMTP verify failed:', err);
    return false;
  }
}
