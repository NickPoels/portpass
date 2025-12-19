"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Cluster, Port, TerminalOperator, ParentCompany } from "@/lib/types";

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
            strategicNotes: data.strategicNotes
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
            strategicNotes: data.strategicNotes
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
            // Identity
            identityCompetitors: data.identityCompetitors ? JSON.stringify(data.identityCompetitors) : null,
            identityAdoptionRate: data.identityAdoptionRate,
            // ISPS
            portLevelISPSRisk: data.portLevelISPSRisk,
            ispsEnforcementStrength: data.ispsEnforcementStrength,
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
            // Identity
            identityCompetitors: data.identityCompetitors ? JSON.stringify(data.identityCompetitors) : null,
            identityAdoptionRate: data.identityAdoptionRate,
            // ISPS
            portLevelISPSRisk: data.portLevelISPSRisk,
            ispsEnforcementStrength: data.ispsEnforcementStrength,
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

// --- TERMINAL OPERATORS ---

export async function createTerminalOperator(data: TerminalOperator) {
    const cargoTypesStr = JSON.stringify(data.cargoTypes);
    const parentCompaniesStr = data.parentCompanies ? JSON.stringify(data.parentCompanies) : null;
    const locationsStr = data.locations ? JSON.stringify(data.locations) : null;

    await prisma.terminalOperator.create({
        data: {
            id: data.id,
            name: data.name,
            portId: data.portId,
            capacity: data.capacity,
            cargoTypes: cargoTypesStr,
            operatorType: data.operatorType,
            parentCompanies: parentCompaniesStr,
            strategicNotes: data.strategicNotes,
            latitude: data.latitude,
            longitude: data.longitude,
            locations: locationsStr,
            // Deep Research
            lastDeepResearchAt: data.lastDeepResearchAt ? new Date(data.lastDeepResearchAt) : null,
            lastDeepResearchSummary: data.lastDeepResearchSummary,
            lastDeepResearchReport: data.lastDeepResearchReport
        }
    });
    revalidatePath("/");
}

export async function updateTerminalOperator(data: TerminalOperator) {
    const cargoTypesStr = JSON.stringify(data.cargoTypes);
    const parentCompaniesStr = data.parentCompanies ? JSON.stringify(data.parentCompanies) : null;
    const locationsStr = data.locations ? JSON.stringify(data.locations) : null;

    await prisma.terminalOperator.update({
        where: { id: data.id },
        data: {
            name: data.name,
            portId: data.portId,
            capacity: data.capacity,
            cargoTypes: cargoTypesStr,
            operatorType: data.operatorType,
            parentCompanies: parentCompaniesStr,
            strategicNotes: data.strategicNotes,
            latitude: data.latitude,
            longitude: data.longitude,
            locations: locationsStr,
            // Deep Research
            lastDeepResearchAt: data.lastDeepResearchAt ? new Date(data.lastDeepResearchAt) : null,
            lastDeepResearchSummary: data.lastDeepResearchSummary,
            lastDeepResearchReport: data.lastDeepResearchReport
        }
    });
    revalidatePath("/");
}

export async function deleteTerminalOperator(id: string) {
    await prisma.terminalOperator.delete({ where: { id } });
    revalidatePath("/");
}

// --- PARENT COMPANIES ---

export async function createParentCompany(data: ParentCompany) {
    await prisma.parentCompany.create({
        data: {
            id: data.id,
            name: data.name,
            description: data.description,
            website: data.website
        }
    });
    revalidatePath("/");
}

export async function updateParentCompany(data: ParentCompany) {
    await prisma.parentCompany.update({
        where: { id: data.id },
        data: {
            name: data.name,
            description: data.description,
            website: data.website
        }
    });
    revalidatePath("/");
}

export async function deleteParentCompany(id: string) {
    await prisma.parentCompany.delete({ where: { id } });
    revalidatePath("/");
}

export async function getParentCompanies(): Promise<ParentCompany[]> {
    const companies = await prisma.parentCompany.findMany({
        orderBy: { name: 'asc' }
    });
    
    return companies.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        website: c.website
    }));
}
