import { Prisma, ReminderRule, ReminderType, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound, badRequest } from '../lib/http';
import type { AuthUser } from './auth.service';
import { isAdmin, assertOwnership } from '../lib/scope';

// ── โมดูล D: Task = งานจริง 1 ชิ้น (instance ของ ReminderRule หรือ event chain) ──
//
// การ "ปิด" Task ต้องมาจากการบันทึก record จริง (เช่น WaterTest) → closeTaskByRecord
// ไม่ใช่แค่กดรับทราบ (CLAUDE.md ข้อ 6)

type TaskFilter = {
  systemId?: number;
  status?: TaskStatus;
  type?: ReminderType;
};

export function listTasks(user: AuthUser, filter: TaskFilter = {}) {
  return prisma.task.findMany({
    where: {
      systemId: filter.systemId,
      status: filter.status,
      type: filter.type,
      ...(isAdmin(user) ? {} : { userId: user.id }), // งานของ user เท่านั้น
    },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    include: { system: { select: { id: true, name: true } } },
  });
}

export async function getTask(id: number, user?: AuthUser) {
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      system: { select: { id: true, name: true } },
      rule: { select: { id: true, title: true, type: true } },
      notifications: { orderBy: { sentAt: 'desc' }, take: 20 },
      childTasks: { select: { id: true, type: true, title: true, status: true, dueAt: true } },
    },
  });
  if (!task) throw notFound('ไม่พบงานนี้');
  if (user) assertOwnership(user, task.userId);
  return task;
}

/** มี Task ที่ยังค้าง (PENDING) ของกฎนี้อยู่ไหม — กันสร้างซ้ำซ้อนตอน tick */
export function hasOpenTaskForRule(ruleId: number) {
  return prisma.task
    .count({ where: { ruleId, status: 'PENDING' } })
    .then((n) => n > 0);
}

/** หา Task ที่ยังค้างของระบบ+ประเภทหนึ่ง (ใช้ตอนปิดงานจาก record จริง) */
export function findOpenTask(systemId: number, type: ReminderType) {
  return prisma.task.findFirst({
    where: { systemId, type, status: 'PENDING' },
    orderBy: { dueAt: 'asc' },
  });
}

export type CreateTaskInput = {
  systemId?: number | null;
  ruleId?: number | null;
  userId?: number | null; // ถ้าระบุ → ใช้เป็นปลายทางตรง (เช่น RESTOCK ที่ไม่ผูกระบบ)
  type: ReminderType;
  title: string;
  detail?: string | null;
  dueAt?: Date;
  reNotifyEveryMin?: number;
  payload?: Prisma.InputJsonValue | null;
  parentTaskId?: number | null;
  linkType?: string | null;
  linkId?: number | null;
};

/** สร้าง Task — resolve ผู้รับแจ้งเตือนจากเจ้าของระบบให้อัตโนมัติ (หรือ userId ที่ระบุ) */
export async function createTask(input: CreateTaskInput) {
  let userId: number | null = input.userId ?? null;
  if (userId == null && input.systemId != null) {
    const sys = await prisma.crabSystem.findUnique({
      where: { id: input.systemId },
      select: { ownerId: true },
    });
    userId = sys?.ownerId ?? null;
  }
  // ทุก Task ต้องมีปลายทางแจ้งเตือน — ถ้ายัง resolve ไม่ได้ (ระบบไม่มี owner)
  // fallback ไปหา user คนแรกที่ active (single user) ไม่งั้น digest จะข้ามงานนี้แบบเงียบ
  if (userId == null) {
    const owner = await prisma.user.findFirst({ where: { active: true }, orderBy: { id: 'asc' } });
    userId = owner?.id ?? null;
  }
  return prisma.task.create({
    data: {
      systemId: input.systemId ?? null,
      ruleId: input.ruleId ?? null,
      userId,
      type: input.type,
      title: input.title,
      detail: input.detail ?? null,
      dueAt: input.dueAt ?? new Date(),
      reNotifyEveryMin: input.reNotifyEveryMin ?? 15,
      payload: input.payload ?? undefined,
      parentTaskId: input.parentTaskId ?? null,
      linkType: input.linkType ?? null,
      linkId: input.linkId ?? null,
    },
  });
}

