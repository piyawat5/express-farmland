import type { Prisma, ReminderRule, TaskStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import { fmtDayLong } from '../../lib/thaiDate';
import type { AuthUser } from '../auth.service';
import { DEFAULT_CHECK_DAYS, KIND_ICON, defaultRulesData } from './defaults';
import { markFedForSystem, openUnfedRounds, syncFeeding } from '../feed/round.service';
import { forecast } from '../feed/stock.service';
import { addDays, atTime, dayDiff, endOfDay, isTimeBased, nextDueAfter, projectDues, startOfDay } from './schedule';

// ════════════════════════════════════════════════════════════════════
//  งานแจ้งเตือน (Task) — สร้างจากกฎแบบ "ขี้เกียจ": ตอนเปิดหน้า/ตอน scheduler วิ่ง (syncOwner)
//  ไม่ต้องพึ่ง cron ถี่ๆ เพื่อให้หน้าเว็บถูกต้อง (Plesk/Passenger พัก process ได้) — cron ใช้แค่ส่งอีเมล
//
//  งาน 3 แบบ:
//   1. ตามเวลา (ทุก N วัน / วันในสัปดาห์ / ครั้งเดียว) — ขึ้นตั้งแต่ต้นวันที่ครบกำหนด
//   2. เช็คปู — ขึ้นเมื่อมีปูถึงรอบ ปิดเองเมื่อเช็คครบ (กดเสร็จ = พักเตือนเท่ารอบเช็ค)
//   3. ใส่ราคาล็อต — อัตโนมัติ ปิดเองเมื่อใส่ราคา (กดเสร็จเองไม่ได้)
//  กันงานซ้ำด้วย Task.openKey (unique) + createMany skipDuplicates → 2 เครื่องเปิดพร้อมกันก็ไม่ซ้ำ
// ════════════════════════════════════════════════════════════════════

const SYNC_MS = 15_000;
const lastSync = new Map<number, number>();
/** sync ที่กำลังวิ่งอยู่ต่อคน — คำขอที่มาพร้อมกันต้อง "รอ" ตัวนี้ ห้ามข้ามไปอ่านเลย
 *  (เจอจริงตอนทดสอบ: /attention กับ /reminders/today มาพร้อมกัน ตัวหลังเห็น throttle แล้วข้าม
 *   → อ่านงานก่อนตัวแรกสร้างเสร็จ → หน้าแรกบอก "ไม่มีงานค้าง" แต่เมนูขึ้น ⚠) */
const inflight = new Map<number, Promise<void>>();

/** ข้อมูลเปลี่ยน (ใส่ราคาล็อต / เช็คปู / แก้กฎ) → sync รอบถัดไปทันทีไม่ต้องรอ throttle */
export function markDirty(ownerId: number) {
  lastSync.delete(ownerId);
}

type CrabDue = { count: number; earliest: Date };

/** ปูที่ถึงรอบเช็คของแต่ละระบบ (นับจากเช็คล่าสุด ไม่เคยเช็ค = นับจากวันรับเข้าล็อต) */
async function crabDueBySystem(ownerId: number, everyDaysBySystem: Map<number, number>, now: Date) {
  const out = new Map<number, CrabDue>();
  if (!everyDaysBySystem.size) return out;
  const crabs = await prisma.crab.findMany({
    where: { ownerId, status: 'ALIVE', deletedAt: null, systemId: { in: [...everyDaysBySystem.keys()] } },
    select: { systemId: true, lastCheckedAt: true, lot: { select: { receivedAt: true } } },
  });
  const today = startOfDay(now);
  for (const c of crabs) {
    const every = everyDaysBySystem.get(c.systemId) ?? DEFAULT_CHECK_DAYS;
    const dueDay = addDays(startOfDay(c.lastCheckedAt ?? c.lot.receivedAt), every);
    if (dueDay > today) continue;
    const cur = out.get(c.systemId);
    if (!cur) out.set(c.systemId, { count: 1, earliest: dueDay });
    else {
      cur.count++;
      if (dueDay < cur.earliest) cur.earliest = dueDay;
    }
  }
  return out;
}

/** สร้าง/ปิดงานของผู้ใช้ 1 คนให้ตรงกับตอนนี้ (idempotent · throttle 15 วิ ยกเว้น force) */
export async function syncOwner(ownerId: number, now = new Date(), opts: { force?: boolean } = {}) {
  const running = inflight.get(ownerId);
  if (running) {
    await running.catch(() => undefined);
    if (!opts.force) return;
  }
  if (!opts.force) {
    const t = lastSync.get(ownerId);
    if (t && now.getTime() - t < SYNC_MS) return;
  }
  lastSync.set(ownerId, now.getTime());
  const job = doSync(ownerId, now)
    .catch((err) => {
      lastSync.delete(ownerId); // พลาด = รอบหน้าลองใหม่ทันที
      throw err;
    })
    .finally(() => inflight.delete(ownerId));
  inflight.set(ownerId, job);
  await job;
}

async function doSync(ownerId: number, now: Date) {
  // รอบให้อาหาร (P4): เปิดรอบที่ถึงเวลา + ปิดรอบที่ลืมปิด — ต้องมาก่อน เพราะงาน "ให้อาหารปู" อ่านจากรอบ
  await syncFeeding(ownerId, now);

  // 0) ระบบที่ยังไม่มีแจ้งเตือนเริ่มต้น (สร้างก่อนมี P3) → เติมให้
  const bare = await prisma.crabSystem.findMany({
    where: { ownerId, reminderRules: { none: { defaultKey: { not: null } } } },
    select: { id: true },
  });
  for (const s of bare) {
    await prisma.reminderRule.createMany({ data: defaultRulesData(ownerId, s.id, now), skipDuplicates: true });
  }

  // 1) งานตามเวลา — ขึ้นตั้งแต่ต้นวันที่ครบกำหนด (วันนี้ 20:00 ก็เห็นตั้งแต่เช้า)
  const eod = endOfDay(now);
  const due = await prisma.reminderRule.findMany({
    where: { ownerId, active: true, repeat: { in: ['EVERY_DAYS', 'WEEKDAYS', 'ONCE'] }, kind: { not: 'CRAB_CHECK' }, nextDueAt: { lte: eod } },
  });
  if (due.length) {
    await prisma.task.createMany({
      data: due.map((r) => ({
        ownerId,
        systemId: r.systemId,
        ruleId: r.id,
        kind: r.kind,
        title: r.title,
        priority: r.priority,
        dueAt: r.nextDueAt!,
        openKey: `rule:${r.id}`,
      })),
      skipDuplicates: true,
    });
  }

  // 2) เช็คปู — มีปูถึงรอบ = มีงาน · ไม่มีแล้ว = ปิดให้เอง
  const crabRules = await prisma.reminderRule.findMany({ where: { ownerId, kind: 'CRAB_CHECK', active: true } });
  if (crabRules.length) {
    const dueMap = await crabDueBySystem(ownerId, new Map(crabRules.map((r) => [r.systemId, r.everyDays ?? DEFAULT_CHECK_DAYS])), now);
    const open = await prisma.task.findMany({
      where: { ownerId, kind: 'CRAB_CHECK', status: 'OPEN' },
      select: { id: true, ruleId: true },
    });
    const create: Prisma.TaskCreateManyInput[] = [];
    const close: number[] = [];
    for (const r of crabRules) {
      const d = dueMap.get(r.systemId);
      const hasOpen = open.find((t) => t.ruleId === r.id);
      const snoozed = r.nextDueAt != null && r.nextDueAt > now;
      if (d && !hasOpen && !snoozed) {
        const at = atTime(d.earliest, r.timeOfDay);
        create.push({
          ownerId,
          systemId: r.systemId,
          ruleId: r.id,
          kind: 'CRAB_CHECK',
          title: r.title,
          priority: r.priority,
          dueAt: r.nextDueAt && r.nextDueAt > at ? r.nextDueAt : at,
          openKey: `rule:${r.id}`,
        });
      }
      if (!d && hasOpen) close.push(hasOpen.id);
    }
    if (create.length) await prisma.task.createMany({ data: create, skipDuplicates: true });
    if (close.length) {
      await prisma.task.updateMany({
        where: { id: { in: close }, status: 'OPEN' },
        data: { status: 'DONE', doneAt: now, closedBy: 'AUTO', openKey: null },
      });
    }
  }

  // 3) ใส่ราคาล็อต — ล็อตที่มีปูแต่ยังไม่มีราคา (ลืมแล้วไปเจอตอนขาย = ปัญหาใหญ่ใน v1)
  const [lots, openLot] = await Promise.all([
    prisma.crabLot.findMany({
      where: { ownerId, totalCost: null, crabs: { some: { deletedAt: null } } },
      select: { id: true, systemId: true, receivedAt: true },
    }),
    prisma.task.findMany({ where: { ownerId, kind: 'LOT_COST', status: 'OPEN' }, select: { id: true, refId: true } }),
  ]);
  const lotIds = new Set(lots.map((l) => l.id));
  const openRefs = new Set(openLot.map((t) => t.refId));
  const newLot = lots.filter((l) => !openRefs.has(l.id));
  if (newLot.length) {
    await prisma.task.createMany({
      data: newLot.map((l) => ({
        ownerId,
        systemId: l.systemId,
        kind: 'LOT_COST' as const,
        title: `ใส่ราคาล็อต ${fmtDayLong(l.receivedAt)}`,
        priority: 'MEDIUM' as const,
        dueAt: atTime(l.receivedAt, '20:00'),
        openKey: `lot:${l.id}`,
        refId: l.id,
      })),
      skipDuplicates: true,
    });
  }
  const doneLot = openLot.filter((t) => t.refId == null || !lotIds.has(t.refId)).map((t) => t.id);
  if (doneLot.length) {
    await prisma.task.updateMany({
      where: { id: { in: doneLot }, status: 'OPEN' },
      data: { status: 'DONE', doneAt: now, closedBy: 'AUTO', openKey: null },
    });
  }

  // 4) ให้อาหารปู (P4) — รอบเปิดแล้วแต่ยังไม่กด "ให้อาหารแล้ว" = มีงาน · ให้แล้ว/ปิดรอบ = ปิดงานเอง
  const [feedRules, unfed, openFeed] = await Promise.all([
    prisma.reminderRule.findMany({ where: { ownerId, kind: 'FEEDING', active: true }, select: { id: true, systemId: true, title: true, priority: true } }),
    openUnfedRounds(ownerId),
    prisma.task.findMany({ where: { ownerId, kind: 'FEEDING', status: 'OPEN' }, select: { id: true, systemId: true } }),
  ]);
  const unfedBy = new Map(unfed.map((r) => [r.systemId, r]));
  const feedCreate = feedRules
    .filter((r) => unfedBy.has(r.systemId) && !openFeed.some((t) => t.systemId === r.systemId))
    .map((r) => ({
      ownerId,
      systemId: r.systemId,
      ruleId: r.id,
      kind: 'FEEDING' as const,
      title: r.title,
      priority: r.priority,
      dueAt: unfedBy.get(r.systemId)!.dueAt,
      openKey: `rule:${r.id}`,
    }));
  if (feedCreate.length) await prisma.task.createMany({ data: feedCreate, skipDuplicates: true });
  const feedDone = openFeed.filter((t) => t.systemId == null || !unfedBy.has(t.systemId)).map((t) => t.id);
  if (feedDone.length) {
    await prisma.task.updateMany({
      where: { id: { in: feedDone }, status: 'OPEN' },
      data: { status: 'DONE', doneAt: now, closedBy: 'AUTO', openKey: null },
    });
  }

  // 5) อาหารใกล้หมด (พอไม่ถึง 2 รอบ) — ซื้อเพิ่ม/นับใหม่แล้วปิดเอง
  const [fc, foods, openLow] = await Promise.all([
    forecast(ownerId, now),
    prisma.feedItem.findMany({ where: { ownerId, active: true }, select: { id: true, name: true } }),
    prisma.task.findMany({ where: { ownerId, kind: 'FEED_LOW', status: 'OPEN' }, select: { id: true, refId: true } }),
  ]);
  const lowIds = new Set(foods.filter((f) => fc.get(f.id)?.low).map((f) => f.id));
  const lowCreate = foods
    .filter((f) => lowIds.has(f.id) && !openLow.some((t) => t.refId === f.id))
    .map((f) => ({
      ownerId,
      kind: 'FEED_LOW' as const,
      title: `${f.name}ใกล้หมด — ซื้อเพิ่ม`,
      priority: 'MEDIUM' as const,
      dueAt: now,
      openKey: `feed:${f.id}`,
      refId: f.id,
    }));
  if (lowCreate.length) await prisma.task.createMany({ data: lowCreate, skipDuplicates: true });
  const lowDone = openLow.filter((t) => t.refId == null || !lowIds.has(t.refId)).map((t) => t.id);
  if (lowDone.length) {
    await prisma.task.updateMany({
      where: { id: { in: lowDone }, status: 'OPEN' },
      data: { status: 'DONE', doneAt: now, closedBy: 'AUTO', openKey: null },
    });
  }
}

// ── อ่าน ──────────────────────────────────────────────────────────────

const TASK_SELECT = {
  id: true,
  kind: true,
  title: true,
  priority: true,
  dueAt: true,
  status: true,
  doneAt: true,
  closedBy: true,
  systemId: true,
  ruleId: true,
  refId: true,
  rule: { select: { icon: true, everyDays: true } },
  system: { select: { name: true } },
} satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

/** งานแบบไหนกด "เสร็จแล้ว" เองได้ — ใส่ราคาล็อตต้องไปใส่ราคาจริง */
export const canCompleteKind = (kind: TaskRow['kind']) => kind !== 'LOT_COST' && kind !== 'FEED_LOW';

function shapeTask(t: TaskRow, now: Date) {
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    icon: t.rule?.icon ?? KIND_ICON[t.kind],
    priority: t.priority,
    dueAt: t.dueAt,
    status: t.status,
    doneAt: t.doneAt,
    closedBy: t.closedBy,
    systemId: t.systemId,
    systemName: t.system?.name ?? null,
    ruleId: t.ruleId,
    refId: t.refId,
    /** ถึงเวลาแล้ว (ก่อนหน้านี้ = งานของวันนี้ที่ยังไม่ถึงเวลา) */
    isDue: t.dueAt <= now,
    /** เลยมากี่วัน (0 = วันนี้) */
    overdueDays: Math.max(0, dayDiff(t.dueAt, now)),
    canComplete: canCompleteKind(t.kind),
    /** เช็คปู: จำนวนปูที่ถึงรอบ */
    count: null as number | null,
  };
}

const PRIORITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

/** แท็บ "วันนี้": งานที่เปิดอยู่ (ทุกระบบ) + "เร็วๆ นี้" (รอบถัดไปภายใน 3 วัน) */
export async function listToday(user: AuthUser, now = new Date()) {
  await syncOwner(user.id, now);
  const [rows, rules] = await Promise.all([
    prisma.task.findMany({ where: { ownerId: user.id, status: 'OPEN' }, orderBy: { dueAt: 'asc' }, select: TASK_SELECT }),
    prisma.reminderRule.findMany({
      where: {
        ownerId: user.id,
        active: true,
        repeat: { in: ['EVERY_DAYS', 'WEEKDAYS', 'ONCE'] },
        kind: { not: 'CRAB_CHECK' },
        nextDueAt: { gt: endOfDay(now), lte: endOfDay(addDays(now, 3)) },
      },
      orderBy: { nextDueAt: 'asc' },
      select: { id: true, kind: true, title: true, icon: true, priority: true, nextDueAt: true, systemId: true, system: { select: { name: true } } },
    }),
  ]);

  const tasks = rows.map((t) => shapeTask(t, now));
  // เช็คปู: บอกจำนวนปูที่ถึงรอบบนการ์ด
  const crabTasks = rows.filter((t) => t.kind === 'CRAB_CHECK' && t.systemId != null);
  if (crabTasks.length) {
    const every = new Map(crabTasks.map((t) => [t.systemId!, t.rule?.everyDays ?? DEFAULT_CHECK_DAYS]));
    const dueMap = await crabDueBySystem(user.id, every, now);
    for (const t of tasks) if (t.kind === 'CRAB_CHECK' && t.systemId != null) t.count = dueMap.get(t.systemId)?.count ?? 0;
  }
  tasks.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || +a.dueAt - +b.dueAt);

  return {
    now,
    tasks,
    upcoming: rules.map((r) => ({
      ruleId: r.id,
      kind: r.kind,
      title: r.title,
      icon: r.icon ?? KIND_ICON[r.kind],
      priority: r.priority,
      dueAt: r.nextDueAt!,
      systemId: r.systemId,
      systemName: r.system.name,
    })),
  };
}

