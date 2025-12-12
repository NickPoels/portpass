import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// #region agent log
const logDebug = (location: string, message: string, data: Record<string, unknown>, hypothesisId: string) => {
  const logEntry = {location,message,data,timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId};
  try {
    if (typeof fetch !== 'undefined') {
      fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logEntry)}).catch(()=>{});
    }
  } catch {}
  try {
    // Only use fs in Node.js context
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { writeFileSync } = require('fs');
      const { join } = require('path');
      writeFileSync(join(process.cwd(), '.cursor', 'debug.log'), JSON.stringify(logEntry) + '\n', { flag: 'a' });
    }
  } catch {}
};
logDebug('lib/prisma.ts:10', 'Prisma client initialization', {hasCached:!!globalForPrisma.prisma,nodeEnv:process.env.NODE_ENV}, 'F');
// #endregion

// Force clear cached Prisma client if it exists (for schema changes)
if (globalForPrisma.prisma) {
  // #region agent log
  logDebug('lib/prisma.ts:16', 'Clearing cached Prisma client', {}, 'H');
  // #endregion
  try {
    globalForPrisma.prisma.$disconnect().catch(() => {});
  } catch {
    // Ignore disconnect errors
  }
  delete globalForPrisma.prisma;
}

export const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['query'] : [],
    });

// #region agent log
logDebug('lib/prisma.ts:30', 'Prisma client created/retrieved', {isNew:!globalForPrisma.prisma}, 'G');
// #endregion

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
