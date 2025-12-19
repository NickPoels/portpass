import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking for running research jobs...\n');
  
  const runningJobs = await prisma.researchJob.findMany({
    where: { status: 'running' },
    orderBy: { startedAt: 'desc' }
  });
  
  if (runningJobs.length === 0) {
    console.log('No running jobs found.');
    return;
  }
  
  console.log(`Found ${runningJobs.length} running job(s):\n`);
  console.log('='.repeat(80));
  
  for (const job of runningJobs) {
    const timeSinceStart = job.startedAt 
      ? Math.round((Date.now() - new Date(job.startedAt).getTime()) / 1000)
      : 0;
    const timeSinceHeartbeat = job.lastHeartbeat
      ? Math.round((Date.now() - new Date(job.lastHeartbeat).getTime()) / 1000)
      : null;
    
    // Fetch entity name
    let entityName = job.entityId;
    try {
      if (job.type === 'port') {
        const port = await prisma.port.findUnique({
          where: { id: job.entityId },
          select: { name: true, country: true }
        });
        entityName = port ? `${port.name} (${port.country})` : job.entityId;
      } else if (job.type === 'terminal') {
        const terminal = await prisma.terminal.findUnique({
          where: { id: job.entityId },
          select: { name: true }
        });
        entityName = terminal ? terminal.name : job.entityId;
      }
    } catch (err) {
      // If entity not found, just use entityId
    }
    
    console.log(`\nJob ID: ${job.id}`);
    console.log(`  Type: ${job.type}`);
    console.log(`  Entity: ${entityName} (${job.entityId})`);
    console.log(`  Progress: ${job.progress}%`);
    console.log(`  Started: ${job.startedAt?.toISOString() || 'N/A'} (${timeSinceStart}s ago / ${Math.round(timeSinceStart / 60)}m)`);
    console.log(`  Last Heartbeat: ${job.lastHeartbeat?.toISOString() || 'Never'} ${timeSinceHeartbeat !== null ? `(${timeSinceHeartbeat}s ago / ${Math.round(timeSinceHeartbeat / 60)}m)` : ''}`);
    
    // Determine status
    let status = '✓ Active';
    if (timeSinceHeartbeat === null) {
      status = '⚠️  WARNING: No heartbeat recorded';
    } else if (timeSinceHeartbeat > 600) {
      status = '❌ STUCK: No heartbeat for >10 minutes';
    } else if (timeSinceHeartbeat > 60) {
      status = '⚠️  WARNING: No heartbeat for >1 minute';
    }
    
    if (timeSinceStart > 600) {
      status += ` (Running for ${Math.round(timeSinceStart / 60)}m)`;
    }
    
    console.log(`  Status: ${status}`);
    
    if (job.error) {
      console.log(`  Error: ${job.error}`);
    }
    
    console.log('='.repeat(80));
  }
  
  // Check for stale jobs
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
  const staleJobs = runningJobs.filter(job => {
    if (!job.lastHeartbeat && job.startedAt && job.startedAt < staleThreshold) {
      return true;
    }
    if (job.lastHeartbeat && job.lastHeartbeat < staleThreshold) {
      return true;
    }
    return false;
  });
  
  if (staleJobs.length > 0) {
    console.log(`\n⚠️  Found ${staleJobs.length} potentially stale job(s) that may need cleanup.`);
    console.log('   You can run: POST /api/research/jobs/cleanup to mark them as failed.\n');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
