import { Prisma, type BoxSide, type SystemLayout } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import type { AuthUser } from '../auth.service';
import { defaultRulesData } from '../reminders/defaults';
import { defaultParamsData } from '../water/defaults';
import { checkEveryDays } from '../reminders/rule.service';
import { TX_OPTS } from './lot.service';

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

/**
 * รหัสกล่องตามด้าน — คอนโดหน้า-หลัง: ด้านหลังต่อตัวอักษรจากด้านหน้า (หน้า 4 ชั้น A–D → หลัง E–H)
 * รหัสไม่ซ้ำทั้งระบบ ผู้ใช้ไม่ต้องพูด/เขียนว่า "หน้า/หลัง" (เดิมรหัสซ้ำกัน 2 ด้าน ผู้ใช้งง · 2026-11-17)
 * ⚠️ สำเนาที่หน้าเว็บ lib/farm.ts sideBoxCode — แก้คู่กัน
 */
export const sideBoxCode = (side: BoxSide, rows: number, row: number, col: number) => boxCode(side === 'BACK' ? rows + row : row, col);

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
  if (rows < 1 || rows > MAX_ROWS) throw badRequest(`จำนวนชั้นต้องอยู่ระหว่าง 1-${MAX_ROWS}`);
  if (cols < 1 || cols > MAX_COLS) throw badRequest(`จำนวนช่องต้องอยู่ระหว่าง 1-${MAX_COLS}`);
}

/** กล่องที่ผังขนาดนี้ต้องมี (ทุกด้าน) */
function wantedBoxes(layout: SystemLayout, rows: number, cols: number) {
  const out: { side: BoxSide; row: number; col: number; code: string }[] = [];
  for (const side of sidesOf(layout)) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) out.push({ side, row, col, code: sideBoxCode(side, rows, row, col) });
    }
  }
  return out;
}

/** ชื่อระบบซ้ำกับระบบอื่นของเจ้าของเดียวกันไม่ได้ (เจอจริง: กดสร้างซ้ำได้ "ระบบปู 1" 2 ระบบ แจ้งเตือนขึ้นซ้ำทุกเรื่อง) */
async function assertNameFree(db: Prisma.TransactionClient, ownerId: number, name: string, exceptId?: number) {
  const dup = await db.crabSystem.findFirst({ where: { ownerId, name, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (dup) throw badRequest(`มีระบบชื่อ "${name}" แล้ว ตั้งชื่ออื่น`);
}

export async function createSystem(user: AuthUser, input: { name: string; layout: SystemLayout; rows: number; cols: number }) {
  assertSize(input.rows, input.cols);
  const name = input.name.trim();
  return prisma.$transaction(async (tx) => {
    // ล็อกแถวผู้ใช้ก่อน → 2 คำขอสร้างพร้อมกันเข้าคิว ตัวที่ 2 เห็นชื่อซ้ำแล้วถูกปฏิเสธ (เช็คก่อน transaction = ผ่านทั้งคู่)
    await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${user.id} FOR UPDATE`;
    await assertNameFree(tx, user.id, name);
    const count = await tx.crabSystem.count({ where: { ownerId: user.id } });
    const system = await tx.crabSystem.create({
      data: { ownerId: user.id, name, layout: input.layout, rows: input.rows, cols: input.cols, sortOrder: count + 1 },
      select: SYSTEM_SELECT,
    });
    await tx.crabBox.createMany({
      data: wantedBoxes(input.layout, input.rows, input.cols).map((b) => ({ ...b, systemId: system.id })),
    });
    // แจ้งเตือนเริ่มต้น 6 เรื่อง (ข้อ 4.4.4)
    await tx.reminderRule.createMany({ data: defaultRulesData(user.id, system.id, new Date()) });
    // ค่าน้ำเริ่มต้น 8 ค่า (ข้อ 5.7) — ยังไม่มีเกณฑ์ ผู้ใช้ตั้งเองครั้งแรก
    await tx.waterParam.createMany({ data: defaultParamsData(user.id, system.id) });
    return { ...system, aliveCrabs: 0 };
  }, TX_OPTS);
}

export async function updateSystem(user: AuthUser, id: number, input: { name?: string; rows?: number; cols?: number }) {
  const system = assertOwned(await prisma.crabSystem.findUnique({ where: { id } }), user, 'ระบบปูนี้');
  const rows = input.rows ?? system.rows;
  const cols = input.cols ?? system.cols;
  assertSize(rows, cols);
  if (input.name?.trim() && input.name.trim() !== system.name) await assertNameFree(prisma, user.id, input.name.trim(), id);

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
          throw badRequest(`ย่อผังไม่ได้ กล่อง ${codes} ยังมีปูอยู่ ย้ายปูออกก่อน`);
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

      // คอนโดหน้า-หลัง เปลี่ยนจำนวนชั้น → ตัวอักษรด้านหลังเลื่อนตาม (หน้า A–D หลัง E–H → หน้า A–E หลัง F–J)
      // 2 จังหวะ: ใส่รหัสชั่วคราวก่อน ไม่งั้นชน unique (systemId, side, code) ระหว่างเลื่อน
      if (system.layout === 'CONDO_DOUBLE' && rows !== system.rows) {
        const back = all.filter((b) => b.side === 'BACK');
        if (back.length) {
          // ปูที่ชื่อยังเป็นรหัสกล่องเดิม (ค่าเริ่มต้น) → เปลี่ยนชื่อตามรหัสใหม่ด้วย · ตั้งชื่อเองแล้วไม่แตะ
          const oldCode = new Map(back.map((b) => [b.id, b.code]));
          const named = await tx.crab.findMany({ where: { boxId: { in: back.map((b) => b.id) }, deletedAt: null }, select: { id: true, boxId: true, name: true } });
          for (const c of named) {
            const b = back.find((x) => x.id === c.boxId)!;
            if (c.name === oldCode.get(b.id)) await tx.crab.update({ where: { id: c.id }, data: { name: sideBoxCode('BACK', rows, b.row, b.col) } });
          }
          await tx.$executeRaw`UPDATE \`CrabBox\` SET \`code\` = CONCAT('~', \`id\`) WHERE \`systemId\` = ${id} AND \`side\` = 'BACK'`;
          const cases = back.map((b) => Prisma.sql`WHEN ${b.id} THEN ${sideBoxCode('BACK', rows, b.row, b.col)}`);
          await tx.$executeRaw`UPDATE \`CrabBox\` SET \`code\` = CASE \`id\` ${Prisma.join(cases, ' ')} END WHERE \`systemId\` = ${id} AND \`side\` = 'BACK'`;
        }
        // กล่องใหม่ด้านหลังที่จะสร้าง ใช้รหัสตามจำนวนชั้นใหม่อยู่แล้ว (wantedBoxes)
      }
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
        // ใบจอง (P6) → ป้าย 🔖 ชื่อลูกค้าบนกล่อง · ห้ามเลือกซ้ำในโหมดขาย
        sale: { select: { id: true, no: true, customer: { select: { name: true } } } },
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
    crabs: crabs.map(({ lot, sale, ...c }) => ({
      ...c,
      lot: { id: lot.id, receivedAt: lot.receivedAt, costMissing: lot.totalCost == null },
      sale: sale ? { id: sale.id, no: sale.no, customer: sale.customer?.name ?? null } : null,
    })),
  };
}
