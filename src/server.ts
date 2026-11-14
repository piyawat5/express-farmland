import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { tick } from './routes/reminders';
import { closeRealtime, initRealtime } from './lib/realtime';

// v2: WebSocket ซิงค์รอบให้อาหาร (P4) · หมู่บ้านฟาร์มกลับมาใน P9
const app = createApp();

// dev เท่านั้น: จำลอง Plesk Scheduled Task (ทุก 15 นาที) — production ห้ามพึ่ง (Passenger พัก process ตอน idle)
if (env.ENABLE_INTERNAL_CRON) {
  const run = () =>
    tick()
      // eslint-disable-next-line no-console
      .then((r) => r.checked && console.log('⏰ tick', r))
      // eslint-disable-next-line no-console
      .catch((e) => console.error('⏰ tick failed', e));
  setInterval(run, 15 * 60_000).unref();
}

// Passenger (Plesk) กำหนด PORT ให้เองผ่าน env
const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`🦀 express-farmland v2 listening on port ${env.PORT} [${env.NODE_ENV}]`);
});
// WebSocket ใช้ http server ตัวเดียวกัน (Passenger ส่ง Upgrade ต่อมาให้ — ต้องปิด Proxy mode ใน Plesk)
initRealtime(server);

async function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received, shutting down...`);
  await closeRealtime();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
