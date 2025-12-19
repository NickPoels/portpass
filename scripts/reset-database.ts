import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting database reset...\n');

    try {
        // Delete in order: child tables first, parent tables last
        // This respects foreign key constraints
        
        console.log('Deleting TerminalProposal records...');
        const terminalProposalsDeleted = await prisma.terminalProposal.deleteMany({});
        console.log(`  ✓ Deleted ${terminalProposalsDeleted.count} terminal proposal(s)`);

        console.log('Deleting Terminal records...');
        const terminalsDeleted = await prisma.terminal.deleteMany({});
        console.log(`  ✓ Deleted ${terminalsDeleted.count} terminal(s)`);

        console.log('Deleting ResearchJob records...');
        const researchJobsDeleted = await prisma.researchJob.deleteMany({});
        console.log(`  ✓ Deleted ${researchJobsDeleted.count} research job(s)`);

        console.log('Deleting Port records...');
        const portsDeleted = await prisma.port.deleteMany({});
        console.log(`  ✓ Deleted ${portsDeleted.count} port(s)`);

        console.log('Deleting Cluster records...');
        const clustersDeleted = await prisma.cluster.deleteMany({});
        console.log(`  ✓ Deleted ${clustersDeleted.count} cluster(s)`);

        console.log('\n✓ Database reset completed successfully!');
        console.log('  All tables have been cleared.');
    } catch (error) {
        console.error('\n✗ Error during database reset:');
        console.error(error);
        throw error;
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });


