import type { IncomingMessage, Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { env, isProd } from '../config/env';
import { serialize } from './serialize';
import { ownedSystemIds } from './scope';
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

type Client = WebSocket & {
  user?: AuthUser;
  allowed?: number[] | null; // null = ADMIN (ทุกระบบ)
  rooms?: Set<number>; // systemId ที่ subscribe อยู่
  isAlive?: boolean;
};

export type ServerEvent =
  | { t: 'hello'; userId: number; serverTime: string }
  | { t: 'subscribed'; systemId: number }
  | { t: 'unsubscribed'; systemId: number }
  | { t: 'feeding.opened'; systemId: number; round: unknown }
  | { t: 'feeding.progress'; systemId: number; round: unknown }
  | { t: 'feeding.completed'; systemId: number; round: unknown }
  | { t: 'pong' }
  | { t: 'error'; message: string };

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

    // resolve สิทธิ์ครั้งเดียวตอนต่อ (ไม่ query ทุกข้อความ)
    void ownedSystemIds(ws.user)
      .then((ids) => {
        ws.allowed = ids;
        send(ws, { t: 'hello', userId: ws.user!.id, serverTime: new Date().toISOString() });
      })
      .catch(() => ws.close(1011, 'server error'));

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      let msg: { t?: string; systemId?: number };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return; // ข้อความมั่ว = เงียบ
      }
      if (msg.t === 'ping') return send(ws, { t: 'pong' });
      if (msg.t !== 'subscribe' && msg.t !== 'unsubscribe') return;

      const id = Number(msg.systemId);
      if (!Number.isFinite(id)) return;
      if (msg.t === 'unsubscribe') {
        ws.rooms!.delete(id);
        return send(ws, { t: 'unsubscribed', systemId: id });
      }
      if (ws.allowed !== null && ws.allowed !== undefined && !ws.allowed.includes(id)) {
        return send(ws, { t: 'error', message: 'ไม่มีสิทธิ์เข้าถึงระบบนี้' });
      }
      ws.rooms!.add(id);
      send(ws, { t: 'subscribed', systemId: id });
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

/** ส่ง event ให้ทุกเครื่องที่ subscribe ระบบนี้อยู่ — no-op ถ้า realtime ปิด/ยังไม่ init */
export function publish(systemId: number, event: ServerEvent): void {
  if (!wss) return;
  const payload = JSON.stringify(serialize(event)); // stringify ครั้งเดียวต่อ broadcast
  wss.clients.forEach((c) => {
    const ws = c as Client;
    if (ws.readyState === WebSocket.OPEN && ws.rooms?.has(systemId)) ws.send(payload);
  });
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
