import { PrismaClient } from '@prisma/client';
import clustersData from '../data/clusters.json';
import portsData from '../data/ports.json';
import terminalsData from '../data/terminals.json';

const prisma = new PrismaClient();

async function main() {
    console.log('Start seeding ...');

    // 1. Seed Clusters
    for (const cluster of clustersData) {
        // Need to serialize 'countries' array to string as per schema
        const countriesStr = JSON.stringify(cluster.countries || []);

        await prisma.cluster.create({
            data: {
                id: cluster.id,
                name: cluster.name,
                countries: countriesStr,
                priorityTier: cluster.priorityTier,
                description: cluster.description,
            },
        });
    }
    console.log(`Seeded ${clustersData.length} clusters.`);

    // 2. Seed Ports
    for (const port of portsData) {
        await prisma.port.create({
            data: {
                id: port.id,
                name: port.name,
                country: port.country,
                clusterId: port.clusterId,
                description: port.description,
            },
        });
    }
    console.log(`Seeded ${portsData.length} ports.`);

    // 3. Seed Terminals
    const terminals = terminalsData as any[];
    for (const terminal of terminals) {
        // Need to serialize 'cargoTypes' array to string
        const cargoTypesStr = JSON.stringify(terminal.cargoTypes || []);

        await prisma.terminal.create({
            data: {
                id: terminal.id,
                name: terminal.name,
                portId: terminal.portId,
                latitude: terminal.latitude,
                longitude: terminal.longitude,
                cargoTypes: cargoTypesStr,
                capacity: terminal.capacity,
                notes: terminal.notes,
                operatorGroup: terminal.operatorGroup,
                lastDeepResearchAt: terminal.lastDeepResearchAt ? new Date(terminal.lastDeepResearchAt) : null,
                lastDeepResearchSummary: terminal.lastDeepResearchSummary,
            },
        });
    }
    console.log(`Seeded ${terminalsData.length} terminals.`);
    console.log('Seeding finished.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
