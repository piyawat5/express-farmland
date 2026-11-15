import type { IncomingMessage, Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { env, isProd } from '../config/env';
import { prisma } from './prisma';
import { verifyAccessToken, type AuthUser } from '../services/auth.service';
import { canViewFarm } from '../services/village/access';

// ════════════════════════════════════════════════════════════════════
//  Realtime (WebSocket) v2 — ซิงค์รอบให้อาหารหลายเครื่อง (P4) + หมู่บ้านฟาร์ม (P9)
//
//  ปรัชญาเดิมจาก v1 ("ของแถม" ไม่ใช่ของจำเป็น):
//   - publish*() เป็น no-op ถ้าไม่ได้เปิด → service เรียกได้เสมอ
//   - ข้อความข้อมูลเป็นแค่ "เคาะ" (feeding.changed / village.letter / village.decor) → client ไป GET ใหม่เอง
//     หลุดกี่ข้อความก็ไม่เพี้ยน และหน้าเว็บถอยไป polling ได้โดยไม่ต้องแก้ server
//  ห้อง 2 แบบ แยกกันโดยตั้งใจ (บทเรียน v1):
//   - rooms      = ห้องข้อมูลรอบให้อาหาร — เฉพาะเจ้าของ (สิทธิ์ไม่เปลี่ยนกลางคัน)
//   - farmRooms  = ห้องเดินเล่นในหมู่บ้าน — แขกเข้าได้ แต่สิทธิ์ถูกถอนได้ตลอด → เตะออกได้ทันที
//     แขกต้องไม่ได้ feeding.* (ไม่ผสมห้อง)
//  ⚠️ Plesk: โดเมน API ต้อง "ปิด" Proxy mode ไม่งั้น Apache ถอด header Upgrade (บทเรียน v1)
// ════════════════════════════════════════════════════════════════════

export type Facing = 'u' | 'd' | 'l' | 'r';

type Profile = { name: string | null; avatarUrl: string | null; farmAvatar: unknown };

/** ตัวละคร 1 คนที่อยู่ในฟาร์มตอนนี้ (หน่วยความจำล้วน — ไม่แตะ DB) */
export type PresenceUser = Profile & { userId: number; x: number; y: number; f: Facing };

type Client = WebSocket & {
  user?: AuthUser;
  allowed?: Set<number>;
  rooms?: Set<number>;
  isAlive?: boolean;
  // ── หมู่บ้าน ──
  farmRooms?: Set<number>;
  profile?: Profile;
  pos?: { x: number; y: number; f: Facing };
  lastMoveAt?: number;
};

export type ServerEvent =
  | { t: 'hello'; userId: number }
  | { t: 'subscribed'; systemId: number }
  | { t: 'feeding.changed'; systemId: number }
  | { t: 'village.entered'; systemId: number; peers: PresenceUser[] }
  | { t: 'village.join'; systemId: number; peer: PresenceUser }
  | { t: 'village.leave'; systemId: number; userId: number }
  | { t: 'village.emote'; systemId: number; userId: number; emote: string }
  | { t: 'village.letter'; systemId: number }
  | { t: 'village.decor'; systemId: number }
  /** สิทธิ์เข้าฟาร์มนี้ถูกถอน / ฟาร์มปิด → หน้าเว็บพาออก */
  | { t: 'village.kicked'; systemId: number }
  /** มีคนขอเข้าชม / มีจดหมายหรือคำตอบใหม่ → หน้าเว็บโหลด ⚠ ใหม่ */
  | { t: 'village.inbox' }
  | { t: 'pong' }
  | { t: 'error'; message: string };

/** ขอบโลกสูงสุด (ช่อง) — ต้องตรงกับ zod ฝั่ง REST */
const MAX_TILE = 200;
/** ทิ้ง village.move ที่มาถี่กว่านี้ (client ส่ง 10 Hz) */
const MOVE_MIN_MS = 80;

let wss: WebSocketServer | null = null;
let beat: NodeJS.Timeout | null = null;

function send(ws: WebSocket, event: ServerEvent) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
}