/** ตัวเลขสรุปสำหรับป้าย ⚠ / กระดิ่ง: งานที่ถึงเวลาแล้ว + งานด่วนที่ถึงเวลาแล้ว */
export async function dueSummary(ownerId: number, now = new Date()) {
  await syncOwner(ownerId, now);
  const rows = await prisma.task.groupBy({
    by: ['priority'],
    where: { ownerId, status: 'OPEN', dueAt: { lte: now } },
    _count: { _all: true },
  });
  const by = Object.fromEntries(rows.map((r) => [r.priority, r._count._all])) as Partial<Record<'HIGH' | 'MEDIUM' | 'LOW', number>>;
  return { total: (by.HIGH ?? 0) + (by.MEDIUM ?? 0) + (by.LOW ?? 0), high: by.HIGH ?? 0 };
}

// ── ทำเสร็จ / ข้าม ────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

/** เลื่อนรอบของกฎหลังปิดงาน — รอบถัดไปนับจากวันที่ทำจริง */
async function advanceRule(tx: Tx, rule: ReminderRule, at: Date, status: TaskStatus, now: Date) {
  const data: Prisma.ReminderRuleUpdateInput = {};
  if (status === 'DONE') data.lastDoneAt = at;
  if (rule.repeat === 'ONCE') {
    data.active = false;
    data.nextDueAt = null;
  } else if (rule.kind === 'CRAB_CHECK') {
    // กดเสร็จทั้งที่ยังมีปูถึงรอบ = พักเตือนเท่ารอบเช็ค (ป้าย ⚠ บนกล่องยังอยู่)
    data.nextDueAt = addDays(now, rule.everyDays ?? DEFAULT_CHECK_DAYS);
  } else if (isTimeBased(rule)) {
    // ข้าม = นับเหมือนจัดการแล้ววันนี้
    data.nextDueAt = nextDueAfter(rule, status === 'DONE' ? at : now);
  }
  await tx.reminderRule.update({ where: { id: rule.id }, data });
}

