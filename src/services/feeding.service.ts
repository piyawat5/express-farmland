import { Prisma, type FeedingPlan, type FeedingRound } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/http';
import { assertOwnership } from '../lib/scope';
import { publish } from '../lib/realtime';
import { createTask, closeTaskByRecord } from './task.service';
import type { AuthUser } from './auth.service';
import {
  feedTimeOn,
  isFeedDay,
  nextFeedRunAt,
  previewFeedDays,
  scoreFromTags,
  ymdLocal,
} from '../lib/feedingCycle';

// ════════════════════════════════════════════════════════════════════
//  โมดูล B2 — แผนให้อาหาร + รอบให้อาหาร (Phase 21)
//
//  ลำดับงานจริงของผู้ใช้:
//   20:00 ให้อาหาร → ผ่านไป 2–3 ชม. เดินเก็บเศษ แล้วไล่ดูทีละกล่องว่าตัวไหนกินหมด/เหลือ
//   → บันทึกทีละตัว (แบ่งกันทำได้ 2 คน) → ครบทุกตัว = ปิดรอบ + ฉลอง
//
//  ผูกกับของเดิม: ยัง set Crab.feedingNote / lastFedAt และเขียน CrabHistory โซน FEEDING
//  เหมือน crab.service.logFeeding ทุกประการ → หน้าเว็บเดิมไม่ regress
// ════════════════════════════════════════════════════════════════════

const STALE_ROUND_MS = 48 * 3_600_000; // รอบ OPEN ที่เกินนี้ = เลิกสนใจ (ป้ายค้างบนกล่อง)
/** สถานะปูที่ต้องให้อาหาร (ไม่นับขาย/ตาย/ถูกลบ) */
const LIVE_STATUS: Prisma.EnumCrabStatusFilter = { in: ['FATTENING', 'READY'] };

// ── helper: ตรวจสิทธิ์ระบบ (เจ้าของ = CrabSystem.ownerId; ไม่ผ่าน = 404) ──
async function assertSystemAccess(systemId: number, user: AuthUser) {
  const sys = await prisma.crabSystem.findUnique({
    where: { id: systemId },
    select: { id: true, name: true, ownerId: true },
  });
  if (!sys) throw notFound('ไม่พบระบบปูนี้');
  assertOwnership(user, sys.ownerId);
  return sys;
}

// ─────────────────────────── แผนให้อาหาร ───────────────────────────

export type FeedingPlanInput = {
  onDays: number;
  offDays: number;
  anchorDate: Date;
  timeOfDay: string;
  recordLeadHours?: number;
  active?: boolean;
  note?: string | null;
};

/** แผน + วันถัดไป + พรีวิว 14 วัน (ให้ผู้ใช้เห็นทันทีว่ารอบตกวันไหน) */
export async function getPlan(systemId: number, user: AuthUser) {
  await assertSystemAccess(systemId, user);
  const plan = await prisma.feedingPlan.findUnique({ where: { systemId } });
  return {
    plan,
    preview: plan ? previewFeedDays(plan, new Date(), 14) : [],
  };
}

export async function upsertPlan(systemId: number, user: AuthUser, input: FeedingPlanInput) {
  await assertSystemAccess(systemId, user);
  if (input.onDays < 1) throw badRequest('ต้องให้อาหารอย่างน้อย 1 วันต่อรอบ');

  const base = {
    onDays: input.onDays,
    offDays: input.offDays,
    anchorDate: input.anchorDate,
    timeOfDay: input.timeOfDay,
    recordLeadHours: input.recordLeadHours ?? 3,
    active: input.active ?? true,
    note: input.note ?? null,
  };
  // คำนวณรอบถัดไปใหม่ทุกครั้งที่แก้แผน (ไม่งั้น nextDueAt ค้างของเก่า)
  const nextDueAt = base.active ? nextFeedRunAt(base, new Date()) : null;

  const plan = await prisma.feedingPlan.upsert({
    where: { systemId },
    create: { systemId, ...base, nextDueAt },
    update: { ...base, nextDueAt },
  });
  return { plan, preview: previewFeedDays(plan, new Date(), 14) };
}

