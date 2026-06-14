import { PrismaClient } from '@prisma/client';
import { isProd } from '../config/env';

// ใช้ singleton กัน connection รั่วตอน hot-reload (tsx watch)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['error'] : ['query', 'warn', 'error'],
  });

if (!isProd) globalForPrisma.prisma = prisma;
