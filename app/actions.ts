"use server";

import { PrismaClient } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { Cluster, Port, Terminal } from "@/lib/types";

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// --- CLUSTERS ---

export async function createCluster(data: Cluster) {
    const countriesStr = JSON.stringify(data.countries);

    await prisma.cluster.create({
        data: {
            id: data.id,
            name: data.name,
            countries: countriesStr,
            priorityTier: data.priorityTier,
            description: data.description
        }
    });
    revalidatePath("/");
}

export async function updateCluster(data: Cluster) {
    const countriesStr = JSON.stringify(data.countries);

    await prisma.cluster.update({
        where: { id: data.id },
        data: {
            name: data.name,
            countries: countriesStr,
            priorityTier: data.priorityTier,
            description: data.description
        }
    });
    revalidatePath("/");
}

export async function deleteCluster(id: string) {
    await prisma.cluster.delete({ where: { id } });
    revalidatePath("/");
}

// --- PORTS ---

export async function createPort(data: Port) {
    await prisma.port.create({
        data: {
            id: data.id,
            name: data.name,
            country: data.country,
            clusterId: data.clusterId,
            latitude: data.latitude,
            longitude: data.longitude,
            description: data.description
        }
    });
    revalidatePath("/");
}

export async function updatePort(data: Port) {
    await prisma.port.update({
        where: { id: data.id },
        data: {
            name: data.name,
            country: data.country,
            clusterId: data.clusterId,
            latitude: data.latitude,
            longitude: data.longitude,
            description: data.description
        }
    });
    revalidatePath("/");
}

export async function deletePort(id: string) {
    await prisma.port.delete({ where: { id } });
    revalidatePath("/");
}

// --- TERMINALS ---

export async function createTerminal(data: Terminal) {
    const cargoTypesStr = JSON.stringify(data.cargoTypes);
    const leadershipStr = data.leadership ? JSON.stringify(data.leadership) : null;
    const cargoSpecsStr = data.cargoSpecializations ? JSON.stringify(data.cargoSpecializations) : null;

    await prisma.terminal.create({
        data: {
            id: data.id,
            name: data.name,
            portId: data.portId,
            latitude: data.latitude,
            longitude: data.longitude,
            cargoTypes: cargoTypesStr,
            estAnnualVolume: data.estAnnualVolume,
            ispsRiskLevel: data.ispsRiskLevel,
            notes: data.notes,
            // Deep Research
            officialName: data.officialName,
            operatorGroup: data.operatorGroup,
            ownership: data.ownership,
            leadership: leadershipStr,
            cargoSpecializations: cargoSpecsStr,
            infrastructure: data.infrastructure,
            volumes: data.volumes,
            digitalizationSecurity: data.digitalizationSecurity,
            lastDeepResearchAt: data.lastDeepResearchAt ? new Date(data.lastDeepResearchAt) : null,
            lastDeepResearchSummary: data.lastDeepResearchSummary
        }
    });
    revalidatePath("/");
}

export async function updateTerminal(data: Terminal) {
    const cargoTypesStr = JSON.stringify(data.cargoTypes);
    const leadershipStr = data.leadership ? JSON.stringify(data.leadership) : null;
    const cargoSpecsStr = data.cargoSpecializations ? JSON.stringify(data.cargoSpecializations) : null;

    await prisma.terminal.update({
        where: { id: data.id },
        data: {
            name: data.name,
            portId: data.portId,
            latitude: data.latitude,
            longitude: data.longitude,
            cargoTypes: cargoTypesStr,
            estAnnualVolume: data.estAnnualVolume,
            ispsRiskLevel: data.ispsRiskLevel,
            notes: data.notes,
            // Deep Research
            officialName: data.officialName,
            operatorGroup: data.operatorGroup,
            ownership: data.ownership,
            leadership: leadershipStr,
            cargoSpecializations: cargoSpecsStr,
            infrastructure: data.infrastructure,
            volumes: data.volumes,
            digitalizationSecurity: data.digitalizationSecurity,
            lastDeepResearchAt: data.lastDeepResearchAt ? new Date(data.lastDeepResearchAt) : null,
            lastDeepResearchSummary: data.lastDeepResearchSummary
        }
    });
    revalidatePath("/");
}

export async function deleteTerminal(id: string) {
    await prisma.terminal.delete({ where: { id } });
    revalidatePath("/");
}
