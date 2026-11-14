import type { IncomingMessage, Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { env, isProd } from '../config/env';
import { prisma } from './prisma';
import { verifyAccessToken, type AuthUser } from '../services/auth.service';

// ════════════════════════════════════════════════════════════════════
//  Realtime (WebSocket) v2 — ซิงค์รอบให้อาหารหลายเครื่อง (P4) · หมู่บ้านฟาร์มกลับมาใน P9
//
//  ปรัชญาเดิมจาก v1 ("ของแถม" ไม่ใช่ของจำเป็น):
//   - publish() เป็น no-op ถ้าไม่ได้เปิด → service เรียกได้เสมอ
//   - ข้อความเป็นแค่ "เคาะ" { t:'feeding.changed', systemId } ไม่มี payload → client ไป GET ใหม่เอง
//     หลุดกี่ข้อความก็ไม่เพี้ยน และหน้าเว็บถอยไป polling ได้โดยไม่ต้องแก้ server
//  สิทธิ์: subscribe ได้เฉพาะระบบของตัวเอง (ข้อมูลฟาร์มเห็นเฉพาะเจ้าของ — เหมือน REST)
//  ⚠️ Plesk: โดเมน API ต้อง "ปิด" Proxy mode ไม่งั้น Apache ถอด header Upgrade (บทเรียน v1)
// ════════════════════════════════════════════════════════════════════

type Client = WebSocket & { user?: AuthUser; allowed?: Set<number>; rooms?: Set<number>; isAlive?: boolean };

export type ServerEvent =
  | { t: 'hello'; userId: number }
  | { t: 'subscribed'; systemId: number }
  | { t: 'feeding.changed'; systemId: number }
  | { t: 'pong' }
  | { t: 'error'; message: string };

let wss: WebSocketServer | null = null;
let beat: NodeJS.Timeout | null = null;

function send(ws: WebSocket, event: ServerEvent) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
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
    void prisma.crabSystem
      .findMany({ where: { ownerId: ws.user.id }, select: { id: true } })
      .then((rows) => {
        ws.allowed = new Set(rows.map((r) => r.id));
        send(ws, { t: 'hello', userId: ws.user!.id });
      })
      .catch(() => ws.close(1011, 'server error'));

    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (raw) => {
      let msg: { t?: string; systemId?: number };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t === 'ping') return send(ws, { t: 'pong' });
      const id = Number(msg.systemId);
      if (!Number.isFinite(id)) return;
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

/** แจ้งทุกเครื่องที่เปิดระบบนี้อยู่ให้โหลดรอบให้อาหารใหม่ */
export function publishFeeding(systemId: number): void {
  if (!wss) return;
  const msg = JSON.stringify({ t: 'feeding.changed', systemId });
  wss.clients.forEach((c) => {
    const ws = c as Client;
    if (ws.readyState === WebSocket.OPEN && ws.rooms?.has(systemId)) ws.send(msg);
  });
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
