import type { BoxSide, Prisma, SystemLayout } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import type { AuthUser } from '../auth.service';
import { defaultRulesData } from '../reminders/defaults';
import { checkEveryDays } from '../reminders/rule.service';

// ════════════════════════════════════════════════════════════════════
//  ระบบปู + ผังกล่อง
//  - สร้างระบบ = สร้างกล่องให้ครบตามแบบที่เลือก (คอนโดหน้า-หลัง = 2 ด้าน)
//  - รหัสกล่อง: แถว A = ชั้นบนสุด, เลข 1 = ซ้ายสุด (มองจากด้านที่ยืน) → "A1"
//  - ขยายผังได้ทุกเมื่อ · ย่อผังได้เฉพาะเมื่อกล่องที่จะหายไม่มีปู (กล่องเก่าถูกซ่อน ไม่ลบ เพราะประวัติปูอ้างถึง)
// ════════════════════════════════════════════════════════════════════

export const MAX_ROWS = 30;
export const MAX_COLS = 60;

/** 0 → A, 25 → Z, 26 → AA */
export function rowLetter(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export const boxCode = (row: number, col: number) => `${rowLetter(row)}${col + 1}`;

const sidesOf = (layout: SystemLayout): BoxSide[] => (layout === 'CONDO_DOUBLE' ? ['FRONT', 'BACK'] : ['FRONT']);

const SYSTEM_SELECT = {
  id: true,
  name: true,
  layout: true,
  rows: true,
  cols: true,
  sortOrder: true,
  createdAt: true,
} satisfies Prisma.CrabSystemSelect;

export async function listSystems(user: AuthUser) {
  const systems = await prisma.crabSystem.findMany({
    where: { ownerId: user.id },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: SYSTEM_SELECT,
  });
  // จำนวนปูที่ยังเลี้ยงอยู่ต่อระบบ (โชว์ในตัวเลือกระบบ)
  const counts = await prisma.crab.groupBy({
    by: ['systemId'],
    where: { ownerId: user.id, status: 'ALIVE', deletedAt: null },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((c) => [c.systemId, c._count._all]));
  return systems.map((s) => ({ ...s, aliveCrabs: byId.get(s.id) ?? 0 }));
}

function assertSize(rows: number, cols: number) {
  if (rows < 1 || rows > MAX_ROWS) throw badRequest(`จำนวนชั้นต้องอยู่ระหว่าง 1–${MAX_ROWS}`);
  if (cols < 1 || cols > MAX_COLS) throw badRequest(`จำนวนช่องต้องอยู่ระหว่าง 1–${MAX_COLS}`);
}

/** กล่องที่ผังขนาดนี้ต้องมี (ทุกด้าน) */
function wantedBoxes(layout: SystemLayout, rows: number, cols: number) {
  const out: { side: BoxSide; row: number; col: number; code: string }[] = [];
  for (const side of sidesOf(layout)) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) out.push({ side, row, col, code: boxCode(row, col) });
    }
  }
  return out;
}

export async function createSystem(user: AuthUser, input: { name: string; layout: SystemLayout; rows: number; cols: number }) {
  assertSize(input.rows, input.cols);
  const count = await prisma.crabSystem.count({ where: { ownerId: user.id } });
  return prisma.$transaction(async (tx) => {
    const system = await tx.crabSystem.create({
      data: { ownerId: user.id, name: input.name.trim(), layout: input.layout, rows: input.rows, cols: input.cols, sortOrder: count + 1 },
      select: SYSTEM_SELECT,
    });
    await tx.crabBox.createMany({
      data: wantedBoxes(input.layout, input.rows, input.cols).map((b) => ({ ...b, systemId: system.id })),
    });
    // แจ้งเตือนเริ่มต้น 6 เรื่อง (ข้อ 4.4.4)
    await tx.reminderRule.createMany({ data: defaultRulesData(user.id, system.id, new Date()) });
    return { ...system, aliveCrabs: 0 };
  });
}

