import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const jobId = process.argv[2];
  
  if (!jobId) {
    console.error('Usage: npx tsx scripts/mark-job-failed.ts <jobId>');
    process.exit(1);
  }
  
  const job = await prisma.researchJob.findUnique({
    where: { id: jobId }
  });
  
  if (!job) {
    console.error(`Job ${jobId} not found`);
    return;
  }
  
  if (job.status !== 'running') {
    console.log(`Job ${jobId} is not running (status: ${job.status}), skipping`);
    return;
  }
  
  await prisma.researchJob.update({
    where: { id: jobId },
    data: {
      status: 'failed',
      error: `Job manually marked as failed: stuck at ${job.progress}% progress. Last heartbeat: ${job.lastHeartbeat?.toISOString() || 'never'}`,
      completedAt: new Date()
    }
  });
  
  console.log(`Job ${jobId} marked as failed`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