async function closeTask(user: AuthUser, id: number, status: 'DONE' | 'SKIPPED', doneAtInput?: Date) {
  const now = new Date();
  const task = assertOwned(await prisma.task.findUnique({ where: { id }, include: { rule: true } }), user, 'งานนี้');
  if (task.status !== 'OPEN') throw badRequest('งานนี้ปิดไปแล้ว');
  if (!canCompleteKind(task.kind)) {
    throw badRequest(task.kind === 'FEED_LOW' ? 'งานนี้จะปิดเองเมื่อซื้ออาหารเพิ่ม' : 'งานนี้จะปิดเองเมื่อใส่ราคาล็อตแล้ว');
  }
  // "เสร็จแล้ว" ที่งานให้อาหาร = ให้อาหารรอบที่เปิดอยู่แล้ว (ต่อด้วยบันทึกการกินที่หน้ากล่องปู)
  if (task.kind === 'FEEDING' && task.systemId && status === 'DONE') await markFedForSystem(task.systemId);
  // ทำย้อนหลังได้ (ลืมกด) แต่ห้ามอนาคต และไม่ย้อนเกิน 60 วัน
  let at = doneAtInput && doneAtInput < now ? doneAtInput : now;
  if (dayDiff(at, now) > 60) at = addDays(now, -60);

  await prisma.$transaction(async (tx) => {
    const r = await tx.task.updateMany({
      where: { id, status: 'OPEN' },
      data: { status, doneAt: at, closedBy: 'USER', openKey: null },
    });
    if (r.count === 0) throw badRequest('งานนี้ปิดไปแล้ว');
    if (task.rule) await advanceRule(tx, task.rule, at, status, now);
  });
  markDirty(user.id);
}