export async function updateSystem(user: AuthUser, id: number, input: { name?: string; rows?: number; cols?: number }) {
  const system = assertOwned(await prisma.crabSystem.findUnique({ where: { id } }), user, 'ระบบปูนี้');
  const rows = input.rows ?? system.rows;
  const cols = input.cols ?? system.cols;
  assertSize(rows, cols);

  return prisma.$transaction(async (tx) => {
    if (rows !== system.rows || cols !== system.cols) {
      const all = await tx.crabBox.findMany({ where: { systemId: id } });
      const inRange = (b: { row: number; col: number }) => b.row < rows && b.col < cols;

      // ย่อผัง: กล่องที่จะหายต้องไม่มีปูที่ยังเลี้ยงอยู่
      const leaving = all.filter((b) => b.active && !inRange(b));
      if (leaving.length) {
        const occupied = await tx.crab.findMany({
          where: { boxId: { in: leaving.map((b) => b.id) }, status: 'ALIVE', deletedAt: null },
          select: { box: { select: { code: true, side: true } } },
        });
        if (occupied.length) {
          const codes = [...new Set(occupied.map((c) => c.box?.code))].join(', ');
          throw badRequest(`ย่อผังไม่ได้ — กล่อง ${codes} ยังมีปูอยู่ ย้ายปูออกก่อน`);
        }
        await tx.crabBox.updateMany({ where: { id: { in: leaving.map((b) => b.id) } }, data: { active: false } });
      }

      // ขยายผัง: เปิดกล่องเก่าที่เคยซ่อนกลับมา + สร้างกล่องที่ยังไม่เคยมี
      const key = (b: { side: BoxSide; row: number; col: number }) => `${b.side}:${b.row}:${b.col}`;
      const existing = new Map(all.map((b) => [key(b), b]));
      const reopen: number[] = [];
      const create: Prisma.CrabBoxCreateManyInput[] = [];
      for (const w of wantedBoxes(system.layout, rows, cols)) {
        const old = existing.get(key(w));
        if (!old) create.push({ ...w, systemId: id });
        else if (!old.active) reopen.push(old.id);
      }
      if (reopen.length) await tx.crabBox.updateMany({ where: { id: { in: reopen } }, data: { active: true } });
      if (create.length) await tx.crabBox.createMany({ data: create });
    }
    return tx.crabSystem.update({
      where: { id },
      data: { name: input.name?.trim() || undefined, rows, cols },
      select: SYSTEM_SELECT,
    });
  });
}

/** ลบได้เฉพาะระบบที่ไม่เคยมีปูเลย (มีประวัติปู/ขาย = ต้องเก็บไว้ทำบัญชี) */
export async function deleteSystem(user: AuthUser, id: number) {
  assertOwned(await prisma.crabSystem.findUnique({ where: { id } }), user, 'ระบบปูนี้');
  const crabs = await prisma.crab.count({ where: { systemId: id, deletedAt: null } });
  if (crabs) throw badRequest('ระบบนี้มีประวัติปูอยู่ ลบไม่ได้');
  await prisma.crabSystem.delete({ where: { id } });
}

/** ข้อมูลวาดหน้ากล่องปู: ผังกล่อง + ปูที่ยังเลี้ยงอยู่ (ค่าล่าสุด) */
export async function getSystemGrid(user: AuthUser, id: number) {
  const system = assertOwned(
    await prisma.crabSystem.findUnique({ where: { id }, select: { ...SYSTEM_SELECT, ownerId: true } }),
    user,
    'ระบบปูนี้',
  );
  const [boxes, crabs, checkDays] = await Promise.all([
    prisma.crabBox.findMany({
      where: { systemId: id, active: true },
      orderBy: [{ side: 'asc' }, { row: 'asc' }, { col: 'asc' }],
      select: { id: true, side: true, row: true, col: true, code: true },
    }),
    prisma.crab.findMany({
      where: { systemId: id, status: 'ALIVE', deletedAt: null },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        boxId: true,
        name: true,
        type: true,
        sex: true,
        grade: true,
        cableTieColor: true,
        lastWeightG: true,
        lastPct: true,
        lastPhotoUrl: true,
        lastCheckedAt: true,
        lot: { select: { id: true, receivedAt: true, totalCost: true } },
      },
    }),
    checkEveryDays(id),
  ]);
  const { ownerId: _o, ...sys } = system;
  return {
    system: sys,
    /** รอบเช็คเนื้อ/ไข่ (วัน) จากแจ้งเตือน "เช็คเนื้อ/ไข่ปู" — null = ปิดเรื่องนี้ไว้ (ไม่ขึ้น ⚠ ถึงรอบ) */
    checkEveryDays: checkDays,
    boxes,
    crabs: crabs.map(({ lot, ...c }) => ({
      ...c,
      lot: { id: lot.id, receivedAt: lot.receivedAt, costMissing: lot.totalCost == null },
    })),
  };
}