/** สร้าง Task จาก ReminderRule (ใช้ตอน scheduler tick / event) */
export function createTaskFromRule(rule: ReminderRule, dueAt: Date, parentTaskId?: number) {
  return createTask({
    systemId: rule.systemId,
    ruleId: rule.id,
    userId: rule.ownerId, // กฎกลาง (systemId=null) ก็ส่งให้เจ้าของกฎ ไม่ใช่ user คนแรก
    type: rule.type,
    title: rule.title,
    detail: rule.payload ? `รายละเอียดเพิ่มเติม: ${JSON.stringify(rule.payload)}` : null,
    dueAt,
    reNotifyEveryMin: rule.reNotifyEveryMin,
    payload: (rule.payload as Prisma.InputJsonValue) ?? undefined,
    parentTaskId,
  });
}

/** ปิดงานด้วย record จริง — set DONE + ลิงก์ไป record ที่มาปิด */
export async function closeTaskByRecord(
  taskId: number,
  link: { linkType: string; linkId: number },
) {
  return prisma.task.update({
    where: { id: taskId },
    data: {
      status: 'DONE',
      completedAt: new Date(),
      linkType: link.linkType,
      linkId: link.linkId,
    },
  });
}

/** เปลี่ยนสถานะงานแบบ manual (ข้าม/ยกเลิก) — ห้าม set DONE ทางนี้ (DONE ต้องมาจาก record จริง) */
export async function updateTaskStatus(id: number, user: AuthUser, status: TaskStatus) {
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) throw notFound('ไม่พบงานนี้');
  assertOwnership(user, task.userId);
  if (status === 'DONE') {
    throw badRequest('การปิดงาน (DONE) ต้องมาจากการบันทึกข้อมูลจริง หรือกดปุ่ม "ทำเสร็จแล้ว" (สำหรับงานตามรอบ)');
  }
  return prisma.task.update({
    where: { id },
    data: { status, completedAt: status === 'PENDING' ? null : new Date() },
  });
}

// งานที่ "ปิดได้ด้วยการบันทึก record จริง" เท่านั้น — ห้ามกดทำเสร็จมือเปล่า
//   WATER_TEST → ปิดด้วย WaterTest, DOSING → ปิดเองเมื่อวัดน้ำได้ค่าตรงเกณฑ์, RESTOCK → ปิดเมื่อเติมของในคลัง
// งานที่เหลือ (ให้อาหาร/เติมน้ำจืด/เก็บเศษ/ล้างกรอง/เตรียมจุลินทรีย์/อื่นๆ) เป็นงาน "เตือนเฉยๆ"
// ไม่มี record มาปิด → ให้ผู้ใช้กดปุ่ม "ทำเสร็จแล้ว" เองได้
const RECORD_CLOSED_TYPES: ReminderType[] = ['WATER_TEST', 'DOSING', 'RESTOCK'];

/** ปิดงานตามรอบแบบ manual ("ทำเสร็จแล้ว") — เฉพาะงานเตือนเฉยๆ ที่ไม่มี record มาปิด */
export async function completeTaskManually(id: number, user: AuthUser) {
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) throw notFound('ไม่พบงานนี้');
  assertOwnership(user, task.userId);
  // DOSING ที่มาจากกฎเตือนตามรอบ (ruleId != null เช่น "เติมแร่ธาตุทุก N วัน") เป็นงานเตือนเฉยๆ
  // ไม่มี record (WaterTest) มาปิดให้ → อนุญาตให้กด "ทำเสร็จแล้ว" เองได้
  // ส่วน DOSING จาก event chain (วัดน้ำแล้วค่าหลุด, ruleId == null) ยังต้องปิดด้วยการวัดน้ำรอบใหม่
  const scheduledDosing = task.type === 'DOSING' && task.ruleId != null;
  if (RECORD_CLOSED_TYPES.includes(task.type) && !scheduledDosing) {
    throw badRequest(
      'งานนี้ปิดได้จากการบันทึกข้อมูลจริง (วัดน้ำ/ปรุงน้ำ/เติมของในคลัง) ไม่ใช่กดทำเสร็จมือเปล่า',
    );
  }
  if (task.status !== 'PENDING') return task;
  return prisma.task.update({
    where: { id },
    data: { status: 'DONE', completedAt: new Date() },
  });
}
