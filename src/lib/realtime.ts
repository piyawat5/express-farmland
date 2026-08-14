import type { IncomingMessage, Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { env, isProd } from '../config/env';
import { prisma } from './prisma';
import { serialize } from './serialize';
import { canViewFarm, ownedSystemIds } from './scope';
import { verifyAccessToken, type AuthUser } from '../services/auth.service';

// ════════════════════════════════════════════════════════════════════
//  Realtime (WebSocket) — Phase 21
//
//  ใช้ทำอะไร: ตอนแบ่งกันบันทึกการกินปู 2 คนคนละเครื่อง ทั้งคู่ต้องเห็น
//  ตัวนับ "บันทึกแล้ว X / N" ขยับพร้อมกัน และเห็นพลุฉลองพร้อมกันตอนตัวสุดท้าย
//
//  ออกแบบให้เป็น "ของแถม" ไม่ใช่ของจำเป็น:
//   - publish() เป็น no-op ถ้าไม่ได้เปิด/ยังไม่ init → service เรียกได้เสมอ
//   - payload ที่ push = snapshot เต็ม ก้อนเดียวกับที่ REST คืน
//     → หลุดไปกี่ข้อความ client ก็ self-heal ได้ และถอยไป polling ได้โดยไม่ต้องแก้ server
//
//  โมดูลนี้เป็น leaf: server.ts เรียก init/close, service เรียกแค่ publish → ไม่เกิด import cycle
// ════════════════════════════════════════════════════════════════════

export type Facing = 'u' | 'd' | 'l' | 'r';

/** ข้อมูลตัวละคร 1 คนที่กำลังอยู่ในฟาร์ม (in-memory ล้วน — ไม่แตะ DB) */
export type PresenceUser = {
  userId: number;
  name: string | null;
  avatarUrl: string | null;
  farmAvatar: unknown;
  x: number;
  y: number;
  f: Facing;
};

type Profile = { name: string | null; avatarUrl: string | null; farmAvatar: unknown };

type Client = WebSocket & {
  user?: AuthUser;
  allowed?: number[] | null; // null = ADMIN (ทุกระบบ)
  rooms?: Set<number>; // systemId ที่ subscribe อยู่ (ห้องข้อมูล เช่น รอบให้อาหาร)
  isAlive?: boolean;

  // ── หมู่บ้านฟาร์ม (Phase 23) ──
  // ⚠️ farmRooms แยกจาก rooms โดยตั้งใจ: rooms ส่ง feeding.* ที่มี snapshot รอบเต็ม
  // (รหัสปู/โน้ต/คะแนนรายตัว/ชื่อคนบันทึก) — แขกที่เดินเข้ามาชมต้องไม่ได้รับข้อมูลนั้น
  // อีกอย่าง: allowed เป็นสิทธิ์ static (ความเป็นเจ้าของไม่เปลี่ยนกลางคัน) แต่สิทธิ์เยี่ยมชม
  // ถูกถอนได้ตลอด — เอามาผสมกันคือต้นเหตุของปัญหา "จะ invalidate ยังไง"
  farmRooms?: Set<number>;
  profile?: Profile; // ชื่อ/รูป/หน้าตาตัวละคร (โหลดครั้งเดียวตอนต่อ)
  pos?: { x: number; y: number; f: Facing };
  lastMoveAt?: number; // rate limit ของ village.move
};

export type ServerEvent =
  | { t: 'hello'; userId: number; serverTime: string }
  | { t: 'subscribed'; systemId: number }
  | { t: 'unsubscribed'; systemId: number }
  | { t: 'feeding.opened'; systemId: number; round: unknown }
  | { t: 'feeding.progress'; systemId: number; round: unknown }
  | { t: 'feeding.completed'; systemId: number; round: unknown }
  // ── หมู่บ้านฟาร์ม (Phase 23) ──
  | { t: 'village.entered'; systemId: number; peers: PresenceUser[]; me: PresenceUser }
  | { t: 'village.join'; systemId: number; peer: PresenceUser }
  | { t: 'village.leave'; systemId: number; userId: number }
  | { t: 'village.move'; systemId: number; userId: number; x: number; y: number; f: Facing }
  | { t: 'village.emote'; systemId: number; userId: number; emote: string }
  // 2 ตัวนี้เป็นแค่ "เคาะ" ไม่ใส่ payload → ให้ client ไป GET ใหม่
  // (ปรัชญา self-heal เดียวกับ feeding + กันชน maxPayload 16KB ตอนผังตกแต่งมี 300 ชิ้น)
  | { t: 'village.letter'; systemId: number }
  | { t: 'village.decor'; systemId: number }
  | { t: 'village.request'; access: unknown }
  | { t: 'village.access'; ownerId: number; systemIds: number[]; granted: boolean }
  | { t: 'pong' }
  | { t: 'error'; message: string };

/** ขนาดโลกสูงสุด (ช่องตาราง) — ต้องตรงกับ zod ฝั่ง REST */
const MAX_TILE = 200;
/** ทิ้ง village.move ที่มาถี่กว่านี้ (client ส่ง 10 Hz; เผื่อ jitter นิดหน่อย) */
const MOVE_MIN_MS = 80;

let wss: WebSocketServer | null = null;
let beat: NodeJS.Timeout | null = null;

function send(ws: WebSocket, event: ServerEvent) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(serialize(event)));
}

