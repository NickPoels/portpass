import Dashboard from "@/components/Dashboard";
import { prisma } from "@/lib/prisma";
import { Cluster, Port, TerminalOperator, ClusterId, PriorityTier, ISPSRiskLevel, ISPSEnforcementStrength } from "@/lib/types";

// Helper to safely parse JSON array
const safeParseArray = (json: string | null | undefined): string[] => {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Failed to parse cargoTypes:", json, e);
    return [];
  }
};

// Helper to ensure proper typing when fetching from DB
async function getData() {
  let dbClusters, dbPorts, dbOperators;
  try {
    dbClusters = await prisma.cluster.findMany();
    dbPorts = await prisma.port.findMany();
    dbOperators = await prisma.terminalOperator.findMany();
  } catch (error: unknown) {
    throw error;
  }

  const clusters: Cluster[] = dbClusters.map(c => ({
    id: c.id as ClusterId,
    name: c.name,
    description: c.description,
    priorityTier: c.priorityTier as PriorityTier,
    countries: safeParseArray(c.countries),
    // Strategic & Metadata Fields
    strategicNotes: c.strategicNotes || undefined
  }));

  const ports: Port[] = dbPorts.map(p => ({
    id: p.id,
    name: p.name,
    country: p.country,
    clusterId: p.clusterId as ClusterId,
    description: p.description || undefined,
    // Governance
    portAuthority: p.portAuthority || undefined,
    // Identity
    identityCompetitors: p.identityCompetitors ? safeParseArray(p.identityCompetitors) : undefined,
    identityAdoptionRate: p.identityAdoptionRate || undefined,
    // ISPS
    portLevelISPSRisk: p.portLevelISPSRisk as ISPSRiskLevel | undefined,
    ispsEnforcementStrength: p.ispsEnforcementStrength as ISPSEnforcementStrength | undefined,
    // Strategic
    strategicNotes: p.strategicNotes || undefined,
    // Research tracking
    lastDeepResearchAt: p.lastDeepResearchAt ? p.lastDeepResearchAt.toISOString() : null,
    lastDeepResearchSummary: p.lastDeepResearchSummary || undefined,
    lastDeepResearchReport: p.lastDeepResearchReport || undefined,
  }));

  const operators: TerminalOperator[] = dbOperators.map(o => ({
    id: o.id,
    name: o.name,
    portId: o.portId,
    capacity: o.capacity || null,
    cargoTypes: safeParseArray(o.cargoTypes),
    operatorType: (o.operatorType === 'commercial' || o.operatorType === 'captive') ? o.operatorType : 'commercial',
    parentCompanies: o.parentCompanies ? safeParseArray(o.parentCompanies) : null,
    strategicNotes: o.strategicNotes || null,
    latitude: o.latitude || null,
    longitude: o.longitude || null,
    locations: o.locations ? JSON.parse(o.locations) : null,
    lastDeepResearchAt: o.lastDeepResearchAt ? o.lastDeepResearchAt.toISOString() : null,
    lastDeepResearchSummary: o.lastDeepResearchSummary || null,
    lastDeepResearchReport: o.lastDeepResearchReport || null,
  }));

  return { clusters, ports, operators };
}

export default async function Home() {
  try {
    const { clusters, ports, operators } = await getData();

    return (
      <main className="h-screen w-screen overflow-hidden">
        <Dashboard
          initialOperators={operators}
          ports={ports}
          clusters={clusters}
        />
      </main>
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    return (
      <main className="h-screen w-screen overflow-hidden flex items-center justify-center">
        <div className="text-red-600 p-8">
          <h1 className="text-2xl font-bold mb-4">Error Loading Data</h1>
          <p className="font-mono text-sm">{errorMessage}</p>
          {errorStack && <pre className="mt-4 text-xs overflow-auto max-h-96">{errorStack}</pre>}
        </div>
      </main>
    );
  }
}
