import cron from 'node-cron';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { tick } from './services/scheduler.service';

const app = createApp();

// Passenger (Plesk) จะกำหนด PORT ให้เองผ่าน env
const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`🦀 express-farmland listening on port ${env.PORT} [${env.NODE_ENV}]`);
});

// ⚠️ บน Plesk/Passenger process ถูกพักตอน idle → in-process cron ไม่ชัวร์
// production ใช้ Plesk Scheduled Task ยิง POST /api/scheduler/tick แทน
// ตอน dev (ENABLE_INTERNAL_CRON=true) ใช้ node-cron จำลองการยิง tick ทุกนาที
if (env.ENABLE_INTERNAL_CRON) {
  cron.schedule('* * * * *', () => {
    tick()
      .then((r) => {
        if (r.generated || r.emailsSent) {
          // eslint-disable-next-line no-console
          console.log(`⏰ tick: +${r.generated} งานใหม่, งานค้าง ${r.pending}, ส่งเมลสรุป ${r.emailsSent}`);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('tick error:', err);
      });
  });
  // eslint-disable-next-line no-console
  console.log('⏰ internal cron เปิดอยู่ (ทุก 1 นาที) — dev only');
}

// graceful shutdown
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