export const completeTask = (user: AuthUser, id: number, doneAt?: Date) => closeTask(user, id, 'DONE', doneAt);
export const skipTask = (user: AuthUser, id: number) => closeTask(user, id, 'SKIPPED');

/** "ทำแล้ว" จากรายการเร็วๆ นี้ (ทำก่อนกำหนด) — มีงานเปิดอยู่ = ปิดงานนั้น ไม่มี = บันทึกรอบนี้ว่าทำแล้ว */
export async function doRuleNow(user: AuthUser, ruleId: number) {
  const now = new Date();
  const rule = assertOwned(await prisma.reminderRule.findUnique({ where: { id: ruleId } }), user, 'แจ้งเตือนนี้');
  if (!rule.active || !isTimeBased(rule)) throw badRequest('เรื่องนี้กดทำล่วงหน้าไม่ได้');
  const open = await prisma.task.findFirst({ where: { ruleId, status: 'OPEN' }, select: { id: true } });
  if (open) return completeTask(user, open.id);
  await prisma.$transaction(async (tx) => {
    await tx.task.create({
      data: {
        ownerId: user.id,
        systemId: rule.systemId,
        ruleId,
        kind: rule.kind,
        title: rule.title,
        priority: rule.priority,
        dueAt: rule.nextDueAt ?? now,
        status: 'DONE',
        doneAt: now,
        closedBy: 'USER',
      },
    });
    await advanceRule(tx, rule, now, 'DONE', now);
  });
  markDirty(user.id);
}