export async function deletePlan(systemId: number, user: AuthUser) {
  await assertSystemAccess(systemId, user);
  await prisma.feedingPlan.deleteMany({ where: { systemId } });
}

// ─────────────────────────── เปิด/ปิดรอบ ───────────────────────────

/** จำนวนปูที่ต้องบันทึกในระบบนี้ */
function countLiveCrabs(systemId: number) {
  return prisma.crab.count({ where: { systemId, deletedAt: null, status: LIVE_STATUS } });
}

/**
 * เปิดรอบให้อาหารของวันนั้น — idempotent
 * เรียกได้ทั้งจาก scheduler tick และตอน GET current (lazy) โดยไม่ชนกัน
 * เพราะมี unique [systemId, feedDate] คุมอยู่ (จับ P2002 แล้วอ่านของเดิมคืน)
 */
async function openRound(
  systemId: number,
  systemName: string,
  dueAt: Date,
  recordLeadHours: number,
  planId: number | null,
): Promise<{ round: FeedingRound; created: boolean }> {
  const feedDate = ymdLocal(dueAt);
  const existing = await prisma.feedingRound.findUnique({
    where: { systemId_feedDate: { systemId, feedDate } },
  });
  if (existing) return { round: existing, created: false };

  const expectedCount = await countLiveCrabs(systemId);
  const recordDueAt = new Date(dueAt.getTime() + recordLeadHours * 3_600_000);

  let round: FeedingRound;
  try {
    round = await prisma.feedingRound.create({
      data: { systemId, planId, feedDate, dueAt, recordDueAt, expectedCount },
    });
  } catch (e) {
    // อีกฝั่ง (tick หรืออีกเครื่อง) สร้างไปพร้อมกัน → ใช้ของเขา
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await prisma.feedingRound.findUnique({
        where: { systemId_feedDate: { systemId, feedDate } },
      });
      if (again) return { round: again, created: false };
    }
    throw e;
  }

  // รอบเก่าที่ค้างอยู่ → ข้าม + ยกเลิกงานเตือนของมัน (ไม่งั้นป้าย/เมลค้าง)
  await skipStaleRounds(systemId, round.id);

  // Task 2 ใบ: ให้อาหาร (20:00) + เก็บเศษ/บันทึกการกิน (+lead ชม.)
  // ruleId=null โดยตั้งใจ — ดู CLAUDE.md/แผน: ไม่ผูก ReminderRule เพื่อไม่ให้วงรอบหลุด anchor
  const feedTask = await createTask({
    systemId,
    type: 'FEEDING',
    title: `ให้อาหารปู — ${systemName}`,
    dueAt,
    linkType: 'FeedingRound',
    linkId: round.id,
  });
  const scrapTask = await createTask({
    systemId,
    type: 'SCRAP_COLLECT',
    title: `เก็บเศษอาหาร + บันทึกการกิน (${expectedCount} ตัว) — ${systemName}`,
    dueAt: recordDueAt,
    linkType: 'FeedingRound',
    linkId: round.id,
  });
  round = await prisma.feedingRound.update({
    where: { id: round.id },
    data: { feedingTaskId: feedTask.id, scrapTaskId: scrapTask.id },
  });

  return { round, created: true };
}

