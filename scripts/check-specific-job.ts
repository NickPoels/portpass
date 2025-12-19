import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const jobId = 'da49ff93-52d6-407a-9b66-d82bfa14f344';
  
  const job = await prisma.researchJob.findUnique({
    where: { id: jobId }
  });
  
  if (!job) {
    console.error(`Job ${jobId} not found`);
    return;
  }
  
  console.log('Job details:');
  console.log(JSON.stringify(job, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
