import { Prisma, type Role, type SubscriptionSource } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, badRequest, notFound } from '../lib/http';
import { env } from '../config/env';
import { escapeHtml, sendHtmlEmail, sendNotificationEmail } from '../lib/mailer';
import { getShopSettings } from './settings.service';

// ════════════════════════════════════════════════════════════════════
//  สิทธิ์ใช้งาน (สมาชิก) + สลิปโอนเงิน
//  - ลูกค้าอัปสลิป → แอดมินอนุมัติ → ได้ Subscription ทันที
//  - ต่ออายุตอนยังไม่หมด = เริ่มนับต่อจากวันหมดอายุเดิม (ไม่เสียวันที่จ่ายไปแล้ว)
//  - หมดอายุแล้วยังใช้ได้อีก graceDays วัน (ตั้งในหลังบ้าน) จากนั้นต้องต่ออายุ
// ════════════════════════════════════════════════════════════════════

const DAY_MS = 86_400_000;
/** ลูกค้า 1 คนมีสลิปรอตรวจได้พร้อมกันกี่ใบ (กันกดส่งซ้ำรัวๆ) */
const MAX_PENDING_SLIPS = 3;

export type AccessReason = 'ADMIN' | 'ACTIVE' | 'GRACE' | 'NONE' | 'EXPIRED' | 'SUSPENDED';

export type Access = {
  /** ใช้ระบบตัวจริงได้ไหม */
  active: boolean;
  reason: AccessReason;
  lifetime: boolean;
  planName: string | null;
  /** วันหมดอายุจริง (ยังไม่รวมช่วงผ่อนผัน) — null ถ้าซื้อขาด/ไม่เคยมีสิทธิ์ */
  expiresAt: Date | null;
  /** ใช้ต่อได้ถึงวันไหน (หมดอายุ + ผ่อนผัน) */
  graceUntil: Date | null;
  /** เหลืออีกกี่วันก่อนหมดอายุ (ปัดขึ้น) */
  daysLeft: number | null;
  pendingSlips: number;
};

type SubLike = {
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  plan: { name: string } | null;
};

/** วันหมดอายุที่มีผลจริงของสิทธิ์ทั้งหมด (สิทธิ์ที่ต่ออายุล่วงหน้าจะเริ่มต่อจากของเดิมพอดี) */
function effectiveExpiry(subs: SubLike[], now: Date): { expiry: Date | null; lifetime: boolean; last: SubLike | null } {
  const valid = subs.filter((s) => !s.revokedAt).sort((a, b) => +a.startsAt - +b.startsAt);
  const started = valid.filter((s) => s.startsAt <= now);
  const lifetime = started.find((s) => s.expiresAt == null) ?? null;
  if (lifetime) return { expiry: null, lifetime: true, last: lifetime };

  let expiry: Date | null = null;
  let last: SubLike | null = null;
  for (const s of started) {
    if (s.expiresAt && (!expiry || s.expiresAt > expiry)) {
      expiry = s.expiresAt;
      last = s;
    }
  }
  // สิทธิ์ที่ซื้อเพิ่มล่วงหน้า (เริ่มตอนของเดิมหมด) ต่อกันเป็นสายเดียว
  for (const s of valid.filter((v) => v.startsAt > now)) {
    if (expiry && s.startsAt <= expiry) {
      if (s.expiresAt == null) return { expiry: null, lifetime: true, last: s };
      if (s.expiresAt > expiry) {
        expiry = s.expiresAt;
        last = s;
      }
    }
  }
  return { expiry, lifetime: false, last };
}

