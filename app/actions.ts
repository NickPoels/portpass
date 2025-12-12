"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Cluster, Port, Terminal } from "@/lib/types";

// --- CLUSTERS ---

export async function createCluster(data: Cluster) {
    const countriesStr = JSON.stringify(data.countries);

    await prisma.cluster.create({
        data: {
            id: data.id,
            name: data.name,
            countries: countriesStr,
            priorityTier: data.priorityTier,
            description: data.description,
            strategicNotes: data.strategicNotes,
            clusterWideIdentitySystem: data.clusterWideIdentitySystem,
            governanceCoordination: data.governanceCoordination,
            networkEffectIndicators: data.networkEffectIndicators
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
            description: data.description,
            strategicNotes: data.strategicNotes,
            clusterWideIdentitySystem: data.clusterWideIdentitySystem,
            governanceCoordination: data.governanceCoordination,
            networkEffectIndicators: data.networkEffectIndicators
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
            description: data.description,
            // Governance
            portAuthority: data.portAuthority,
            customsAuthority: data.customsAuthority,
            // Identity
            portWideIdentitySystem: data.portWideIdentitySystem,
            identityCompetitors: data.identityCompetitors ? JSON.stringify(data.identityCompetitors) : null,
            identityAdoptionRate: data.identityAdoptionRate,
            // ISPS
            portLevelISPSRisk: data.portLevelISPSRisk,
            ispsEnforcementStrength: data.ispsEnforcementStrength,
            // Systems
            dominantTOSSystems: data.dominantTOSSystems ? JSON.stringify(data.dominantTOSSystems) : null,
            dominantACSSystems: data.dominantACSSystems ? JSON.stringify(data.dominantACSSystems) : null,
            // Strategic
            strategicNotes: data.strategicNotes,
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
            description: data.description,
            // Governance
            portAuthority: data.portAuthority,
            customsAuthority: data.customsAuthority,
            // Identity
            portWideIdentitySystem: data.portWideIdentitySystem,
            identityCompetitors: data.identityCompetitors ? JSON.stringify(data.identityCompetitors) : null,
            identityAdoptionRate: data.identityAdoptionRate,
            // ISPS
            portLevelISPSRisk: data.portLevelISPSRisk,
            ispsEnforcementStrength: data.ispsEnforcementStrength,
            // Systems
            dominantTOSSystems: data.dominantTOSSystems ? JSON.stringify(data.dominantTOSSystems) : null,
            dominantACSSystems: data.dominantACSSystems ? JSON.stringify(data.dominantACSSystems) : null,
            // Strategic
            strategicNotes: data.strategicNotes,
            // Research tracking
            lastDeepResearchAt: data.lastDeepResearchAt ? new Date(data.lastDeepResearchAt) : null,
            lastDeepResearchSummary: data.lastDeepResearchSummary,
            lastDeepResearchReport: data.lastDeepResearchReport,
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

    await prisma.terminal.create({
        data: {
            id: data.id,
            name: data.name,
            portId: data.portId,
            latitude: data.latitude,
            longitude: data.longitude,
            cargoTypes: cargoTypesStr,
            capacity: data.capacity,
            ispsRiskLevel: data.ispsRiskLevel,
            notes: data.notes,
            // Deep Research
            operatorGroup: data.operatorGroup,
            ownership: data.ownership,
            lastDeepResearchAt: data.lastDeepResearchAt ? new Date(data.lastDeepResearchAt) : null,
            lastDeepResearchSummary: data.lastDeepResearchSummary
        }
    });
    revalidatePath("/");
}

export async function updateTerminal(data: Terminal) {
    const cargoTypesStr = JSON.stringify(data.cargoTypes);

    await prisma.terminal.update({
        where: { id: data.id },
        data: {
            name: data.name,
            portId: data.portId,
            latitude: data.latitude,
            longitude: data.longitude,
            cargoTypes: cargoTypesStr,
            capacity: data.capacity,
            ispsRiskLevel: data.ispsRiskLevel,
            notes: data.notes,
            // Deep Research
            operatorGroup: data.operatorGroup,
            ownership: data.ownership,
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