/**
 * ดึง access token จาก handshake
 * ทางหลัก = WebSocket subprotocol `['jwt', <token>]` เพราะ browser WebSocket ตั้ง
 * Authorization header ไม่ได้ และ subprotocol ไม่ไปโผล่ใน access log เหมือน query string
 */
function tokenFrom(req: IncomingMessage): string | null {
  const raw = req.headers['sec-websocket-protocol'];
  if (typeof raw === 'string') {
    const parts = raw.split(',').map((s) => s.trim());
    if (parts[0] === 'jwt' && parts[1]) return parts[1];
  }
  const q = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token');
  return q || null; // fallback สำหรับ debug ด้วย curl/wscat
}

export function initRealtime(server: Server): void {
  if (!env.REALTIME_ENABLED || wss) return;

  wss = new WebSocketServer({
    server,
    path: env.WS_PATH,
    maxPayload: 16 * 1024,
    // ต้องตอบ subprotocol กลับ ไม่งั้นเบราว์เซอร์จะตัดการเชื่อมต่อทันที
    handleProtocols: (protocols) => (protocols.has('jwt') ? 'jwt' : false),
  });

  wss.on('connection', (socket, req) => {
    const ws = socket as Client;
    ws.rooms = new Set();
    ws.farmRooms = new Set();
    ws.isAlive = true;

    // WS handshake ข้าม CORS ทั้งหมด → origin check เป็นด่านเดียวที่มี
    if (isProd && req.headers.origin && !req.headers.origin.startsWith(env.FRONTEND_URL)) {
      ws.close(4403, 'forbidden origin');
      return;
    }

    const token = tokenFrom(req);
    if (!token) {
      ws.close(4401, 'unauthorized');
      return;
    }
    try {
      ws.user = verifyAccessToken(token);
    } catch {
      // 4401 = สัญญากับ client: ให้ refresh token แล้วต่อใหม่ 1 ครั้ง (ซ้ำอีก = logout)
      ws.close(4401, 'unauthorized');
      return;
    }

    // resolve สิทธิ์ (ห้องข้อมูล) + โปรไฟล์ตัวละคร ครั้งเดียวตอนต่อ — ไม่ query ทุกข้อความ
    void Promise.all([
      ownedSystemIds(ws.user),
      prisma.user.findUnique({
        where: { id: ws.user.id },
        select: { name: true, avatarUrl: true, farmAvatar: true },
      }),
    ])
      .then(([ids, profile]) => {
        ws.allowed = ids;
        ws.profile = profile ?? { name: null, avatarUrl: null, farmAvatar: null };
        send(ws, { t: 'hello', userId: ws.user!.id, serverTime: new Date().toISOString() });
      })
      .catch(() => ws.close(1011, 'server error'));

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // ออกจากห้องหมู่บ้าน = ประกาศให้คนที่เหลือรู้ว่าเดินออกไปแล้ว
    // ไม่ต้องเก็บกวาด registry อะไร เพราะ socket ที่ปิดหลุดจาก wss.clients เอง
    ws.on('close', () => {
      if (!ws.user || !ws.farmRooms?.size) return;
      for (const id of ws.farmRooms) {
        publishFarm(id, { t: 'village.leave', systemId: id, userId: ws.user.id }, ws);
      }
      ws.farmRooms.clear();
    });

    ws.on('message', (raw) => {
      let msg: { t?: string; systemId?: number; x?: number; y?: number; f?: string; emote?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return; // ข้อความมั่ว = เงียบ
      }
      if (msg.t === 'ping') return send(ws, { t: 'pong' });

      const id = Number(msg.systemId);
      if (!Number.isFinite(id)) return;

      // ── ห้องข้อมูล (รอบให้อาหาร) — สิทธิ์ static จาก ownedSystemIds ตอนต่อ ──
      if (msg.t === 'subscribe' || msg.t === 'unsubscribe') {
        if (msg.t === 'unsubscribe') {
          ws.rooms!.delete(id);
          return send(ws, { t: 'unsubscribed', systemId: id });
        }
        if (ws.allowed !== null && ws.allowed !== undefined && !ws.allowed.includes(id)) {
          return send(ws, { t: 'error', message: 'ไม่มีสิทธิ์เข้าถึงระบบนี้' });
        }
        ws.rooms!.add(id);
        return send(ws, { t: 'subscribed', systemId: id });
      }

      // ── ห้องหมู่บ้าน (เดินเล่น) — สิทธิ์เช็ค "ที่ประตู" ครั้งเดียวตอน enter ──
      if (msg.t === 'village.enter') return void handleVillageEnter(ws, id, msg);
      if (msg.t === 'village.leave') return handleVillageLeave(ws, id);
      if (msg.t === 'village.move') return handleVillageMove(ws, id, msg);
      if (msg.t === 'village.emote') {
        if (!ws.user || !ws.farmRooms?.has(id)) return;
        const emote = String(msg.emote ?? '').slice(0, 16);
        if (!emote) return;
        return publishFarm(id, { t: 'village.emote', systemId: id, userId: ws.user.id, emote });
      }
      // ข้อความอื่น = เงียบ (คอนเวนชันเดิมของโมดูลนี้)
    });
  });

  // heartbeat: กัน nginx ตัดสายที่เงียบ + เก็บกวาด socket ที่ตายแล้ว (half-open)
  beat = setInterval(() => {
    wss?.clients.forEach((c) => {
      const ws = c as Client;
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, env.WS_HEARTBEAT_SEC * 1000);
  beat.unref(); // อย่าให้ interval กันโปรเซสไม่ให้จบ

  // eslint-disable-next-line no-console
  console.log(`🔌 realtime (WebSocket) พร้อมใช้งานที่ ${env.WS_PATH}`);
}

// ════════════════════════════════════════════════════════════════════
//  หมู่บ้านฟาร์ม — handler ของข้อความจาก client
// ════════════════════════════════════════════════════════════════════

const clamp = (v: number) => Math.min(MAX_TILE, Math.max(0, v));
const isFacing = (v: unknown): v is Facing => v === 'u' || v === 'd' || v === 'l' || v === 'r';

function presenceOf(ws: Client): PresenceUser {
  return {
    userId: ws.user!.id,
    name: ws.profile?.name ?? null,
    avatarUrl: ws.profile?.avatarUrl ?? null,
    farmAvatar: ws.profile?.farmAvatar ?? null,
    x: ws.pos?.x ?? 0,
    y: ws.pos?.y ?? 0,
    f: ws.pos?.f ?? 'd',
  };
}

/**
 * เข้าฟาร์ม — จุดเดียวที่ query สิทธิ์ (1 ครั้ง ตอนคนกดเข้าฟาร์มซึ่งนาน ๆ ที)
 * หลังจากนี้ village.move (10 Hz) เช็คแค่ farmRooms.has() ใน memory ไม่มี query เลย
 *
 * คนที่ "เพิ่งได้รับอนุมัติ" ไม่ต้อง patch state ฝั่ง server เลย — เขาจะกดเข้ามาใหม่
 * แล้ว query สดตรงนี้ → ข้อมูลสิทธิ์ค้างเป็นไปไม่ได้เชิงโครงสร้าง
 */
async function handleVillageEnter(
  ws: Client,
  systemId: number,
  msg: { x?: number; y?: number; f?: string },
): Promise<void> {
  if (!ws.user) return;
  try {
    if (!(await canViewFarm(ws.user, systemId))) {
      return send(ws, { t: 'error', message: 'ยังไม่ได้รับอนุญาตให้เข้าชมฟาร์มนี้' });
    }
  } catch {
    return send(ws, { t: 'error', message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ' });
  }
  if (ws.readyState !== WebSocket.OPEN) return; // ปิดไประหว่างรอ query

  ws.pos = {
    x: clamp(Number(msg.x) || 0),
    y: clamp(Number(msg.y) || 0),
    f: isFacing(msg.f) ? msg.f : 'd',
  };
  ws.farmRooms!.add(systemId);

  const peers: PresenceUser[] = [];
  wss?.clients.forEach((c) => {
    const other = c as Client;
    if (other === ws || other.readyState !== WebSocket.OPEN) return;
    if (other.user && other.farmRooms?.has(systemId)) peers.push(presenceOf(other));
  });

  const me = presenceOf(ws);
  send(ws, { t: 'village.entered', systemId, peers, me });
  publishFarm(systemId, { t: 'village.join', systemId, peer: me }, ws);
}

function handleVillageLeave(ws: Client, systemId: number): void {
  if (!ws.user || !ws.farmRooms?.delete(systemId)) return;
  publishFarm(systemId, { t: 'village.leave', systemId, userId: ws.user.id }, ws);
}

function handleVillageMove(
  ws: Client,
  systemId: number,
  msg: { x?: number; y?: number; f?: string },
): void {
  if (!ws.user || !ws.farmRooms?.has(systemId)) return;
  const now = Date.now();
  if (ws.lastMoveAt && now - ws.lastMoveAt < MOVE_MIN_MS) return; // มาถี่เกิน = ทิ้งเงียบ
  ws.lastMoveAt = now;

  // ไม่เชื่อ client: clamp ขอบเขต + ปัดทศนิยม 1 ตำแหน่ง (พอสำหรับความลื่น, payload สั้น)
  const x = Math.round(clamp(Number(msg.x) || 0) * 10) / 10;
  const y = Math.round(clamp(Number(msg.y) || 0) * 10) / 10;
  const f = isFacing(msg.f) ? msg.f : (ws.pos?.f ?? 'd');
  ws.pos = { x, y, f };

  // ข้าม serialize() ตรงนี้โดยตั้งใจ — มันเดินทุก key เพื่อหา Decimal/Date ซึ่ง move ไม่มีเลย
  // และนี่คือ path เดียวในระบบที่วิ่ง 10 ครั้ง/วินาที/คน
  const payload = `{"t":"village.move","systemId":${systemId},"userId":${ws.user.id},"x":${x},"y":${y},"f":"${f}"}`;
  broadcast(payload, (c) => !!c.farmRooms?.has(systemId), ws);
}

// ════════════════════════════════════════════════════════════════════
//  broadcast helpers
// ════════════════════════════════════════════════════════════════════

function broadcast(
  payload: string,
  inRoom: (ws: Client) => boolean,
  except?: WebSocket,
): void {
  if (!wss) return;
  wss.clients.forEach((c) => {
    const ws = c as Client;
    if (ws === except || ws.readyState !== WebSocket.OPEN) return;
    if (inRoom(ws)) ws.send(payload);
  });
}

/** ส่ง event ให้ทุกเครื่องที่ subscribe ระบบนี้อยู่ — no-op ถ้า realtime ปิด/ยังไม่ init */
export function publish(systemId: number, event: ServerEvent): void {
  if (!wss) return;
  broadcast(JSON.stringify(serialize(event)), (ws) => !!ws.rooms?.has(systemId));
}

/** ส่งให้ทุกคนที่กำลัง "เดินอยู่" ในฟาร์มนี้ — except = ไม่ echo กลับหาคนส่ง
 *  (ตำแหน่งตัวเองที่เด้งกลับมาจะตีกับ local prediction ของ client) */
export function publishFarm(systemId: number, event: ServerEvent, except?: WebSocket): void {
  if (!wss) return;
  broadcast(JSON.stringify(serialize(event)), (ws) => !!ws.farmRooms?.has(systemId), except);
}

/** ส่งถึง "ผู้ใช้คนหนึ่ง" ทุกเครื่องที่เปิดอยู่ ไม่ว่าเขาจะอยู่หน้าไหน
 *  → ตัวที่ทำให้ป๊อปอัพขอเข้าชมฟาร์มเด้งได้ทั่วทั้งแอป (ข้อ 1.4) */
export function publishToUser(userId: number, event: ServerEvent): void {
  if (!wss) return;
  broadcast(JSON.stringify(serialize(event)), (ws) => ws.user?.id === userId);
}

/**
 * โปรไฟล์ตัวละครเปลี่ยน (แต่งตัว / เปลี่ยนสัตว์ขี่ / เรียกสัตว์เลี้ยง) — ข้อ 8,10
 * ⚠️ ws.profile ถูก cache ไว้ครั้งเดียวตอนต่อ (จงใจ ไม่ query ทุกข้อความ) → ถ้าไม่อัปเดตตรงนี้
 *    คนที่ยืนอยู่ในฟาร์มเดียวกันจะเห็นชุดเก่าจนกว่าเราจะ reconnect
 * ส่งเป็น village.join เพราะฝั่ง client ทำ upsert รายคนอยู่แล้ว (ไม่ต้องเพิ่ม event ใหม่)
 */
export function refreshFarmProfile(userId: number, profile: Profile): void {
  if (!wss) return;
  wss.clients.forEach((c) => {
    const ws = c as Client;
    if (ws.user?.id !== userId) return;
    ws.profile = profile;
    if (!ws.farmRooms?.size) return;
    for (const id of ws.farmRooms) {
      publishFarm(id, { t: 'village.join', systemId: id, peer: presenceOf(ws) }, ws);
    }
  });
}

/** ใครกำลังเดินอยู่ในฟาร์มนี้บ้าง (REST fallback ตอน WS ใช้ไม่ได้) */
export function farmPresence(systemId: number): PresenceUser[] {
  const out: PresenceUser[] = [];
  wss?.clients.forEach((c) => {
    const ws = c as Client;
    if (ws.readyState === WebSocket.OPEN && ws.user && ws.farmRooms?.has(systemId)) {
      out.push(presenceOf(ws));
    }
  });
  return out;
}

/**
 * ถอนสิทธิ์แบบมีผลทันที — เตะ visitor ออกจากห้องฟาร์มของ owner เดี๋ยวนี้
 * (เคสเดียวที่ต้อง push เพราะแขกอาจกำลังยืนอยู่ในฟาร์มตอนเจ้าของกดถอน)
 */
export function revokeFarmAccess(visitorId: number, systemIds: number[], ownerId: number): void {
  if (!wss) return;
  wss.clients.forEach((c) => {
    const ws = c as Client;
    if (ws.user?.id !== visitorId || !ws.farmRooms?.size) return;
    for (const id of systemIds) {
      if (!ws.farmRooms.delete(id)) continue;
      publishFarm(id, { t: 'village.leave', systemId: id, userId: visitorId }, ws);
    }
    send(ws, { t: 'village.access', ownerId, systemIds, granted: false });
  });
}

/** เจ้าของปิดสวิตช์ "เปิดฟาร์มให้ทุกคน" → เตะคนที่เข้ามาได้เพราะสวิตช์นี้ออก
 *  (คนที่มี FarmAccess อนุมัติจริงยังอยู่ต่อได้ — เช็คสิทธิ์ใหม่รายคน) */
export function evictUnauthorizedVisitors(systemId: number): void {
  if (!wss) return;
  const targets: Client[] = [];
  wss.clients.forEach((c) => {
    const ws = c as Client;
    if (ws.user && ws.farmRooms?.has(systemId)) targets.push(ws);
  });
  for (const ws of targets) {
    void canViewFarm(ws.user!, systemId)
      .then((ok) => {
        if (ok || !ws.farmRooms?.delete(systemId)) return;
        publishFarm(systemId, { t: 'village.leave', systemId, userId: ws.user!.id }, ws);
        send(ws, { t: 'village.access', ownerId: 0, systemIds: [systemId], granted: false });
      })
      .catch(() => {
        /* เช็คไม่ได้ = ปล่อยไว้ (เดี๋ยว enter รอบหน้าจะโดนกันเอง) */
      });
  }
}

/** ปิด socket ทั้งหมด — ต้องเรียกก่อน server.close() ไม่งั้น close() ค้างจนโดน SIGKILL */
export async function closeRealtime(): Promise<void> {
  if (beat) {
    clearInterval(beat);
    beat = null;
  }
  if (!wss) return;
  for (const c of wss.clients) c.close(1001, 'server shutting down'); // 1001 = going away → client ต่อใหม่
  const server = wss;
  wss = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export const realtimeInfo = () => ({ enabled: env.REALTIME_ENABLED, path: env.WS_PATH });
