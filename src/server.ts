import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';

// v2: scheduler (แจ้งเตือน) กลับมาใน P3, WebSocket (รอบให้อาหาร/หมู่บ้าน) กลับมาใน P4/P9
const app = createApp();

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
