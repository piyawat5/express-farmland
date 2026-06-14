import { Prisma, ReminderRule, ReminderType, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound, badRequest } from '../lib/http';

// ── โมดูล D: Task = งานจริง 1 ชิ้น (instance ของ ReminderRule หรือ event chain) ──
//
// การ "ปิด" Task ต้องมาจากการบันทึก record จริง (เช่น WaterTest) → closeTaskByRecord
// ไม่ใช่แค่กดรับทราบ (CLAUDE.md ข้อ 6)

type TaskFilter = {
  systemId?: number;
  status?: TaskStatus;
  type?: ReminderType;
};

export function listTasks(filter: TaskFilter = {}) {
  return prisma.task.findMany({
    where: { systemId: filter.systemId, status: filter.status, type: filter.type },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    include: { system: { select: { id: true, name: true } } },
  });
}

export async function getTask(id: number) {
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
  type: ReminderType;
  title: string;
  detail?: string | null;
  dueAt?: Date;
  reNotifyEveryMin?: number;
  payload?: Prisma.InputJsonValue | null;
  parentTaskId?: number | null;
};

/** สร้าง Task — resolve ผู้รับแจ้งเตือนจากเจ้าของระบบให้อัตโนมัติ */
export async function createTask(input: CreateTaskInput) {
  let userId: number | null = null;
  if (input.systemId != null) {
    const sys = await prisma.crabSystem.findUnique({
      where: { id: input.systemId },
      select: { ownerId: true },
    });
    userId = sys?.ownerId ?? null;
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
    },
  });
}

/** สร้าง Task จาก ReminderRule (ใช้ตอน scheduler tick / event) */
export function createTaskFromRule(rule: ReminderRule, dueAt: Date, parentTaskId?: number) {
  return createTask({
    systemId: rule.systemId,
    ruleId: rule.id,
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
export async function updateTaskStatus(id: number, status: TaskStatus) {
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) throw notFound('ไม่พบงานนี้');
  if (status === 'DONE') {
    throw badRequest('การปิดงาน (DONE) ต้องมาจากการบันทึกข้อมูลจริง เช่นบันทึกผลวัดน้ำ');
  }
  return prisma.task.update({
    where: { id },
    data: { status, completedAt: status === 'PENDING' ? null : new Date() },
  });
}
