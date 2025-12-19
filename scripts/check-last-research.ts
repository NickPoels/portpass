import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking most recent deep research job...\n');
  
  // Get the most recent completed or failed research job
  const recentJob = await prisma.researchJob.findFirst({
    where: {
      status: { in: ['completed', 'failed'] }
    },
    orderBy: { completedAt: 'desc' },
    take: 1
  });
  
  if (!recentJob) {
    console.log('No recent completed/failed research job found.');
    return;
  }
  
  console.log('='.repeat(80));
  console.log(`Job ID: ${recentJob.id}`);
  console.log(`Type: ${recentJob.type}`);
  console.log(`Status: ${recentJob.status}`);
  console.log(`Progress: ${recentJob.progress}%`);
  console.log(`Started: ${recentJob.startedAt?.toISOString() || 'N/A'}`);
  console.log(`Completed: ${recentJob.completedAt?.toISOString() || 'N/A'}`);
  if (recentJob.error) {
    console.log(`Error: ${recentJob.error}`);
  }
  console.log('='.repeat(80));
  
  // Get the entity (port or terminal) to see the research report
  if (recentJob.type === 'port') {
    const port = await prisma.port.findUnique({
      where: { id: recentJob.entityId },
      select: {
        name: true,
        country: true,
        lastDeepResearchReport: true,
        lastDeepResearchAt: true
      }
    });
    
    if (port) {
      console.log(`\nPort: ${port.name} (${port.country})`);
      console.log(`Research completed at: ${port.lastDeepResearchAt?.toISOString() || 'N/A'}`);
      
      if (port.lastDeepResearchReport) {
        const report = port.lastDeepResearchReport as any;
        console.log(`\nResearch Report Analysis:`);
        console.log('-'.repeat(80));
        
        // Count sections in the report
        const reportText = typeof report === 'string' ? report : JSON.stringify(report, null, 2);
        const governanceCount = (reportText.match(/## Governance Report/g) || []).length;
        const ispsCount = (reportText.match(/## ISPS Risk & Enforcement Report/g) || []).length;
        const strategicCount = (reportText.match(/## Strategic Intelligence Report/g) || []).length;
        
        console.log(`Governance Report sections: ${governanceCount}`);
        console.log(`ISPS Risk Report sections: ${ispsCount}`);
        console.log(`Strategic Intelligence Report sections: ${strategicCount}`);
        
        // Check for query failure indicators
        const hasTimeout = reportText.includes('TIMEOUT') || reportText.includes('timeout');
        const hasError = reportText.includes('failed') || reportText.includes('error');
        
        if (hasTimeout) {
          console.log(`\n⚠️  WARNING: Report contains timeout indicators`);
        }
        if (hasError) {
          console.log(`\n⚠️  WARNING: Report contains error indicators`);
        }
        
        // Show first 500 chars of report
        console.log(`\nFirst 500 characters of report:`);
        console.log('-'.repeat(80));
        console.log(reportText.substring(0, 500));
        console.log('...');
        
        // Expected: 3 reports (governance, ISPS, strategic)
        const expectedReports = 3;
        const foundReports = governanceCount + ispsCount + strategicCount;
        
        console.log(`\n${'='.repeat(80)}`);
        if (foundReports < expectedReports) {
          console.log(`⚠️  ISSUE: Expected ${expectedReports} reports, but found ${foundReports} report sections.`);
          console.log(`This suggests some queries may have failed.`);
        } else {
          console.log(`✓ Found ${foundReports} report sections as expected.`);
        }
      } else {
        console.log(`\n⚠️  No research report found for this port.`);
      }
    } else {
      console.log(`\n⚠️  Port with ID ${recentJob.entityId} not found.`);
    }
  } else if (recentJob.type === 'terminal') {
    const terminal = await prisma.terminal.findUnique({
      where: { id: recentJob.entityId },
      select: {
        name: true,
        lastDeepResearchReport: true,
        lastDeepResearchAt: true
      }
    });
    
    if (terminal) {
      console.log(`\nTerminal: ${terminal.name}`);
      console.log(`Research completed at: ${terminal.lastDeepResearchAt?.toISOString() || 'N/A'}`);
      
      if (terminal.lastDeepResearchReport) {
        const report = terminal.lastDeepResearchReport as any;
        const reportText = typeof report === 'string' ? report : JSON.stringify(report, null, 2);
        
        // For terminals, check for location and capacity reports
        const locationCount = (reportText.match(/## Location Report/g) || []).length;
        const capacityCount = (reportText.match(/## Capacity & Operations Report/g) || []).length;
        
        console.log(`\nResearch Report Analysis:`);
        console.log(`Location Report sections: ${locationCount}`);
        console.log(`Capacity & Operations Report sections: ${capacityCount}`);
        
        const expectedReports = 2;
        const foundReports = locationCount + capacityCount;
        
        console.log(`\n${'='.repeat(80)}`);
        if (foundReports < expectedReports) {
          console.log(`⚠️  ISSUE: Expected ${expectedReports} reports, but found ${foundReports} report sections.`);
        } else {
          console.log(`✓ Found ${foundReports} report sections as expected.`);
        }
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
