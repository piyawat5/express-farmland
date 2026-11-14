import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { tick } from './routes/reminders';

// v2: WebSocket (รอบให้อาหาร/หมู่บ้าน) กลับมาใน P4/P9
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

async function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