/**
 * บันทึกค่าน้ำแล้ว (P5) = งาน "วัดค่าน้ำ" ของระบบนั้นเสร็จเอง (closedBy AUTO) · รอบถัดไปนับจากเวลาที่วัด
 * - ไม่มีงานเปิดอยู่ (วัดก่อนกำหนด) = เก็บเป็นประวัติว่าทำแล้ว (วันละแถว) แล้วเลื่อนรอบ
 * - บันทึกย้อนหลังที่เก่ากว่าครั้งล่าสุด = ไม่แตะแจ้งเตือน
 * - retest = มีค่าที่ตั้งไว้ว่า "วัดซ้ำพรุ่งนี้" → รอบถัดไปเป็นพรุ่งนี้ (ถ้าเดิมไกลกว่านั้น)
 */
export async function waterTested(ownerId: number, systemId: number, at: Date, retest: boolean) {
  const now = new Date();
  const rules = await prisma.reminderRule.findMany({ where: { ownerId, systemId, kind: 'WATER_TEST', active: true } });
  for (const rule of rules) {
    if (!isTimeBased(rule)) continue;
    if (rule.lastDoneAt && at <= rule.lastDoneAt) continue;
    await prisma.$transaction(async (tx) => {
      const open = await tx.task.findFirst({ where: { ruleId: rule.id, status: 'OPEN' }, select: { id: true } });
      if (open) {
        await tx.task.updateMany({ where: { id: open.id, status: 'OPEN' }, data: { status: 'DONE', doneAt: at, closedBy: 'AUTO', openKey: null } });
      } else if (!(await tx.task.count({ where: { ruleId: rule.id, status: 'DONE', doneAt: { gte: startOfDay(at) } } }))) {
        await tx.task.create({
          data: { ownerId, systemId, ruleId: rule.id, kind: rule.kind, title: rule.title, priority: rule.priority, dueAt: rule.nextDueAt ?? at, status: 'DONE', doneAt: at, closedBy: 'AUTO' },
        });
      }
      await advanceRule(tx, rule, at, 'DONE', now);
      if (retest) {
        const tomorrow = atTime(addDays(startOfDay(now), 1), rule.timeOfDay);
        const next = nextDueAfter(rule, at);
        if (!next || tomorrow < next) await tx.reminderRule.update({ where: { id: rule.id }, data: { nextDueAt: tomorrow } });
      }
    });
  }
  markDirty(ownerId);
}

