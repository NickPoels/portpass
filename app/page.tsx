import Dashboard from "@/components/Dashboard";
import { PrismaClient } from "@prisma/client";
import { Cluster, Port, Terminal, ClusterId, PriorityTier, ISPSRiskLevel, CargoType } from "@/lib/types";

const prisma = new PrismaClient();

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
  const dbClusters = await prisma.cluster.findMany();
  const dbPorts = await prisma.port.findMany();
  const dbTerminals = await prisma.terminal.findMany();

  const clusters: Cluster[] = dbClusters.map(c => ({
    ...c,
    id: c.id as ClusterId,
    priorityTier: c.priorityTier as PriorityTier,
    countries: safeParseArray(c.countries)
  }));

  const ports: Port[] = dbPorts.map(p => ({
    ...p,
    clusterId: p.clusterId as ClusterId,
    description: p.description || undefined
  }));

  const terminals: Terminal[] = dbTerminals.map(t => ({
    ...t,
    cargoTypes: safeParseArray(t.cargoTypes), // Use safe parser
    ispsRiskLevel: (t.ispsRiskLevel || "Low") as ISPSRiskLevel,
    ispsComplianceReason: t.ispsComplianceReason || undefined,
    estAnnualVolume: t.estAnnualVolume || "Unknown",
    notes: t.notes || undefined,
    leadership: t.leadership ? JSON.parse(t.leadership) : null,
    cargoSpecializations: t.cargoSpecializations ? JSON.parse(t.cargoSpecializations) : null,
    lastDeepResearchAt: t.lastDeepResearchAt ? t.lastDeepResearchAt.toISOString() : null,
  }));

  return { clusters, ports, terminals };
}

export default async function Home() {
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
}
