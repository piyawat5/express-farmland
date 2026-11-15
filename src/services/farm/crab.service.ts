import { Prisma, type BoxSide, type CrabGrade, type CrabSex, type CrabType, type SystemLayout } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import { deleteImage } from '../../lib/cloudinary';
import type { AuthUser } from '../auth.service';
import { allocateLotCost, TX_OPTS } from './lot.service';

// ════════════════════════════════════════════════════════════════════
//  ปู + การเช็คปู
//  - "เช็ควันนี้" = เพิ่มแถว CrabCheck ใหม่เสมอ (แก้ปัญหา v1 ที่ลืมเปลี่ยนวันที่แล้วประวัติมั่ว)
//  - แก้รอบเก่าต้องกด "แก้รอบนี้" ที่รอบนั้นตรงๆ
//  - ใส่รูปแล้วต้องมี % (ไข่/เนื้อ) — กันลืมจนถึงวันขาย (ปูนิ่มไม่ต้องมี %)
//  - ค่า last* บนตัวปู = สำเนาจากการเช็คล่าสุด คำนวณใหม่ทุกครั้งที่เพิ่ม/แก้/ลบรอบ
// ════════════════════════════════════════════════════════════════════

type Tx = Prisma.TransactionClient;

export type CheckInput = {
  checkedAt?: Date;
  weightG?: number | null;
  pct?: number | null;
  aiPct?: number | null;
  photoUrl?: string | null;
  photoPublicId?: string | null;
  note?: string | null;
};

const hasAnything = (c: CheckInput) =>
  c.weightG != null || c.pct != null || !!c.photoUrl || !!c.note?.trim();

function assertCheckRules(type: CrabType, c: CheckInput) {
  if (!hasAnything(c)) throw badRequest('ใส่อย่างน้อย 1 อย่าง: น้ำหนัก, %, รูป หรือโน้ต');
  if (c.photoUrl && type !== 'SOFT' && c.pct == null) {
    throw badRequest(type === 'EGG' ? 'มีรูปใหม่แล้ว ใส่ % ไข่ด้วย' : 'มีรูปใหม่แล้ว ใส่ % เนื้อด้วย');
  }
  if (c.pct != null && (c.pct < 0 || c.pct > 100)) throw badRequest('% ต้องอยู่ระหว่าง 0–100');
  if (c.weightG != null && (c.weightG <= 0 || c.weightG > 5000)) throw badRequest('น้ำหนักไม่ถูกต้อง');
}

/** คำนวณค่า "ล่าสุด" บนตัวปูใหม่จากประวัติการเช็ค */
async function refreshLast(tx: Tx, crabId: number) {
  const checks = await tx.crabCheck.findMany({
    where: { crabId },
    orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
    select: { checkedAt: true, weightG: true, pct: true, photoUrl: true },
  });
  await tx.crab.update({
    where: { id: crabId },
    data: {
      lastCheckedAt: checks[0]?.checkedAt ?? null,
      lastWeightG: checks.find((c) => c.weightG != null)?.weightG ?? null,
      lastPct: checks.find((c) => c.pct != null)?.pct ?? null,
      lastPhotoUrl: checks.find((c) => c.photoUrl)?.photoUrl ?? null,
    },
  });
}

/** ชื่อเริ่มต้นของปู = รหัสกล่อง (คอนโดหน้า-หลังเติม "หน้า/หลัง" ให้ไม่สับสน) */
export function defaultCrabName(layout: SystemLayout, side: BoxSide, code: string) {
  if (layout !== 'CONDO_DOUBLE') return code;
  return `${side === 'FRONT' ? 'หน้า' : 'หลัง'} ${code}`;
}

async function nextCrabCode(tx: Tx, ownerId: number) {
  const n = await tx.crab.count({ where: { ownerId } });
  return `C${String(n + 1).padStart(4, '0')}`;
}