function broadcast(payload: string, inRoom: (ws: Client) => boolean, except?: WebSocket) {
  if (!wss) return;
  wss.clients.forEach((c) => {
    const ws = c as Client;
    if (ws === except || ws.readyState !== WebSocket.OPEN) return;
    if (inRoom(ws)) ws.send(payload);
  });
}

/** token ทาง subprotocol ['jwt', <token>] (เบราว์เซอร์ตั้ง Authorization header ใน WebSocket ไม่ได้) */
function tokenFrom(req: IncomingMessage): string | null {
  const raw = req.headers['sec-websocket-protocol'];
  if (typeof raw === 'string') {
    const parts = raw.split(',').map((s) => s.trim());
    if (parts[0] === 'jwt' && parts[1]) return parts[1];
  }
  return null;
}

type InMsg = { t?: string; systemId?: number; x?: number; y?: number; f?: string; emote?: string };

export function initRealtime(server: Server): void {
  if (!env.REALTIME_ENABLED || wss) return;
  wss = new WebSocketServer({
    server,
    path: env.WS_PATH,
    maxPayload: 4 * 1024,
    handleProtocols: (protocols) => (protocols.has('jwt') ? 'jwt' : false),
  });

  wss.on('connection', (socket, req) => {
    const ws = socket as Client;
    ws.rooms = new Set();
    ws.farmRooms = new Set();
    ws.isAlive = true;
    // WS handshake ข้าม CORS → origin check เป็นด่านเดียว
    if (isProd && req.headers.origin && !req.headers.origin.startsWith(env.FRONTEND_URL)) return ws.close(4403, 'forbidden origin');
    const token = tokenFrom(req);
    try {
      if (!token) throw new Error('no token');
      ws.user = verifyAccessToken(token);
    } catch {
      // 4401 = ให้ client refresh token แล้วต่อใหม่
      return ws.close(4401, 'unauthorized');
    }
    // สิทธิ์ห้องข้อมูล + โปรไฟล์ตัวละคร โหลดครั้งเดียวตอนต่อ (ไม่ query ทุกข้อความ)
    void Promise.all([
      prisma.crabSystem.findMany({ where: { ownerId: ws.user.id }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: ws.user.id }, select: { name: true, avatarUrl: true, farmAvatar: true } }),
    ])
      .then(([rows, profile]) => {
        ws.allowed = new Set(rows.map((r) => r.id));
        ws.profile = profile ?? { name: null, avatarUrl: null, farmAvatar: null };
        send(ws, { t: 'hello', userId: ws.user!.id });
      })
      .catch(() => ws.close(1011, 'server error'));

    ws.on('pong', () => (ws.isAlive = true));
    // ปิดแท็บ = เดินออกจากทุกฟาร์ม
    ws.on('close', () => {
      if (!ws.user || !ws.farmRooms?.size) return;
      for (const id of ws.farmRooms) publishFarm(id, { t: 'village.leave', systemId: id, userId: ws.user.id }, ws);
      ws.farmRooms.clear();
    });

    ws.on('message', (raw) => {
      let msg: InMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t === 'ping') return send(ws, { t: 'pong' });
      const id = Number(msg.systemId);
      if (!Number.isFinite(id)) return;
      // ── ห้องรอบให้อาหาร (เจ้าของเท่านั้น) ──
      if (msg.t === 'unsubscribe') return void ws.rooms!.delete(id);
      if (msg.t === 'subscribe') {
        // ระบบที่เพิ่งสร้างหลังต่อสาย → เช็คกับ DB อีกครั้ง
        const check = ws.allowed?.has(id)
          ? Promise.resolve(true)
          : prisma.crabSystem.count({ where: { id, ownerId: ws.user!.id } }).then((n) => {
              if (n) ws.allowed?.add(id);
              return n > 0;
            });
        void check.then((ok) => {
          if (!ok) return send(ws, { t: 'error', message: 'ไม่มีสิทธิ์เข้าถึงระบบนี้' });
          ws.rooms!.add(id);
          send(ws, { t: 'subscribed', systemId: id });
        });
        return;
      }
      // ── ห้องหมู่บ้าน ──
      if (msg.t === 'village.enter') return void villageEnter(ws, id, msg);
      if (msg.t === 'village.leave') return villageLeave(ws, id);
      if (msg.t === 'village.move') return villageMove(ws, id, msg);
      if (msg.t === 'village.emote') {
        if (!ws.user || !ws.farmRooms?.has(id)) return;
        const emote = String(msg.emote ?? '').slice(0, 16);
        if (emote) publishFarm(id, { t: 'village.emote', systemId: id, userId: ws.user.id, emote }, ws);
      }
    });
  });

  // heartbeat: กัน proxy ตัดสายที่เงียบ + เก็บกวาด socket ที่ตายแล้ว
  beat = setInterval(() => {
    wss?.clients.forEach((c) => {
      const ws = c as Client;
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, env.WS_HEARTBEAT_SEC * 1000);
  beat.unref();
  // eslint-disable-next-line no-console
  console.log(`🔌 realtime (WebSocket) ที่ ${env.WS_PATH}`);
}

// ════════════════════════════════════════════════════════════════════
//  หมู่บ้าน — ข้อความจาก client
// ════════════════════════════════════════════════════════════════════

const clampTile = (v: number) => Math.min(MAX_TILE, Math.max(0, v));
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

/** เข้าฟาร์ม = จุดเดียวที่ query สิทธิ์ · หลังจากนั้น move (10 Hz) เช็คแค่ farmRooms.has() ในหน่วยความจำ */
async function villageEnter(ws: Client, systemId: number, msg: InMsg) {
  if (!ws.user) return;
  try {
    if (!(await canViewFarm(ws.user, systemId))) return send(ws, { t: 'village.kicked', systemId });
  } catch {
    return send(ws, { t: 'error', message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ' });
  }
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.pos = { x: clampTile(Number(msg.x) || 0), y: clampTile(Number(msg.y) || 0), f: isFacing(msg.f) ? msg.f : 'd' };
  ws.farmRooms!.add(systemId);
  const peers: PresenceUser[] = [];
  wss?.clients.forEach((c) => {
    const other = c as Client;
    if (other === ws || other.readyState !== WebSocket.OPEN) return;
    // บัญชีเดียวกัน 2 เครื่อง = ไม่นับซ้ำเป็นคนอื่น
    if (other.user && other.user.id !== ws.user!.id && other.farmRooms?.has(systemId)) peers.push(presenceOf(other));
  });
  send(ws, { t: 'village.entered', systemId, peers });
  publishFarm(systemId, { t: 'village.join', systemId, peer: presenceOf(ws) }, ws);
}

function villageLeave(ws: Client, systemId: number) {
  if (!ws.user || !ws.farmRooms?.delete(systemId)) return;
  publishFarm(systemId, { t: 'village.leave', systemId, userId: ws.user.id }, ws);
}

function villageMove(ws: Client, systemId: number, msg: InMsg) {
  if (!ws.user || !ws.farmRooms?.has(systemId)) return;
  const now = Date.now();
  if (ws.lastMoveAt && now - ws.lastMoveAt < MOVE_MIN_MS) return;
  ws.lastMoveAt = now;
  // ไม่เชื่อ client: บีบให้อยู่ในโลก + ปัดทศนิยม 1 ตำแหน่ง
  const x = Math.round(clampTile(Number(msg.x) || 0) * 10) / 10;
  const y = Math.round(clampTile(Number(msg.y) || 0) * 10) / 10;
  const f = isFacing(msg.f) ? msg.f : (ws.pos?.f ?? 'd');
  ws.pos = { x, y, f };
  // path เดียวที่วิ่ง 10 ครั้ง/วิ/คน → ประกอบ JSON เองให้สั้นที่สุด
  broadcast(`{"t":"village.move","systemId":${systemId},"userId":${ws.user.id},"x":${x},"y":${y},"f":"${f}"}`, (c) => !!c.farmRooms?.has(systemId), ws);
}

// ════════════════════════════════════════════════════════════════════
//  เรียกจาก service
// ════════════════════════════════════════════════════════════════════

/** แจ้งทุกเครื่องที่เปิดระบบนี้อยู่ให้โหลดรอบให้อาหารใหม่ */
export function publishFeeding(systemId: number): void {
  broadcast(JSON.stringify({ t: 'feeding.changed', systemId }), (ws) => !!ws.rooms?.has(systemId));
}

/** ส่งให้ทุกคนที่ "เดินอยู่" ในฟาร์มนี้ — except = ไม่ส่งกลับหาคนส่ง */
export function publishFarm(systemId: number, event: ServerEvent, except?: WebSocket): void {
  broadcast(JSON.stringify(event), (ws) => !!ws.farmRooms?.has(systemId), except);
}

/** ส่งถึงผู้ใช้คนหนึ่งทุกเครื่องที่ต่ออยู่ (มีคนขอเข้าชม / จดหมายใหม่ → โหลด ⚠ ใหม่) */
export function publishToUser(userId: number, event: ServerEvent): void {
  broadcast(JSON.stringify(event), (ws) => ws.user?.id === userId);
}

/** แต่งตัวใหม่ → คนที่ยืนในฟาร์มเดียวกันเห็นชุดใหม่ทันที (ws.profile cache ไว้ตอนต่อ) */
export function refreshFarmProfile(userId: number, profile: Profile): void {
  wss?.clients.forEach((c) => {
    const ws = c as Client;
    if (ws.user?.id !== userId) return;
    ws.profile = profile;
    for (const id of ws.farmRooms ?? []) publishFarm(id, { t: 'village.join', systemId: id, peer: presenceOf(ws) }, ws);
  });
}

/**
 * เช็คสิทธิ์ทุกคนที่ยืนอยู่ในฟาร์มเหล่านี้ใหม่ แล้วเตะคนที่ไม่มีสิทธิ์แล้วออก
 * ใช้ตอน: ถอนสิทธิ์ · ปิด "เปิดให้ทุกคน" · ออกจากหมู่บ้าน (ทั้งฝั่งเจ้าของและฝั่งแขก)
 */
export function recheckFarmVisitors(systemIds: number[], onlyUserId?: number): void {
  if (!wss || !systemIds.length) return;
  const targets: Client[] = [];
  wss.clients.forEach((c) => {
    const ws = c as Client;
    if (!ws.user || (onlyUserId != null && ws.user.id !== onlyUserId)) return;
    if (systemIds.some((id) => ws.farmRooms?.has(id))) targets.push(ws);
  });
  for (const ws of targets) {
    for (const id of systemIds) {
      if (!ws.farmRooms?.has(id)) continue;
      void canViewFarm(ws.user!, id)
        .then((ok) => {
          if (ok || !ws.farmRooms?.delete(id)) return;
          publishFarm(id, { t: 'village.leave', systemId: id, userId: ws.user!.id }, ws);
          send(ws, { t: 'village.kicked', systemId: id });
        })
        .catch(() => undefined);
    }
  }
}

/** ฟาร์มที่ผู้ใช้คนนี้ยืนอยู่ตอนนี้ (ใช้ตอนเขาออกจากหมู่บ้าน) */
export function farmsVisitedBy(userId: number): number[] {
  const out = new Set<number>();
  wss?.clients.forEach((c) => {
    const ws = c as Client;
    if (ws.user?.id === userId) ws.farmRooms?.forEach((id) => out.add(id));
  });
  return [...out];
}

export async function closeRealtime(): Promise<void> {
  if (beat) clearInterval(beat);
  beat = null;
  const s = wss;
  wss = null;
  if (!s) return;
  s.clients.forEach((c) => c.terminate());
  await new Promise<void>((resolve) => s.close(() => resolve()));
}

export const realtimeInfo = () => ({ enabled: env.REALTIME_ENABLED && !!wss, path: wss ? env.WS_PATH : null });
