const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
    const dataDir = path.join(__dirname, '../data');

    // Load data
    const clusters = JSON.parse(fs.readFileSync(path.join(dataDir, 'clusters.json'), 'utf8'));
    const ports = JSON.parse(fs.readFileSync(path.join(dataDir, 'ports.json'), 'utf8'));
    const terminals = JSON.parse(fs.readFileSync(path.join(dataDir, 'terminals.json'), 'utf8'));

    console.log(`Found ${clusters.length} clusters, ${ports.length} ports, ${terminals.length} terminals.`);

    // Seed Clusters
    for (const cluster of clusters) {
        await prisma.cluster.upsert({
            where: { id: cluster.id },
            update: {},
            create: {
                id: cluster.id,
                name: cluster.name,
                countries: JSON.stringify(cluster.countries),
                priorityTier: cluster.priorityTier,
                description: cluster.description,
            },
        });
    }
    console.log('Clusters seeded.');

    // Seed Ports
    for (const port of ports) {
        await prisma.port.upsert({
            where: { id: port.id },
            update: {},
            create: {
                id: port.id,
                name: port.name,
                country: port.country,
                clusterId: port.clusterId,
                description: port.description,
            },
        });
    }
    console.log('Ports seeded.');

    // Seed Terminals
    for (const terminal of terminals) {
        await prisma.terminal.upsert({
            where: { id: terminal.id },
            update: {},
            create: {
                id: terminal.id,
                name: terminal.name,
                portId: terminal.portId,
                latitude: terminal.latitude,
                longitude: terminal.longitude,
                cargoTypes: JSON.stringify(terminal.cargoTypes),
                capacity: terminal.capacity,
            },
        });
    }
    console.log('Terminals seeded.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