async function loadBox(user: AuthUser, boxId: number) {
  const box = await prisma.crabBox.findUnique({
    where: { id: boxId },
    select: { id: true, side: true, code: true, active: true, systemId: true, system: { select: { ownerId: true, layout: true } } },
  });
  if (!box || !box.active || box.system.ownerId !== user.id) throw badRequest('ไม่พบกล่องนี้');
  return box;
}

export type CreateCrabInput = {
  boxId: number;
  /** ล็อตที่มีอยู่แล้ว */
  lotId?: number;
  /** หรือสร้างล็อตใหม่ไปพร้อมกัน (เพิ่มปูจากในกล่องโดยตรง) */
  newLot?: { sellerId?: number | null; receivedAt?: Date; totalCost?: number | null };
  name?: string | null;
  type: CrabType;
  sex?: CrabSex | null;
  grade?: CrabGrade | null;
  cableTieColor?: string | null;
  note?: string | null;
  check?: CheckInput;
};

export async function createCrab(user: AuthUser, input: CreateCrabInput) {
  const box = await loadBox(user, input.boxId);
  if (!input.lotId && !input.newLot) throw badRequest('ต้องเลือกว่าปูตัวนี้มาจากล็อตไหน');
  if (input.check) assertCheckRules(input.type, input.check);

  let lotId = input.lotId;
  if (lotId) {
    const lot = assertOwned(await prisma.crabLot.findUnique({ where: { id: lotId } }), user, 'ล็อตนี้');
    if (lot.systemId !== box.systemId) throw badRequest('ล็อตนี้เป็นของอีกระบบปู');
  } else if (input.newLot?.sellerId) {
    assertOwned(await prisma.contact.findUnique({ where: { id: input.newLot.sellerId } }), user, 'คนขายนี้');
  }

  const crabId = await retryOnCodeClash(() =>
    prisma.$transaction(async (tx) => {
      if (!lotId) {
        const nl = input.newLot!;
        const lot = await tx.crabLot.create({
          data: {
            ownerId: user.id,
            systemId: box.systemId,
            sellerId: nl.sellerId ?? null,
            receivedAt: nl.receivedAt ?? new Date(),
            totalCost: nl.totalCost ?? null,
            costEnteredAt: nl.totalCost != null ? new Date() : null,
          },
        });
        lotId = lot.id;
      }
      const crab = await tx.crab.create({
        data: {
          ownerId: user.id,
          systemId: box.systemId,
          boxId: box.id,
          lotId: lotId!,
          code: await nextCrabCode(tx, user.id),
          name: input.name?.trim() || defaultCrabName(box.system.layout, box.side, box.code),
          type: input.type,
          sex: input.sex ?? null,
          grade: input.grade ?? null,
          cableTieColor: input.cableTieColor ?? null,
          note: input.note ?? null,
        },
      });
      if (input.check && hasAnything(input.check)) {
        await tx.crabCheck.create({ data: { ...checkData(input.check), crabId: crab.id, checkedAt: input.check.checkedAt ?? new Date() } });
        await refreshLast(tx, crab.id);
      }
      await allocateLotCost(tx, lotId!);
      return crab.id;
    }, TX_OPTS),
  );
  return getCrab(user, crabId);
}

/** รหัสปูสร้างจากจำนวนปู → 2 คนเพิ่มพร้อมกันอาจได้รหัสเดียวกัน (unique ชน) → ลองใหม่ */
async function retryOnCodeClash<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const clash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
      if (!clash || i >= tries - 1) throw e;
    }
  }
}

const checkData = (c: CheckInput) => ({
  weightG: c.weightG ?? null,
  pct: c.pct ?? null,
  aiPct: c.aiPct ?? null,
  photoUrl: c.photoUrl ?? null,
  photoPublicId: c.photoPublicId ?? null,
  note: c.note?.trim() || null,
});

