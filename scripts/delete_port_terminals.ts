import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // List all ports first to find the right one
    const allPorts = await prisma.port.findMany({
        select: { id: true, name: true, country: true }
    });

    console.log('Available ports:');
    allPorts.forEach(p => console.log(`  - ${p.name} (${p.country}) - ID: ${p.id}`));
    console.log('');

    // Find the Antwerp-Bruges port (case-insensitive search in memory)
    const portName = process.argv[2] || 'Antwerp-Bruges';
    const port = allPorts.find(p => 
        p.name.toLowerCase().includes('antwerp') || 
        p.name.toLowerCase().includes('bruges') ||
        p.name.toLowerCase() === portName.toLowerCase()
    );

    if (!port) {
        console.log(`Port containing "Antwerp" or "Bruges" not found.`);
        console.log('Usage: npx tsx scripts/delete_port_terminals.ts [port-name]');
        return;
    }

    // Get full port with terminals and proposals
    const portWithData = await prisma.port.findUnique({
        where: { id: port.id },
        include: {
            terminals: true,
            terminalProposals: true
        }
    });

    if (!portWithData) {
        console.log('Port not found after lookup.');
        return;
    }

    console.log(`Found port: ${portWithData.name} (${portWithData.country})`);
    console.log(`Port ID: ${portWithData.id}`);
    console.log(`Current terminals: ${portWithData.terminals.length}`);
    console.log(`Current terminal proposals: ${portWithData.terminalProposals.length}`);

    if (portWithData.terminals.length === 0 && portWithData.terminalProposals.length === 0) {
        console.log('No terminals or proposals to delete.');
        return;
    }

    // Delete all terminal proposals for this port
    const deleteProposalsResult = await prisma.terminalProposal.deleteMany({
        where: {
            portId: portWithData.id
        }
    });

    // Delete all terminals for this port
    const deleteTerminalsResult = await prisma.terminal.deleteMany({
        where: {
            portId: portWithData.id
        }
    });

    console.log(`\nDeleted ${deleteTerminalsResult.count} terminal(s) and ${deleteProposalsResult.count} proposal(s) from ${portWithData.name}`);
    
    if (portWithData.terminals.length > 0) {
        console.log('Terminals deleted:');
        portWithData.terminals.forEach(t => {
            console.log(`  - ${t.name} (${t.id})`);
        });
    }
    
    if (portWithData.terminalProposals.length > 0) {
        console.log('Terminal proposals deleted:');
        portWithData.terminalProposals.forEach(tp => {
            console.log(`  - ${tp.name} (${tp.id})`);
        });
    }
}

main()
    .catch((e) => {
        console.error('Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });



