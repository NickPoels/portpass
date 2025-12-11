
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    const term = await prisma.terminal.findFirst({
        where: { name: { contains: "DP World" } },
        include: { port: true }
    });

    if (!term) {
        console.log("Terminal not found!");
        return;
    }

    console.log("=== TERMINAL DATA ===");
    console.log(`Name: ${term.name}`);
    console.log(`Official Name: ${term.officialName}`);
    console.log(`Operator: ${term.operatorGroup}`);
    console.log(`Port: ${term.port.name}`);
    console.log(`Coordinates: ${term.latitude}, ${term.longitude}`);
    console.log(`Cargo Types: ${term.cargoTypes}`);
    console.log(`Volume: ${term.estAnnualVolume}`);
    console.log(`Volumes (Research): ${term.volumes}`);
    console.log(`Infrastructure: ${term.infrastructure}`);
    console.log(`ISPS Level: ${term.ispsRiskLevel}`);
    console.log(`ISPS Reason: ${term.ispsComplianceReason}`);
    console.log(`Leadership: ${term.leadership}`);
    console.log(`Research Summary: ${term.lastDeepResearchSummary}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