const CRAB_DETAIL = {
  id: true,
  ownerId: true,
  code: true,
  name: true,
  type: true,
  sex: true,
  grade: true,
  cableTieColor: true,
  status: true,
  allocatedCost: true,
  lastWeightG: true,
  lastPct: true,
  lastPhotoUrl: true,
  lastCheckedAt: true,
  diedAt: true,
  soldAt: true,
  note: true,
  createdAt: true,
  systemId: true,
  /** ใบจอง/ใบขายที่ถือปูตัวนี้อยู่ (P6) */
  sale: { select: { id: true, no: true, status: true, customer: { select: { name: true } } } },
  box: { select: { id: true, side: true, code: true } },
  system: { select: { id: true, name: true, layout: true } },
  lot: {
    select: { id: true, receivedAt: true, totalCost: true, seller: { select: { id: true, name: true } } },
  },
  checks: {
    orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, checkedAt: true, weightG: true, pct: true, aiPct: true, photoUrl: true, note: true, createdAt: true },
  },
} satisfies Prisma.CrabSelect;

export async function getCrab(user: AuthUser, id: number) {
  const crab = assertOwned(
    await prisma.crab.findFirst({ where: { id, deletedAt: null }, select: CRAB_DETAIL }),
    user,
    'ปูตัวนี้',
  );
  const { ownerId: _o, sale, ...rest } = crab;
  return { ...rest, sale: sale ? { id: sale.id, no: sale.no, status: sale.status, customer: sale.customer?.name ?? null } : null };
}

export type UpdateCrabInput = {
  name?: string;
  type?: CrabType;
  sex?: CrabSex | null;
  grade?: CrabGrade | null;
  cableTieColor?: string | null;
  note?: string | null;
  /** ย้ายกล่อง (ข้ามระบบได้) */
  boxId?: number;
  /** ย้ายไปอีกล็อต (ใส่ล็อตผิดตอนรับเข้า) */
  lotId?: number;
};

async function loadOwnedCrab(user: AuthUser, id: number) {
  return assertOwned(
    await prisma.crab.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, ownerId: true, lotId: true, type: true, systemId: true, sale: { select: { no: true, status: true } } },
    }),
    user,
    'ปูตัวนี้',
  );
}

/** ปูที่อยู่ในใบจอง/ใบขาย (P6) ทำบางอย่างไม่ได้จนกว่าจะเอาออกจากใบ */
function assertNotHeld(crab: { sale: { no: number; status: string } | null }, what: string) {
  if (!crab.sale) return;
  const kind = crab.sale.status === 'DONE' ? 'ขายไปแล้วในใบที่' : 'จองไว้ในใบที่';
  throw badRequest(`ปูตัวนี้${kind} ${crab.sale.no} — ${what}ไม่ได้ เอาออกจากใบก่อน`);
}

export async function updateCrab(user: AuthUser, id: number, input: UpdateCrabInput) {
  const crab = await loadOwnedCrab(user, id);
  const box = input.boxId ? await loadBox(user, input.boxId) : null;
  if (box && box.systemId !== crab.systemId) assertNotHeld(crab, 'ย้ายไปอีกระบบ');
  if (input.lotId && input.lotId !== crab.lotId) {
    assertOwned(await prisma.crabLot.findUnique({ where: { id: input.lotId } }), user, 'ล็อตนี้');
  }

  await prisma.$transaction(async (tx) => {
    await tx.crab.update({
      where: { id },
      data: {
        name: input.name?.trim() || undefined,
        type: input.type,
        sex: input.sex,
        grade: input.grade,
        cableTieColor: input.cableTieColor,
        note: input.note,
        ...(box ? { boxId: box.id, systemId: box.systemId } : {}),
        ...(input.lotId ? { lotId: input.lotId } : {}),
      },
    });
    if (input.lotId && input.lotId !== crab.lotId) {
      await allocateLotCost(tx, crab.lotId);
      await allocateLotCost(tx, input.lotId);
    }
  }, TX_OPTS);
  return getCrab(user, id);
}