// ── ปฏิทิน ────────────────────────────────────────────────────────────

/** งานจริงในช่วงวัน (ครบกำหนด หรือทำเสร็จในช่วงนั้น) + รอบที่คาดว่าจะเกิด ("ตามแผน") */
export async function calendar(user: AuthUser, q: { from: Date; to: Date; systemId?: number }) {
  const now = new Date();
  await syncOwner(user.id, now);
  const from = startOfDay(q.from);
  const to = endOfDay(q.to);
  const sys = q.systemId ? { systemId: q.systemId } : {};

  const [rows, rules] = await Promise.all([
    prisma.task.findMany({
      where: { ownerId: user.id, ...sys, OR: [{ dueAt: { gte: from, lte: to } }, { doneAt: { gte: from, lte: to } }] },
      orderBy: { dueAt: 'asc' },
      take: 1000,
      select: TASK_SELECT,
    }),
    prisma.reminderRule.findMany({
      where: { ownerId: user.id, ...sys, active: true, repeat: { in: ['EVERY_DAYS', 'WEEKDAYS', 'ONCE'] }, kind: { not: 'CRAB_CHECK' } },
      select: {
        id: true,
        kind: true,
        title: true,
        icon: true,
        priority: true,
        repeat: true,
        everyDays: true,
        weekdays: true,
        timeOfDay: true,
        nextDueAt: true,
        systemId: true,
        tasks: { where: { status: 'OPEN' }, select: { id: true }, take: 1 },
      },
    }),
  ]);

  const planned: { ruleId: number; kind: string; title: string; icon: string; priority: string; dueAt: Date; systemId: number }[] = [];
  for (const r of rules) {
    let start = r.nextDueAt;
    // รอบนี้มีงานจริงแล้ว → แผนเริ่มจากรอบถัดไป (สมมติว่าทำวันนี้ถ้าเลยกำหนดแล้ว)
    if (r.tasks.length && start) start = r.repeat === 'ONCE' ? null : nextDueAfter(r, start < now ? now : start);
    if (start && start < startOfDay(now)) start = nextDueAfter(r, now);
    for (const dueAt of projectDues(r, start, from, to)) {
      planned.push({ ruleId: r.id, kind: r.kind, title: r.title, icon: r.icon ?? KIND_ICON[r.kind], priority: r.priority, dueAt, systemId: r.systemId });
    }
  }

  return { tasks: rows.map((t) => shapeTask(t, now)), planned };
}

/** ประวัติของกฎ 1 เรื่อง (แถบจุด ตรงเวลา/ช้า/ข้าม) — ล่าสุดก่อน */
export async function ruleHistory(user: AuthUser, ruleId: number) {
  assertOwned(await prisma.reminderRule.findUnique({ where: { id: ruleId }, select: { ownerId: true } }), user, 'แจ้งเตือนนี้');
  const rows = await prisma.task.findMany({
    where: { ruleId, status: { in: ['DONE', 'SKIPPED'] } },
    orderBy: [{ doneAt: 'desc' }, { id: 'desc' }],
    take: 30,
    select: { id: true, status: true, dueAt: true, doneAt: true, closedBy: true },
  });
  return rows.map((t) => ({
    ...t,
    /** ช้ากี่วัน (0 = ตรงเวลา/ก่อนเวลา) */
    lateDays: t.doneAt ? Math.max(0, dayDiff(t.dueAt, t.doneAt)) : 0,
  }));
}
