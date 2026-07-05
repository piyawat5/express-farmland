import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound, badRequest } from '../lib/http';
import type { AuthUser } from './auth.service';
import { systemScopeWhere, assertOwnership } from '../lib/scope';

// ── โมดูล B: Crab = ปู 1 ตัว (1 กล่อง = หลายตัวได้ — แยกด้วยเคเบิ้ลไทล์สี, ข้อ 2) ──

type CrabFilter = {
  systemId?: number;
  status?: Prisma.EnumCrabStatusFilter['equals'];
  type?: Prisma.EnumCrabTypeFilter['equals'];
};

export async function listCrabs(user: AuthUser, filter: CrabFilter) {
  const scope = await systemScopeWhere(user, filter.systemId);
  return prisma.crab.findMany({
    where: {
      ...scope, // จำกัดเฉพาะปูในระบบของ user (ADMIN เห็นทั้งหมด)
      status: filter.status,
      type: filter.type,
    },
    orderBy: { id: 'asc' },
    include: {
      box: { select: { id: true, code: true } },
    },
  });
}

export async function getCrab(id: number, user: AuthUser) {
  const crab = await prisma.crab.findUnique({
    where: { id },
    include: {
      box: { select: { id: true, code: true } },
      system: { select: { id: true, name: true, ownerId: true } },
      feedings: { orderBy: { fedAt: 'desc' }, take: 20 },
      firmnessLogs: { orderBy: { checkedAt: 'desc' }, take: 20 },
      history: { orderBy: { recordedAt: 'desc' }, take: 50 }, // ประวัติแยกโซน (ข้อ 8)
    },
  });
  if (!crab) throw notFound('ไม่พบปูตัวนี้');
  assertOwnership(user, crab.system.ownerId);
  return crab;
}

/**
 * ตรวจว่ากล่องอยู่ในระบบเดียวกับปู (1 กล่องใส่ปูได้หลายตัว — ไม่กันจำนวนแล้ว, ข้อ 2)
 * แยกตัวด้วย cableTieColor ที่ฝั่ง UI
 */
async function assertBoxInSystem(tx: Prisma.TransactionClient, systemId: number, boxId: number) {
  const box = await tx.crabBox.findUnique({ where: { id: boxId } });
  if (!box) throw notFound('ไม่พบกล่องที่ระบุ');
  if (box.systemId !== systemId) throw badRequest('กล่องนี้ไม่ได้อยู่ในระบบเดียวกับปู');
}

/**
 * หา code ที่ไม่ซ้ำในระบบเดียวกัน โดยต่อท้าย -2, -3, ... (ข้อ 1.6.7)
 * จำเป็นเพราะ 1 กล่องมีปูได้หลายตัว → default code (ชื่อระบบ+กล่อง) จะชนกันเอง
 */
async function uniqueCodeInSystem(
  tx: Prisma.TransactionClient,
  systemId: number,
  base: string,
): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const clash = await tx.crab.count({ where: { systemId, code: candidate } });
    if (clash === 0) return candidate;
  }
}

// ── ประวัติแยกโซน (ข้อ 8) ──────────────────────────────────────────────
// 1 การกดบันทึกอาจแก้หลายฟิลด์ แต่เก็บ CrabHistory เฉพาะ "โซน" ที่ค่ามีการเปลี่ยนจริง
// เพื่อให้ FE โชว์ประวัติแยกโซน (แก้แค่น้ำหนัก → ประวัติขึ้นเฉพาะโซนวัด)
const ZONE_FIELDS: Record<string, (keyof Prisma.CrabUncheckedUpdateInput)[]> = {
  MEASURE: ['weightG', 'currentFirmnessPct', 'lastCheckedAt'],
  CLASSIFY: ['type', 'sex', 'grade', 'status'],
  FEEDING: ['feedingNote'],
  SOURCE: ['purchasePrice', 'purchaseDate', 'cableTieColor', 'lockedForBuyerId', 'code', 'note'],
};

/** ทำให้ค่าเทียบกันได้เพื่อ diff ว่าเปลี่ยนจริงไหม
 *  Date เทียบระดับ "วัน" (YYYY-MM-DD) เพราะ FE ส่ง date-only กลับมา (lastCheckedAt/purchaseDate)
 *  — ถ้าเทียบ timestamp เต็มจะเห็น "เปลี่ยน" ทุกครั้ง (เวลาหาย) → บันทึกประวัติซ้ำ */
function norm(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v instanceof Prisma.Decimal) return Number(v);
  return v;
}

/** ทำให้ค่าเก็บลง Json ได้ (Decimal→number, Date→ISO) */
function toJson(v: unknown): Prisma.InputJsonValue | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Prisma.Decimal) return Number(v);
  return v as Prisma.InputJsonValue;
}

type ZoneSnapshot = { zone: string; snapshot: Record<string, Prisma.InputJsonValue | null> };