/** ปูตาย / ย้อนกลับ (กดผิด) */
export async function setCrabDead(user: AuthUser, id: number, dead: boolean, diedAt?: Date) {
  const crab = await loadOwnedCrab(user, id);
  assertNotHeld(crab, dead ? 'บันทึกว่าตาย' : 'เปลี่ยนสถานะ');
  await prisma.crab.update({
    where: { id },
    data: dead ? { status: 'DEAD', diedAt: diedAt ?? new Date() } : { status: 'ALIVE', diedAt: null },
  });
  return getCrab(user, id);
}

/** ลบเพราะบันทึกผิด → ซ่อน + แบ่งต้นทุนล็อตใหม่ (ไม่ลบจริง เผื่อกดพลาด) */
export async function deleteCrab(user: AuthUser, id: number) {
  const crab = await loadOwnedCrab(user, id);
  assertNotHeld(crab, 'ลบ');
  await prisma.$transaction(async (tx) => {
    await tx.crab.update({ where: { id }, data: { deletedAt: new Date() } });
    await allocateLotCost(tx, crab.lotId);
  }, TX_OPTS);
}

// ── การเช็คปู ─────────────────────────────────────────────────────────

export async function addCheck(user: AuthUser, crabId: number, input: CheckInput) {
  const crab = await loadOwnedCrab(user, crabId);
  assertCheckRules(crab.type, input);
  await prisma.$transaction(async (tx) => {
    await tx.crabCheck.create({ data: { ...checkData(input), crabId, checkedAt: input.checkedAt ?? new Date() } });
    await refreshLast(tx, crabId);
  });
  return getCrab(user, crabId);
}

async function loadOwnedCheck(user: AuthUser, checkId: number) {
  const check = await prisma.crabCheck.findUnique({
    where: { id: checkId },
    include: { crab: { select: { id: true, ownerId: true, type: true, lotId: true, deletedAt: true } } },
  });
  if (!check || check.crab.ownerId !== user.id || check.crab.deletedAt) assertOwned(null, user, 'รอบเช็คนี้');
  return check!;
}

/** "แก้รอบนี้" — แก้รอบเก่าตรงๆ (ส่งเฉพาะช่องที่แก้) */
export async function updateCheck(user: AuthUser, checkId: number, input: CheckInput) {
  const check = await loadOwnedCheck(user, checkId);
  const merged: CheckInput = {
    weightG: input.weightG !== undefined ? input.weightG : check.weightG?.toNumber() ?? null,
    pct: input.pct !== undefined ? input.pct : check.pct,
    aiPct: input.aiPct !== undefined ? input.aiPct : check.aiPct,
    photoUrl: input.photoUrl !== undefined ? input.photoUrl : check.photoUrl,
    photoPublicId: input.photoPublicId !== undefined ? input.photoPublicId : check.photoPublicId,
    note: input.note !== undefined ? input.note : check.note,
  };
  assertCheckRules(check.crab.type, merged);
  const photoReplaced = input.photoUrl !== undefined && input.photoUrl !== check.photoUrl;

  await prisma.$transaction(async (tx) => {
    await tx.crabCheck.update({
      where: { id: checkId },
      data: { ...checkData(merged), checkedAt: input.checkedAt ?? undefined },
    });
    await refreshLast(tx, check.crabId);
    if (input.weightG !== undefined || input.checkedAt) await allocateLotCost(tx, check.crab.lotId);
  }, TX_OPTS);
  if (photoReplaced) await deleteImage(check.photoPublicId);
  return getCrab(user, check.crabId);
}

export async function deleteCheck(user: AuthUser, checkId: number) {
  const check = await loadOwnedCheck(user, checkId);
  await prisma.$transaction(async (tx) => {
    await tx.crabCheck.delete({ where: { id: checkId } });
    await refreshLast(tx, check.crabId);
    await allocateLotCost(tx, check.crab.lotId);
  }, TX_OPTS);
  await deleteImage(check.photoPublicId);
  return getCrab(user, check.crabId);
}