/** คำนวณสิทธิ์จากข้อมูลที่โหลดมาแล้ว (ใช้ทั้งตอนเช็คทีละคน และหน้ารายชื่อผู้ใช้ในหลังบ้าน) */
export function computeAccess(
  user: { role: Role; active: boolean },
  subs: SubLike[],
  pendingSlips: number,
  graceDays: number,
  now = new Date(),
): Access {
  const base = { pendingSlips, lifetime: false, planName: null, expiresAt: null, graceUntil: null, daysLeft: null };
  if (!user.active) return { ...base, active: false, reason: 'SUSPENDED' };
  if (user.role === 'ADMIN') return { ...base, active: true, reason: 'ADMIN', lifetime: true };

  const { expiry, lifetime, last } = effectiveExpiry(subs, now);
  const planName = last?.plan?.name ?? (last ? 'สิทธิ์จากแอดมิน' : null);
  if (lifetime) return { ...base, active: true, reason: 'ACTIVE', lifetime: true, planName };
  if (!expiry) return { ...base, active: false, reason: subs.length ? 'EXPIRED' : 'NONE' };

  const graceUntil = new Date(+expiry + graceDays * DAY_MS);
  const daysLeft = Math.ceil((+expiry - +now) / DAY_MS);
  if (now < expiry) return { ...base, active: true, reason: 'ACTIVE', planName, expiresAt: expiry, graceUntil, daysLeft };
  if (now < graceUntil) return { ...base, active: true, reason: 'GRACE', planName, expiresAt: expiry, graceUntil, daysLeft };
  return { ...base, active: false, reason: 'EXPIRED', planName, expiresAt: expiry, graceUntil, daysLeft };
}

const SUB_SELECT = {
  startsAt: true,
  expiresAt: true,
  revokedAt: true,
  plan: { select: { name: true } },
} satisfies Prisma.SubscriptionSelect;

// ทุก request ใต้ requireActiveSubscription เรียกตัวนี้ → cache สั้นๆ ต่อคน
const accessCache = new Map<number, { at: number; access: Access }>();
const ACCESS_CACHE_MS = 30_000;

export function invalidateAccess(userId: number) {
  accessCache.delete(userId);
}

export async function getAccess(userId: number, opts: { fresh?: boolean } = {}): Promise<Access> {
  const hit = accessCache.get(userId);
  if (!opts.fresh && hit && Date.now() - hit.at < ACCESS_CACHE_MS) return hit.access;

  const [user, subs, pendingSlips, shop] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, active: true } }),
    prisma.subscription.findMany({ where: { userId }, select: SUB_SELECT }),
    prisma.paymentSlip.count({ where: { userId, status: 'PENDING' } }),
    getShopSettings(),
  ]);
  if (!user) throw new AppError(401, 'ไม่พบผู้ใช้');
  const access = computeAccess(user, subs, pendingSlips, shop.graceDays);
  accessCache.set(userId, { at: Date.now(), access });
  return access;
}

// ── แพ็กเกจ ───────────────────────────────────────────────────────────

export function listActivePlans() {
  return prisma.plan.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
}

export function listAllPlans() {
  return prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
}

export type PlanInput = {
  code: string;
  name: string;
  description?: string | null;
  priceTHB: number;
  durationDays?: number | null;
  active?: boolean;
  sortOrder?: number;
};

export async function createPlan(input: PlanInput) {
  const code = input.code.trim().toUpperCase();
  if (await prisma.plan.findUnique({ where: { code } })) throw badRequest('รหัสแพ็กเกจนี้มีอยู่แล้ว');
  return prisma.plan.create({ data: { ...input, code } });
}

export async function updatePlan(id: number, input: Partial<PlanInput>) {
  if (!(await prisma.plan.findUnique({ where: { id } }))) throw notFound('ไม่พบแพ็กเกจ');
  const data = { ...input, ...(input.code ? { code: input.code.trim().toUpperCase() } : {}) };
  return prisma.plan.update({ where: { id }, data });
}

/** ลบได้เฉพาะแพ็กเกจที่ยังไม่มีใครใช้ — ที่เคยใช้แล้วให้ปิด (active=false) แทน */
export async function deletePlan(id: number) {
  const used = await prisma.subscription.count({ where: { planId: id } });
  const slips = await prisma.paymentSlip.count({ where: { planId: id } });
  if (used || slips) throw badRequest('แพ็กเกจนี้มีลูกค้าใช้แล้ว ลบไม่ได้ ปิดการขายแทนได้');
  await prisma.plan.delete({ where: { id } });
}