/** รอบ OPEN เก่า (ที่ไม่ใช่รอบปัจจุบัน) → SKIPPED + ยกเลิก Task ค้าง */
async function skipStaleRounds(systemId: number, keepRoundId: number) {
  const stale = await prisma.feedingRound.findMany({
    where: { systemId, status: 'OPEN', id: { not: keepRoundId } },
    select: { id: true, feedingTaskId: true, scrapTaskId: true },
  });
  if (!stale.length) return;
  const taskIds = stale.flatMap((r) => [r.feedingTaskId, r.scrapTaskId]).filter((v): v is number => v != null);
  await prisma.feedingRound.updateMany({
    where: { id: { in: stale.map((r) => r.id) } },
    data: { status: 'SKIPPED' },
  });
  if (taskIds.length) {
    await prisma.task.updateMany({
      where: { id: { in: taskIds }, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  }
}

/** แผนที่ถึงเวลา → เปิดรอบ (เรียกจาก scheduler.tick) */
export async function generateFeedingRounds(now: Date): Promise<number> {
  const plans = await prisma.feedingPlan.findMany({
    where: { active: true, nextDueAt: { lte: now } },
    include: { system: { select: { name: true } } },
  });
  let created = 0;
  for (const plan of plans) {
    if (await ensureRoundForPlan(plan, plan.system.name, now)) created++;
  }
  // กวาดรอบค้างเกิน 48 ชม. (แผนถูกปิดกลางคัน / ผู้ใช้หายไป) — idempotent
  await prisma.feedingRound.updateMany({
    where: { status: 'OPEN', dueAt: { lt: new Date(now.getTime() - STALE_ROUND_MS) } },
    data: { status: 'SKIPPED' },
  });
  return created;
}

/** เปิดรอบตามแผน + เลื่อน nextDueAt เสมอ (กันค้างวน — แบบเดียวกับ generateDueTasks) */
async function ensureRoundForPlan(plan: FeedingPlan, systemName: string, now: Date): Promise<boolean> {
  const dueAt = plan.nextDueAt;
  let created = false;

  // ป้องกัน nextDueAt ค้างของเก่าหลังผู้ใช้แก้วงรอบ → เช็คซ้ำว่าวันนั้นเป็นวันให้อาหารจริง
  if (dueAt && dueAt <= now && isFeedDay(plan, dueAt)) {
    const res = await openRound(plan.systemId, systemName, dueAt, plan.recordLeadHours, plan.id);
    created = res.created;
    if (created) {
      publish(plan.systemId, {
        t: 'feeding.opened',
        systemId: plan.systemId,
        round: await buildRoundProgress(res.round),
      });
    }
  }

  await prisma.feedingPlan.update({
    where: { id: plan.id },
    data: { lastRunAt: now, nextDueAt: nextFeedRunAt(plan, dueAt && dueAt > now ? now : (dueAt ?? now)) },
  });
  return created;
}

// ─────────────────────── ความคืบหน้าของรอบ ───────────────────────

export type RoundProgress = Awaited<ReturnType<typeof buildRoundProgress>>;

/**
 * สร้าง snapshot ของรอบ — 2 query เท่านั้น (ปูทั้งระบบ + entries) แล้ว join ใน JS
 * ตั้งใจ "นับสด" ไม่เชื่อ expectedCount ที่เก็บไว้ เพราะปูอาจถูกเพิ่ม/ขาย/ลบกลางรอบ
 */
export async function buildRoundProgress(round: FeedingRound) {
  const [crabs, entries] = await Promise.all([
    prisma.crab.findMany({
      where: { systemId: round.systemId, deletedAt: null, status: LIVE_STATUS },
      orderBy: [{ boxId: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        code: true,
        boxId: true,
        cableTieColor: true,
        box: { select: { id: true, code: true, label: true } },
      },
    }),
    prisma.feedingEntry.findMany({
      where: { roundId: round.id },
      select: {
        crabId: true,
        tags: true,
        note: true,
        score: true,
        recordedAt: true,
        recordedByUserId: true,
        recordedBy: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  const byCrab = new Map(entries.map((e) => [e.crabId, e]));
  const crabRows = crabs.map((c) => {
    const e = byCrab.get(c.id);
    return {
      crabId: c.id,
      code: c.code,
      boxId: c.boxId,
      boxCode: c.box?.label || c.box?.code || null,
      cableTieColor: c.cableTieColor,
      recorded: !!e,
      tags: (e?.tags as string[] | null) ?? [],
      note: e?.note ?? null,
      score: e?.score ?? null,
      recordedAt: e?.recordedAt?.toISOString() ?? null,
      recordedByUserId: e?.recordedByUserId ?? null,
      recordedByName: e?.recordedBy?.name || e?.recordedBy?.email?.split('@')[0] || null,
    };
  });

  // สรุปต่อกล่อง → ใช้ทำป้ายบนกล่อง (หายเมื่อกล่องนั้นบันทึกครบ)
  const boxMap = new Map<number, { boxId: number; code: string | null; label: string | null; total: number; recorded: number }>();
  for (const c of crabs) {
    if (c.boxId == null) continue;
    const cur =
      boxMap.get(c.boxId) ??
      { boxId: c.boxId, code: c.box?.code ?? null, label: c.box?.label ?? null, total: 0, recorded: 0 };
    cur.total++;
    if (byCrab.has(c.id)) cur.recorded++;
    boxMap.set(c.boxId, cur);
  }

  const scored = crabRows.filter((c) => c.recorded).map((c) => c.score ?? 0);
  const total = crabRows.length;
  const recorded = scored.length;

  return {
    id: round.id,
    systemId: round.systemId,
    planId: round.planId,
    feedDate: round.feedDate,
    dueAt: round.dueAt.toISOString(),
    recordDueAt: round.recordDueAt.toISOString(),
    status: round.status,
    startedAt: round.startedAt?.toISOString() ?? null,
    completedAt: round.completedAt?.toISOString() ?? null,
    total,
    recorded,
    remaining: Math.max(0, total - recorded),
    boxes: [...boxMap.values()].map((b) => ({ ...b, done: b.recorded >= b.total })),
    crabs: crabRows,
    stats: {
      elapsedSec: round.elapsedSec,
      normalCount: scored.filter((s) => s === 100).length,
      lowCount: scored.filter((s) => s > 0 && s < 100).length,
      noneCount: scored.filter((s) => s === 0).length,
      avgScore: recorded ? Math.round((scored.reduce((a, b) => a + b, 0) / recorded) * 10) / 10 : null,
      recordedCount: recorded,
      expectedCount: round.expectedCount,
    },
  };
}

/** รอบที่กำลังเปิดอยู่ของระบบ (+ เปิดรอบใหม่แบบ lazy ถ้าถึงเวลาแล้วแต่ tick ยังไม่ยิง) */
export async function getCurrentRound(systemId: number, user: AuthUser) {
  const sys = await assertSystemAccess(systemId, user);
  let plan = await prisma.feedingPlan.findUnique({ where: { systemId } });
  const now = new Date();

  // lazy open: Passenger อาจพัก process ทำให้ cron มาช้า — ผู้ใช้เปิดหน้าแล้วต้องเจอรอบเลย
  if (plan?.active && plan.nextDueAt && plan.nextDueAt <= now && isFeedDay(plan, plan.nextDueAt)) {
    await ensureRoundForPlan(plan, sys.name, now);
    // ensureRoundForPlan เลื่อน nextDueAt ไปแล้ว → อ่านใหม่ ไม่งั้นหน้าเว็บโชว์รอบถัดไปเป็นค่าเก่า
    plan = await prisma.feedingPlan.findUnique({ where: { systemId } });
  }

  const round = await prisma.feedingRound.findFirst({
    where: { systemId, status: 'OPEN' },
    orderBy: { dueAt: 'desc' },
  });

  return {
    plan: plan ? { ...plan, preview: previewFeedDays(plan, now, 14) } : null,
    round: round ? await buildRoundProgress(round) : null,
  };
}

/** เปิดรอบเอง (นอกแผน / ย้อนหลัง) */
export async function openRoundManually(systemId: number, user: AuthUser, at?: Date) {
  const sys = await assertSystemAccess(systemId, user);
  const plan = await prisma.feedingPlan.findUnique({ where: { systemId } });
  const now = at ?? new Date();
  const dueAt = plan ? feedTimeOn(plan, now) : now;
  const lead = plan?.recordLeadHours ?? 3;

  const { round } = await openRound(systemId, sys.name, dueAt, lead, plan?.id ?? null);
  const progress = await buildRoundProgress(round);
  publish(systemId, { t: 'feeding.opened', systemId, round: progress });
  return progress;
}

// ────────────────────── บันทึกการกินรายตัว ──────────────────────

/** ปิดรอบเมื่อบันทึกครบ — conditional update ทำให้ "ปิดได้ครั้งเดียว" แม้ 2 คนกดพร้อมกัน */
async function evaluateAndMaybeComplete(round: FeedingRound, progress: RoundProgress): Promise<boolean> {
  if (round.status !== 'OPEN' || progress.total === 0 || progress.remaining > 0) return false;
  const now = new Date();
  const elapsedSec = round.startedAt
    ? Math.max(0, Math.round((now.getTime() - round.startedAt.getTime()) / 1000))
    : null;

  const res = await prisma.feedingRound.updateMany({
    where: { id: round.id, status: 'OPEN' },
    data: {
      status: 'COMPLETED',
      completedAt: now,
      elapsedSec,
      expectedCount: progress.total,
      recordedCount: progress.recorded,
      normalCount: progress.stats.normalCount,
      avgScore: progress.stats.avgScore,
    },
  });
  if (res.count === 0) return false; // คนอื่นปิดไปแล้ว → ไม่ฉลองซ้ำ

  // ปิดงานเตือนทั้ง 2 ใบด้วย "record จริง" (รอบนี้เอง) ตามหลักการใน CLAUDE.md
  for (const taskId of [round.feedingTaskId, round.scrapTaskId]) {
    if (taskId == null) continue;
    await closeTaskByRecord(taskId, { linkType: 'FeedingRound', linkId: round.id }).catch(() => {
      /* งานอาจถูกลบ/ปิดไปแล้ว — ไม่ให้ล้มทั้งคำขอ */
    });
  }
  return true;
}

async function loadRound(roundId: number) {
  const round = await prisma.feedingRound.findUnique({
    where: { id: roundId },
    include: { system: { select: { ownerId: true } } },
  });
  if (!round) throw notFound('ไม่พบรอบให้อาหารนี้');
  return round;
}

/** ส่ง snapshot ล่าสุดออกทาง WS + คืนให้ผู้เรียก */
async function refreshAndPublish(roundId: number, completed: boolean) {
  const fresh = await prisma.feedingRound.findUniqueOrThrow({ where: { id: roundId } });
  const progress = await buildRoundProgress(fresh);
  publish(fresh.systemId, {
    t: completed ? 'feeding.completed' : 'feeding.progress',
    systemId: fresh.systemId,
    round: progress,
  });
  return progress;
}

export async function getRound(roundId: number, user: AuthUser) {
  const round = await loadRound(roundId);
  assertOwnership(user, round.system.ownerId);
  return buildRoundProgress(round);
}

/**
 * บันทึกการกินของปู 1 ตัวในรอบนี้ — หัวใจของฟีเจอร์
 * ทำทุกอย่างที่ crab.service.logFeeding ทำ (feedingNote + lastFedAt + CrabHistory โซน FEEDING)
 * บวกกับ FeedingEntry เพื่อรู้ว่า "รอบนี้บันทึกไปกี่ตัวแล้ว"
 */
export async function recordEntry(
  roundId: number,
  user: AuthUser,
  input: { crabId: number; tags: string[]; note?: string | null },
) {
  const round = await loadRound(roundId);
  assertOwnership(user, round.system.ownerId);
  if (round.status === 'SKIPPED') throw badRequest('รอบนี้ถูกข้ามไปแล้ว');

  const crab = await prisma.crab.findUnique({
    where: { id: input.crabId },
    select: { id: true, systemId: true, boxId: true, deletedAt: true },
  });
  if (!crab || crab.deletedAt) throw notFound('ไม่พบปูตัวนี้');
  if (crab.systemId !== round.systemId) throw badRequest('ปูตัวนี้ไม่ได้อยู่ในระบบเดียวกับรอบให้อาหาร');

  const tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))];
  const score = scoreFromTags(tags);
  const feedingNote = tags.length ? tags.join(', ') : null; // รูปแบบเดียวกับที่หน้าเว็บเขียนอยู่
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const existing = await tx.feedingEntry.findUnique({
      where: { roundId_crabId: { roundId, crabId: crab.id } },
    });

    // ประวัติโซน FEEDING — คีย์ feedingNote/fedAt ต้องคงไว้ (หน้าเว็บอ่านอยู่)
    // fedAt = เวลาให้อาหารจริง (ไม่ใช่เวลาที่เดินมาบันทึก ซึ่งช้ากว่า 2–3 ชม.)
    const snapshot = {
      feedingNote,
      fedAt: round.dueAt.toISOString(),
      roundId,
      score,
      tags,
    } satisfies Prisma.InputJsonObject;

    // แก้ซ้ำ (กดผิดตัว/เปลี่ยนใจ) → อัปเดตแถวประวัติเดิม ไม่สร้างซ้ำ
    // ใช้ updateMany เพราะไม่ throw ตอนแถวถูกลบไปแล้ว (update จะโยน P2025 กลางทรานแซกชัน)
    let historyId = existing?.historyId ?? null;
    if (historyId) {
      const res = await tx.crabHistory.updateMany({ where: { id: historyId }, data: { snapshot } });
      if (res.count === 0) historyId = null; // ผู้ใช้ลบประวัติแถวนั้นทิ้งไปแล้ว → สร้างใหม่
    }
    if (historyId == null) {
      historyId = (await tx.crabHistory.create({ data: { crabId: crab.id, zone: 'FEEDING', snapshot } })).id;
    }

    await tx.crab.update({
      where: { id: crab.id },
      data: { feedingNote, lastFedAt: round.dueAt },
    });

    const payload = {
      tags: tags as unknown as Prisma.InputJsonValue,
      note: input.note ?? null,
      score,
      boxId: crab.boxId,
      recordedByUserId: user.id,
      recordedAt: now,
      historyId,
    };
    try {
      await tx.feedingEntry.upsert({
        where: { roundId_crabId: { roundId, crabId: crab.id } },
        create: { roundId, crabId: crab.id, ...payload },
        update: payload,
      });
    } catch (e) {
      // upsert ของ Prisma = SELECT-then-INSERT → 2 เครื่องกดปูตัวเดียวกันพร้อมกันยังชนได้
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await tx.feedingEntry.update({
          where: { roundId_crabId: { roundId, crabId: crab.id } },
          data: payload,
        });
      } else throw e;
    }

    // จับเวลาเริ่มรอบที่ปูตัวแรก (เขียนครั้งเดียว — guard ด้วย startedAt: null)
    await tx.feedingRound.updateMany({
      where: { id: roundId, startedAt: null },
      data: { startedAt: now },
    });
  });

  // นับความคืบหน้า "นอก" transaction — ไม่งั้นอ่านไม่เห็นแถวที่อีกเครื่องเพิ่ง commit
  const fresh = await prisma.feedingRound.findUniqueOrThrow({ where: { id: roundId } });
  const progress = await buildRoundProgress(fresh);
  const celebrated = await evaluateAndMaybeComplete(fresh, progress);
  const finalRound = await refreshAndPublish(roundId, celebrated);
  return { round: finalRound, celebrated };
}

/** ลบการบันทึกของปู 1 ตัว (บันทึกผิดตัว) */
export async function deleteEntry(roundId: number, crabId: number, user: AuthUser) {
  const round = await loadRound(roundId);
  assertOwnership(user, round.system.ownerId);
  await prisma.feedingEntry.deleteMany({ where: { roundId, crabId } });
  return refreshAndPublish(roundId, false);
}

/** ปิดรอบเอง แม้บันทึกไม่ครบ (ปูบางตัวเข้าไม่ถึง/ไม่ได้เช็ค) */
export async function closeRound(roundId: number, user: AuthUser) {
  const round = await loadRound(roundId);
  assertOwnership(user, round.system.ownerId);
  if (round.status !== 'OPEN') return buildRoundProgress(round);

  const progress = await buildRoundProgress(round);
  const now = new Date();
  await prisma.feedingRound.updateMany({
    where: { id: roundId, status: 'OPEN' },
    data: {
      status: 'COMPLETED',
      completedAt: now,
      elapsedSec: round.startedAt ? Math.max(0, Math.round((now.getTime() - round.startedAt.getTime()) / 1000)) : null,
      expectedCount: progress.total,
      recordedCount: progress.recorded,
      normalCount: progress.stats.normalCount,
      avgScore: progress.stats.avgScore,
    },
  });
  for (const taskId of [round.feedingTaskId, round.scrapTaskId]) {
    if (taskId == null) continue;
    await closeTaskByRecord(taskId, { linkType: 'FeedingRound', linkId: round.id }).catch(() => {});
  }
  return refreshAndPublish(roundId, true);
}

/** ข้ามรอบ (ไม่ได้ให้อาหารวันนี้) */
export async function skipRound(roundId: number, user: AuthUser) {
  const round = await loadRound(roundId);
  assertOwnership(user, round.system.ownerId);
  await prisma.feedingRound.updateMany({
    where: { id: roundId, status: 'OPEN' },
    data: { status: 'SKIPPED' },
  });
  const taskIds = [round.feedingTaskId, round.scrapTaskId].filter((v): v is number => v != null);
  if (taskIds.length) {
    await prisma.task.updateMany({
      where: { id: { in: taskIds }, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  }
  return refreshAndPublish(roundId, false);
}

/** ประวัติรอบย้อนหลัง + สถิติ (อ่านจากคอลัมน์ที่ denormalize ไว้ → ไม่ต้อง aggregate) */
export async function listRounds(systemId: number, user: AuthUser, take = 20, skip = 0) {
  await assertSystemAccess(systemId, user);
  return prisma.feedingRound.findMany({
    where: { systemId },
    orderBy: { dueAt: 'desc' },
    take,
    skip,
  });
}

// ───────────────────── หลอดพลัง (เฉลี่ย N รอบล่าสุด) ─────────────────────

/**
 * คะแนนการกินเฉลี่ยต่อปู จาก N รอบล่าสุด (ดีฟอลต์ 5 ตามที่ผู้ใช้เลือก)
 * 2 query — ไม่ N+1, ไม่ใช้ window function (MySQL บน shared host อาจเป็น 5.7)
 * ปูที่ "ไม่มีบันทึก" ในรอบนั้น = ไม่นับเป็น sample (ไม่ใช่ 0) — ลืมบันทึกไม่ควรดูเหมือนอดอาหาร
 */
export async function crabEnergy(systemId: number, user: AuthUser, rounds = 5) {
  await assertSystemAccess(systemId, user);
  const recent = await prisma.feedingRound.findMany({
    where: { systemId, startedAt: { not: null } },
    orderBy: { dueAt: 'desc' },
    take: rounds,
    select: { id: true, feedDate: true, dueAt: true },
  });
  if (!recent.length) return [];

  const order = [...recent].reverse(); // เก่า→ใหม่ (ทำ sparkline)
  const idx = new Map(order.map((r, i) => [r.id, i]));
  const entries = await prisma.feedingEntry.findMany({
    where: { roundId: { in: recent.map((r) => r.id) } },
    select: { crabId: true, roundId: true, score: true, recordedAt: true, boxId: true },
  });

  const byCrab = new Map<number, { scores: number[]; series: (number | null)[]; last: number | null; lastAt: Date | null; boxId: number | null }>();
  for (const e of entries) {
    const cur =
      byCrab.get(e.crabId) ??
      { scores: [], series: Array(order.length).fill(null) as (number | null)[], last: null, lastAt: null, boxId: null };
    cur.scores.push(e.score);
    const i = idx.get(e.roundId);
    if (i != null) cur.series[i] = e.score;
    if (!cur.lastAt || e.recordedAt > cur.lastAt) {
      cur.lastAt = e.recordedAt;
      cur.last = e.score;
      cur.boxId = e.boxId;
    }
    byCrab.set(e.crabId, cur);
  }

  return [...byCrab.entries()].map(([crabId, v]) => ({
    crabId,
    boxId: v.boxId,
    avgScore: Math.round((v.scores.reduce((a, b) => a + b, 0) / v.scores.length) * 10) / 10,
    samples: v.scores.length,
    lastScore: v.last,
    lastRecordedAt: v.lastAt?.toISOString() ?? null,
    series: v.series,
  }));
}