/** เทียบ data (ที่ส่งมา) กับ current → คืนรายการโซนที่เปลี่ยน + snapshot ค่าปัจจุบันของโซนนั้น */
function diffZones(
  current: Record<string, unknown>,
  data: Record<string, unknown>,
): ZoneSnapshot[] {
  const zones: ZoneSnapshot[] = [];
  for (const [zone, fields] of Object.entries(ZONE_FIELDS)) {
    let changed = false;
    const snapshot: Record<string, Prisma.InputJsonValue | null> = {};
    for (const f of fields) {
      const provided = data[f as string] !== undefined;
      const effective = provided ? data[f as string] : current[f as string];
      snapshot[f as string] = toJson(effective);
      if (provided && norm(data[f as string]) !== norm(current[f as string])) changed = true;
    }
    if (changed) zones.push({ zone, snapshot });
  }
  return zones;
}

export function createCrab(data: Prisma.CrabUncheckedCreateInput) {
  return prisma.$transaction(async (tx) => {
    if (data.boxId != null) {
      await assertBoxInSystem(tx, data.systemId, data.boxId);
    }
    // บันทึกค่าวัด (น้ำหนัก/%) โดยไม่ระบุวันเช็ค → ถือว่าเช็ควันนี้ (ข้อ 8)
    if ((data.weightG != null || data.currentFirmnessPct != null) && data.lastCheckedAt == null) {
      data.lastCheckedAt = new Date();
    }
    // ถ้าไม่ระบุรหัสปู → default = ชื่อระบบ + รหัสกล่อง (เช่นระบบ "1" กล่อง A1 → "1A1")
    // 1 กล่องมีปูได้หลายตัว → ต่อท้ายลำดับให้ไม่ซ้ำกัน (ข้อ 1.6.7) เช่น 1A1, 1A1-2, 1A1-3
    if ((data.code == null || data.code === '') && data.boxId != null) {
      const [system, box] = await Promise.all([
        tx.crabSystem.findUnique({ where: { id: data.systemId }, select: { name: true } }),
        tx.crabBox.findUnique({ where: { id: data.boxId }, select: { code: true } }),
      ]);
      if (system && box) {
        const base = `${system.name}${box.code}`;
        data.code = await uniqueCodeInSystem(tx, data.systemId, base);
      }
    }
    const crab = await tx.crab.create({ data });
    if (crab.boxId != null) {
      await tx.crabBox.update({ where: { id: crab.boxId }, data: { status: 'OCCUPIED' } });
    }
    // ประวัติเริ่มต้นโซนวัด (ถ้ามีค่าวัดตอนสร้าง)
    if (crab.weightG != null || crab.currentFirmnessPct != null || crab.lastCheckedAt != null) {
      await tx.crabHistory.create({
        data: {
          crabId: crab.id,
          zone: 'MEASURE',
          snapshot: {
            weightG: toJson(crab.weightG),
            currentFirmnessPct: toJson(crab.currentFirmnessPct),
            lastCheckedAt: toJson(crab.lastCheckedAt),
          },
        },
      });
    }
    return crab;
  });
}

export function updateCrab(id: number, data: Prisma.CrabUncheckedUpdateInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.crab.findUnique({ where: { id } });
    if (!current) throw notFound('ไม่พบปูตัวนี้');

    // บันทึกค่าวัดใหม่แต่ไม่ได้ตั้งวันเช็ค → auto stamp วันนี้ (ข้อ 8)
    const measureTouched = data.weightG !== undefined || data.currentFirmnessPct !== undefined;
    if (measureTouched && (data.lastCheckedAt === undefined || data.lastCheckedAt === null)) {
      data.lastCheckedAt = new Date();
    }

    const nextBoxId = data.boxId === undefined ? current.boxId : (data.boxId as number | null);
    const nextStatus = (data.status as string | undefined) ?? current.status;
    const stillLiving = nextStatus === 'FATTENING' || nextStatus === 'READY';

    // ย้ายกล่อง: เช็คว่ากล่องใหม่อยู่ระบบเดียวกัน (ไม่กันจำนวนปูต่อกล่องแล้ว)
    if (nextBoxId != null && nextBoxId !== current.boxId && stillLiving) {
      await assertBoxInSystem(tx, current.systemId, nextBoxId);
    }

    // diff โซนที่เปลี่ยน "ก่อน" update (เทียบกับค่าเดิม)
    const zones = diffZones(
      current as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>,
    );

    const crab = await tx.crab.update({ where: { id }, data });

    // บันทึกประวัติเฉพาะโซนที่เปลี่ยน (ข้อ 8)
    for (const z of zones) {
      await tx.crabHistory.create({
        data: { crabId: id, zone: z.zone, snapshot: z.snapshot },
      });
    }

    // เช็คไข่/เนื้อแล้ว (โซนวัดเปลี่ยน) → ปิด Task CRAB_CHECK ที่ค้างของปูตัวนี้ (ข้อ 3)
    if (zones.some((z) => z.zone === 'MEASURE')) {
      await tx.task.updateMany({
        where: { type: 'CRAB_CHECK', status: 'PENDING', linkType: 'Crab', linkId: id },
        data: { status: 'DONE', completedAt: new Date(), linkType: 'Crab', linkId: id },
      });
    }

    // sync สถานะกล่อง
    if (current.boxId != null && current.boxId !== nextBoxId) {
      await freeBoxIfEmpty(tx, current.boxId);
    }
    if (nextBoxId != null) {
      await tx.crabBox.update({
        where: { id: nextBoxId },
        data: { status: stillLiving ? 'OCCUPIED' : 'EMPTY' },
      });
    }
    return crab;
  });
}