// ── สลิปของลูกค้า ─────────────────────────────────────────────────────

export async function createSlip(
  userId: number,
  input: { planId: number; amount?: number; imageUrl: string; imagePublicId?: string | null; note?: string | null },
) {
  const plan = await prisma.plan.findUnique({ where: { id: input.planId } });
  if (!plan || !plan.active) throw badRequest('ไม่พบแพ็กเกจนี้ หรือปิดการขายไปแล้ว');
  const slip = await prisma.$transaction(async (tx) => {
    // ล็อกแถวผู้ใช้ → ส่ง 2 ใบพร้อมกันเข้าคิว ใบที่ 2 เจอเงื่อนไขด้านล่าง
    await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${userId} FOR UPDATE`;
    const pending = await tx.paymentSlip.count({ where: { userId, status: 'PENDING' } });
    if (pending >= MAX_PENDING_SLIPS) throw badRequest('มีสลิปรอตรวจอยู่แล้ว กรุณารอแอดมินตรวจก่อน');
    // กดส่งซ้ำ (เจอจริง: 2 ใบห่างกัน 1 วิ) → ใบที่ 2 ภายใน 1 นาทีไม่รับ
    const recent = await tx.paymentSlip.count({ where: { userId, status: 'PENDING', createdAt: { gte: new Date(Date.now() - 60_000) } } });
    if (recent) throw badRequest('ส่งสลิปไปแล้ว รอแอดมินตรวจสักครู่');
    return tx.paymentSlip.create({
      data: {
        userId,
        planId: plan.id,
        amount: input.amount ?? plan.priceTHB,
        imageUrl: input.imageUrl,
        imagePublicId: input.imagePublicId ?? null,
        note: input.note ?? null,
      },
      include: { plan: true },
    });
  });
  invalidateAccess(userId);
  void notifyAdminsNewSlip(slip.id).catch((err) => console.error('แจ้งแอดมินสลิปใหม่ไม่สำเร็จ:', err));
  return slip;
}

/** ลูกค้าส่งสลิปใหม่ → อีเมลหาแอดมินทุกคน (notifyEmail ก่อน ไม่มีใช้อีเมลล็อกอิน) · ส่งไม่ได้ก็ไม่กระทบการส่งสลิป */
async function notifyAdminsNewSlip(slipId: number) {
  const [slip, admins] = await Promise.all([
    prisma.paymentSlip.findUnique({
      where: { id: slipId },
      select: { amount: true, note: true, imageUrl: true, createdAt: true, plan: { select: { name: true, priceTHB: true } }, user: { select: { name: true, email: true } } },
    }),
    prisma.user.findMany({ where: { role: 'ADMIN', active: true }, select: { email: true, notifyEmail: true } }),
  ]);
  if (!slip) return;
  const to = [...new Set(admins.map(contactEmail).filter((e): e is string => !!e))];
  if (!to.length) return;
  const amount = slip.amount.toNumber().toLocaleString('th-TH');
  const who = slip.user.name ? `${slip.user.name} (${slip.user.email})` : slip.user.email;
  const mismatch = slip.amount.toNumber() !== slip.plan.priceTHB.toNumber();
  const link = `${env.FRONTEND_URL.replace(/\/$/, '')}/admin/slips`;
  const row = (k: string, v: string) =>
    `<tr><td style="padding:6px 10px;color:#64748b;white-space:nowrap;">${k}</td><td style="padding:6px 10px;color:#0f172a;font-weight:600;">${v}</td></tr>`;
  const html = `
    <p style="font-size:16px;color:#334155;margin:0 0 12px;">มีลูกค้าส่งสลิปเข้ามา รอคุณตรวจ</p>
    <table style="border-collapse:collapse;font-size:15px;margin-bottom:14px;">
      ${row('ลูกค้า', escapeHtml(who))}
      ${row('แพ็กเกจ', escapeHtml(slip.plan.name))}
      ${row('ยอด', `฿${amount}${mismatch ? ' <span style="color:#d97706;">(ไม่ตรงราคาแพ็กเกจ)</span>' : ''}`)}
      ${slip.note ? row('ข้อความ', escapeHtml(slip.note)) : ''}
    </table>
    <p style="margin:0 0 16px;"><img src="${escapeHtml(slip.imageUrl)}" alt="สลิป" style="max-width:100%;max-height:420px;border-radius:10px;border:1px solid #e2e8f0;" /></p>
    <p style="text-align:center;margin:0;">
      <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#0d9488;color:#ffffff;text-decoration:none;font-weight:600;">เปิดหน้าตรวจสลิป</a>
    </p>`;
  await sendHtmlEmail({
    to: to.join(', '),
    subject: `💰 สลิปใหม่ ฿${amount} · ${slip.user.name ?? slip.user.email}`,
    heading: 'สลิปใหม่รอตรวจ',
    html,
    footer: 'ส่งถึงแอดมินทุกครั้งที่ลูกค้าส่งสลิป',
  });
}

export function listMySlips(userId: number) {
  return prisma.paymentSlip.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { plan: { select: { id: true, name: true } } },
  });
}

export async function getMyBilling(userId: number) {
  const [access, slips, subscriptions] = await Promise.all([
    getAccess(userId, { fresh: true }),
    listMySlips(userId),
    prisma.subscription.findMany({
      where: { userId },
      orderBy: { startsAt: 'desc' },
      take: 20,
      include: { plan: { select: { name: true } } },
    }),
  ]);
  return { access, slips, subscriptions };
}

// ── หลังบ้าน: ให้สิทธิ์ / อนุมัติสลิป ────────────────────────────────────

type Tx = Prisma.TransactionClient;

export type GrantInput = {
  planId?: number | null;
  /** ให้เองแบบกำหนดวัน (ใช้เมื่อไม่ระบุแพ็กเกจ เช่น ทดลองใช้ 7 วัน) */
  days?: number | null;
  /** ให้แบบไม่หมดอายุ (ไม่ผูกแพ็กเกจ) */
  lifetime?: boolean;
  source: SubscriptionSource;
  note?: string | null;
  grantedById: number;
  slipId?: number | null;
};

async function grantInTx(tx: Tx, userId: number, input: GrantInput) {
  const plan = input.planId ? await tx.plan.findUnique({ where: { id: input.planId } }) : null;
  if (input.planId && !plan) throw notFound('ไม่พบแพ็กเกจ');

  const lifetime = input.lifetime || (plan != null && plan.durationDays == null);
  const days = plan?.durationDays ?? input.days ?? null;
  if (!lifetime && (!days || days <= 0)) throw badRequest('ต้องระบุแพ็กเกจ หรือจำนวนวัน');

  const now = new Date();
  let startsAt = now;
  if (!lifetime) {
    // ยังมีสิทธิ์อยู่ → เริ่มนับต่อจากวันหมดอายุเดิม
    const subs = await tx.subscription.findMany({ where: { userId }, select: SUB_SELECT });
    const { expiry } = effectiveExpiry(subs, now);
    if (expiry && expiry > now) startsAt = expiry;
  }
  const expiresAt = lifetime ? null : new Date(+startsAt + days! * DAY_MS);

  return tx.subscription.create({
    data: {
      userId,
      planId: plan?.id ?? null,
      startsAt,
      expiresAt,
      source: input.source,
      note: input.note ?? null,
      grantedById: input.grantedById,
      slipId: input.slipId ?? null,
    },
    include: { plan: { select: { name: true } } },
  });
}

export async function grantSubscription(userId: number, input: GrantInput) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw notFound('ไม่พบผู้ใช้');
  const sub = await prisma.$transaction((tx) => grantInTx(tx, userId, input));
  invalidateAccess(userId);
  return sub;
}

export async function revokeSubscription(id: number) {
  const sub = await prisma.subscription.findUnique({ where: { id } });
  if (!sub) throw notFound('ไม่พบสิทธิ์นี้');
  if (sub.revokedAt) return sub;
  const updated = await prisma.subscription.update({ where: { id }, data: { revokedAt: new Date() } });
  invalidateAccess(sub.userId);
  return updated;
}

export function listSlips(filter: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; skip?: number; take?: number }) {
  const where: Prisma.PaymentSlipWhereInput = filter.status ? { status: filter.status } : {};
  return prisma.$transaction([
    prisma.paymentSlip.findMany({
      where,
      // รอตรวจ: เก่าสุดก่อน (คิว) · ที่ตรวจแล้ว: ใหม่สุดก่อน
      orderBy: { createdAt: filter.status === 'PENDING' ? 'asc' : 'desc' },
      skip: filter.skip ?? 0,
      take: filter.take ?? 20,
      include: {
        user: { select: { id: true, email: true, name: true, avatarUrl: true } },
        plan: { select: { id: true, name: true, priceTHB: true, durationDays: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.paymentSlip.count({ where }),
  ]);
}

/** อีเมลที่ใช้ติดต่อลูกค้าได้จริง (อีเมลเทียมของ LINE/Facebook ส่งไม่ได้) */
const contactEmail = (u: { email: string; notifyEmail: string | null }) =>
  u.notifyEmail || (u.email.endsWith('@oauth.local') ? null : u.email);

export async function approveSlip(id: number, adminId: number, note?: string | null) {
  const result = await prisma.$transaction(async (tx) => {
    // เปลี่ยนสถานะแบบมีเงื่อนไข → แอดมิน 2 คน/2 แท็บกดพร้อมกัน ได้สิทธิ์แค่ครั้งเดียว
    const changed = await tx.paymentSlip.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', reviewedById: adminId, reviewedAt: new Date(), reviewNote: note ?? null },
    });
    if (changed.count !== 1) throw badRequest('สลิปนี้ถูกตรวจไปแล้ว');
    const slip = await tx.paymentSlip.findUniqueOrThrow({ where: { id } });
    const sub = await grantInTx(tx, slip.userId, {
      planId: slip.planId,
      source: 'SLIP',
      grantedById: adminId,
      slipId: slip.id,
    });
    return { slip, sub };
  });
  invalidateAccess(result.slip.userId);

  // แจ้งลูกค้า (ส่งไม่สำเร็จก็ไม่เป็นไร สิทธิ์เปิดไปแล้ว)
  void (async () => {
    const user = await prisma.user.findUnique({ where: { id: result.slip.userId } });
    const to = user && contactEmail(user);
    if (!to) return;
    const until = result.sub.expiresAt
      ? `ใช้ได้ถึง ${result.sub.expiresAt.toLocaleDateString('th-TH', { dateStyle: 'long' })}`
      : 'ใช้ได้ตลอดไป';
    await sendNotificationEmail({
      to,
      subject: 'เปิดใช้งานระบบจัดการปูแล้ว 🎉',
      heading: 'เปิดใช้งานแล้ว',
      content: `ได้รับการชำระเงินแล้ว (${result.sub.plan?.name ?? 'แพ็กเกจ'})\n${until}\n\nเข้าใช้งานได้ทันทีครับ`,
    });
  })().catch(() => undefined);

  return result.sub;
}

export async function rejectSlip(id: number, adminId: number, reason: string) {
  const changed = await prisma.paymentSlip.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'REJECTED', reviewedById: adminId, reviewedAt: new Date(), reviewNote: reason },
  });
  if (changed.count !== 1) throw badRequest('สลิปนี้ถูกตรวจไปแล้ว');
  const slip = await prisma.paymentSlip.findUniqueOrThrow({ where: { id }, include: { user: true } });
  invalidateAccess(slip.userId);

  void (async () => {
    const to = contactEmail(slip.user);
    if (!to) return;
    await sendNotificationEmail({
      to,
      subject: 'สลิปยังตรวจไม่ผ่าน',
      heading: 'ตรวจสลิปไม่ผ่าน',
      content: `เหตุผล: ${reason}\n\nเข้าระบบแล้วอัปสลิปใหม่ได้เลย หรือทักแอดมินได้ครับ`,
    });
  })().catch(() => undefined);

  return slip;
}

// ── หลังบ้าน: รายชื่อผู้ใช้ ─────────────────────────────────────────────

export const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  avatarUrl: true,
  active: true,
  notifyEmail: true,
  lastLoginAt: true,
  createdAt: true,
  oauthAccounts: { select: { provider: true } },
} satisfies Prisma.UserSelect;

export type UserListFilter = {
  q?: string;
  access?: 'active' | 'none' | 'expired' | 'pending';
  skip?: number;
  take?: number;
};

export async function listUsers(filter: UserListFilter) {
  const where: Prisma.UserWhereInput = filter.q
    ? { OR: [{ email: { contains: filter.q } }, { name: { contains: filter.q } }] }
    : {};
  const [users, shop] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        ...ADMIN_USER_SELECT,
        subscriptions: { select: SUB_SELECT },
        _count: { select: { paymentSlips: { where: { status: 'PENDING' } } } },
      },
    }),
    getShopSettings(),
  ]);

  const rows = users.map(({ subscriptions, _count, ...u }) => ({
    ...u,
    access: computeAccess(u, subscriptions, _count.paymentSlips, shop.graceDays),
  }));
  const filtered = rows.filter((r) => {
    switch (filter.access) {
      case 'active':
        return r.access.active;
      case 'none':
        return r.access.reason === 'NONE';
      case 'expired':
        return r.access.reason === 'EXPIRED';
      case 'pending':
        return r.access.pendingSlips > 0;
      default:
        return true;
    }
  });
  const skip = filter.skip ?? 0;
  const take = filter.take ?? 20;
  return { total: filtered.length, items: filtered.slice(skip, skip + take) };
}

export async function getUserDetail(id: number) {
  const user = await prisma.user.findUnique({ where: { id }, select: ADMIN_USER_SELECT });
  if (!user) throw notFound('ไม่พบผู้ใช้');
  const [access, subscriptions, slips] = await Promise.all([
    getAccess(id, { fresh: true }),
    prisma.subscription.findMany({
      where: { userId: id },
      orderBy: { startsAt: 'desc' },
      include: {
        plan: { select: { name: true } },
        grantedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.paymentSlip.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      include: { plan: { select: { name: true } } },
    }),
  ]);
  return { user, access, subscriptions, slips };
}

export async function updateUserByAdmin(
  adminId: number,
  id: number,
  input: { active?: boolean; role?: Role; name?: string | null },
) {
  if (id === adminId && (input.active === false || input.role === 'USER')) {
    throw badRequest('ระงับหรือลดสิทธิ์บัญชีตัวเองไม่ได้');
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('ไม่พบผู้ใช้');
  const updated = await prisma.user.update({ where: { id }, data: input, select: ADMIN_USER_SELECT });
  if (input.active === false) {
    // ระงับ = เตะออกจากทุกเครื่อง (refresh ไม่ได้อีก)
    await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  invalidateAccess(id);
  return updated;
}

export async function adminOverview() {
  const now = new Date();
  const weekAgo = new Date(+now - 7 * DAY_MS);
  const [users, totalUsers, newUsers, pendingSlips] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'USER' },
      select: { role: true, active: true, subscriptions: { select: SUB_SELECT } },
    }),
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.paymentSlip.count({ where: { status: 'PENDING' } }),
  ]);
  const shop = await getShopSettings();
  let activeCustomers = 0;
  let expiringSoon = 0;
  let waiting = 0;
  for (const u of users) {
    const a = computeAccess(u, u.subscriptions, 0, shop.graceDays, now);
    if (a.active) activeCustomers++;
    if (a.active && !a.lifetime && a.daysLeft != null && a.daysLeft <= 7) expiringSoon++;
    if (a.reason === 'NONE') waiting++;
  }
  return { totalUsers, newUsers, activeCustomers, expiringSoon, waiting, pendingSlips };
}
