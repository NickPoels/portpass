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

        await prisma.cluster.upsert({
            where: { id: cluster.id },
            update: {
                name: cluster.name,
                countries: countriesStr,
                priorityTier: cluster.priorityTier,
                description: cluster.description,
            },
            create: {
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
        await prisma.port.upsert({
            where: { id: port.id },
            update: {
                name: port.name,
                country: port.country,
                clusterId: port.clusterId,
                latitude: port.latitude,
                longitude: port.longitude,
                description: port.description,
            },
            create: {
                id: port.id,
                name: port.name,
                country: port.country,
                clusterId: port.clusterId,
                latitude: port.latitude,
                longitude: port.longitude,
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

        // Also check if deep research fields exist
        const leadershipStr = terminal.leadership ? JSON.stringify(terminal.leadership) : null;
        const cargoSpecializationsStr = terminal.cargoSpecializations ? JSON.stringify(terminal.cargoSpecializations) : null;

        await prisma.terminal.upsert({
            where: { id: terminal.id },
            update: {
                name: terminal.name,
                portId: terminal.portId,
                latitude: terminal.latitude,
                longitude: terminal.longitude,
                cargoTypes: cargoTypesStr,
                estAnnualVolume: terminal.estAnnualVolume,
                ispsRiskLevel: terminal.ispsRiskLevel,
                notes: terminal.notes,
                officialName: terminal.officialName,
                operatorGroup: terminal.operatorGroup,
                ownership: terminal.ownership,
                leadership: leadershipStr,
                cargoSpecializations: cargoSpecializationsStr,
                infrastructure: terminal.infrastructure,
                volumes: terminal.volumes,
                digitalizationSecurity: terminal.digitalizationSecurity,
                lastDeepResearchAt: terminal.lastDeepResearchAt ? new Date(terminal.lastDeepResearchAt) : null,
                lastDeepResearchSummary: terminal.lastDeepResearchSummary,
            },
            create: {
                id: terminal.id,
                name: terminal.name,
                portId: terminal.portId,
                latitude: terminal.latitude,
                longitude: terminal.longitude,
                cargoTypes: cargoTypesStr,
                estAnnualVolume: terminal.estAnnualVolume,
                ispsRiskLevel: terminal.ispsRiskLevel,
                notes: terminal.notes,
                officialName: terminal.officialName,
                operatorGroup: terminal.operatorGroup,
                ownership: terminal.ownership,
                leadership: leadershipStr,
                cargoSpecializations: cargoSpecializationsStr,
                infrastructure: terminal.infrastructure,
                volumes: terminal.volumes,
                digitalizationSecurity: terminal.digitalizationSecurity,
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
