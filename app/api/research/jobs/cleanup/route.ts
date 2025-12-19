import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cleanup endpoint for manually triggering stale job cleanup
 * Finds jobs in "running" status with lastHeartbeat older than 10 minutes
 * and marks them as "failed"
 */
export async function POST(request: NextRequest) {
  try {
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes
    
    const staleJobs = await prisma.researchJob.findMany({
      where: {
        status: 'running',
        OR: [
          { lastHeartbeat: { lt: staleThreshold } },
          { lastHeartbeat: null, startedAt: { lt: staleThreshold } }
        ]
      }
    });
    
    // Mark as failed
    const cleanedJobIds: string[] = [];
    for (const job of staleJobs) {
      await prisma.researchJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: `Job timeout: no heartbeat for >10 minutes. Started: ${job.startedAt}`,
          completedAt: new Date()
        }
      });
      cleanedJobIds.push(job.id);
    }
    
    return new Response(JSON.stringify({
      success: true,
      cleaned: staleJobs.length,
      jobIds: cleanedJobIds,
      message: `Cleaned up ${staleJobs.length} stale job(s)`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({
      error: 'Failed to cleanup stale jobs',
      message: errorMessage
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
