import Dashboard from "@/components/Dashboard";
import { prisma } from "@/lib/prisma";
import { Cluster, Port, Terminal, ClusterId, PriorityTier, ISPSRiskLevel, ISPSEnforcementStrength } from "@/lib/types";

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
  let dbClusters, dbPorts, dbTerminals;
  try {
    dbClusters = await prisma.cluster.findMany();
    dbPorts = await prisma.port.findMany();
    dbTerminals = await prisma.terminal.findMany();
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

  const terminals: Terminal[] = dbTerminals.map(t => ({
    id: t.id,
    name: t.name,
    portId: t.portId,
    latitude: t.latitude,
    longitude: t.longitude,
    cargoTypes: safeParseArray(t.cargoTypes), // Use safe parser
    capacity: t.capacity || "Unknown",
    notes: t.notes || undefined,
    operatorGroup: t.operatorGroup || undefined,
    lastDeepResearchAt: t.lastDeepResearchAt ? t.lastDeepResearchAt.toISOString() : null,
    lastDeepResearchSummary: t.lastDeepResearchSummary || undefined,
    lastDeepResearchReport: t.lastDeepResearchReport || undefined,
  }));

  return { clusters, ports, terminals };
}

export default async function Home() {
  try {
    const { clusters, ports, terminals } = await getData();

    return (
      <main className="h-screen w-screen overflow-hidden">
        <Dashboard
          initialTerminals={terminals}
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
