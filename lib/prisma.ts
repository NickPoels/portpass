import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Force clear cached Prisma client if it exists (for schema changes)
if (globalForPrisma.prisma) {
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

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