export function deleteCrab(id: number) {
  return prisma.$transaction(async (tx) => {
    const crab = await tx.crab.findUnique({ where: { id } });
    if (!crab) throw notFound('ไม่พบปูตัวนี้');
    await tx.crab.delete({ where: { id } });
    if (crab.boxId != null) await freeBoxIfEmpty(tx, crab.boxId);
  });
}

/** ลบประวัติแยกโซน 1 รายการ (ข้อ 8 — ลบแถวซ้ำ/ผิดออกได้) */
export async function deleteCrabHistory(id: number, user: AuthUser) {
  const h = await prisma.crabHistory.findUnique({
    where: { id },
    include: { crab: { select: { system: { select: { ownerId: true } } } } },
  });
  if (!h) throw notFound('ไม่พบประวัตินี้');
  assertOwnership(user, h.crab.system.ownerId);
  await prisma.crabHistory.delete({ where: { id } });
}

/** คืนกล่องเป็น EMPTY ถ้าไม่มีปูที่ยังอยู่จริงในกล่องนั้นแล้ว */
async function freeBoxIfEmpty(tx: Prisma.TransactionClient, boxId: number) {
  const living = await tx.crab.count({
    where: { boxId, status: { in: ['FATTENING', 'READY'] } },
  });
  if (living === 0) {
    await tx.crabBox.update({ where: { id: boxId }, data: { status: 'EMPTY' } });
  }
}

// ── ส่งออกรายงานปู CSV (ข้อ 6) — เอาไปเทรน/วิเคราะห์แผนให้อาหารต่อได้ ──
const num = (v: Prisma.Decimal | number | null): number | null => (v == null ? null : Number(v));
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const TYPE_TH: Record<string, string> = { MEAT: 'เนื้อ', EGG: 'ไข่', UNKNOWN: '-' };
const SEX_TH: Record<string, string> = { MALE: 'ผู้', FEMALE: 'เมีย', INTERSEX: 'กะเทย', UNKNOWN: '-' };
const STATUS_TH: Record<string, string> = {
  FATTENING: 'กำลังขุน',
  READY: 'พร้อมขาย',
  SOLD: 'ขายแล้ว',
  DEAD: 'ตาย',
};

/** escape 1 ช่องของ CSV (ครอบด้วย " ถ้ามี , " หรือขึ้นบรรทัด) */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}
function ymd(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '';
}

export async function exportCrabsCsv(user: AuthUser, systemId?: number): Promise<string> {
  const scope = await systemScopeWhere(user, systemId);
  const crabs = await prisma.crab.findMany({
    where: scope,
    orderBy: [{ systemId: 'asc' }, { id: 'asc' }],
    include: {
      box: { select: { code: true } },
      system: { select: { name: true } },
      _count: { select: { history: true } },
    },
  });
  const now = Date.now();
  const header = [
    'id', 'ระบบ', 'กล่อง', 'รหัสปู', 'ชนิด', 'เพศ', 'เกรด', 'สถานะ',
    'วันที่ซื้อ', 'อายุเลี้ยง(วัน)', 'ราคาซื้อ', 'น้ำหนัก(กรัม)', '%ไข่/แน่น',
    'พฤติกรรมการกิน', 'วันเช็คล่าสุด', 'จำนวนครั้งที่บันทึก', 'วันที่ขาย', 'ราคาขาย', 'กำไร',
  ];
  const lines = [csvRow(header)];
  for (const c of crabs) {
    const end = c.sellDate ? c.sellDate.getTime() : now;
    const ageDays = c.purchaseDate ? Math.round((end - c.purchaseDate.getTime()) / MS_PER_DAY) : '';
    const buy = num(c.purchasePrice);
    const sell = num(c.sellPrice);
    const profit = buy != null && sell != null ? Math.round((sell - buy) * 100) / 100 : '';
    lines.push(
      csvRow([
        c.id,
        c.system?.name ?? '',
        c.box?.code ?? '',
        c.code ?? '',
        TYPE_TH[c.type] ?? c.type,
        SEX_TH[c.sex] ?? c.sex,
        c.grade ?? '',
        STATUS_TH[c.status] ?? c.status,
        ymd(c.purchaseDate),
        ageDays,
        buy ?? '',
        num(c.weightG) ?? '',
        c.currentFirmnessPct ?? '',
        c.feedingNote ?? '',
        ymd(c.lastCheckedAt),
        c._count.history,
        ymd(c.sellDate),
        sell ?? '',
        profit,
      ]),
    );
  }
  // นำหน้าด้วย BOM ให้ Excel เปิดไทยไม่เพี้ยน
  return '﻿' + lines.join('\r\n');
}
