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

// Helper to log debug info (works in server context)
const logDebug = (location: string, message: string, data: Record<string, unknown>, hypothesisId: string) => {
  const logEntry = {location,message,data,timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId};
  try {
    if (typeof fetch !== 'undefined') {
      fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logEntry)}).catch(()=>{});
    }
  } catch {}
  try {
    // Only use fs in Node.js context
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { writeFileSync } = require('fs');
      const { join } = require('path');
      writeFileSync(join(process.cwd(), '.cursor', 'debug.log'), JSON.stringify(logEntry) + '\n', { flag: 'a' });
    }
  } catch {}
};

// Helper to ensure proper typing when fetching from DB
async function getData() {
  // #region agent log
  logDebug('app/page.tsx:25', 'getData entry', {timestamp:Date.now()}, 'A');
  // #endregion
  let dbClusters, dbPorts, dbTerminals;
  try {
    dbClusters = await prisma.cluster.findMany();
    // #region agent log
    logDebug('app/page.tsx:29', 'Clusters fetched', {count:dbClusters.length}, 'B');
    // #endregion
    
    // #region agent log
    logDebug('app/page.tsx:32', 'Before port.findMany', {prismaClientType:typeof prisma,prismaConstructor:prisma?.constructor?.name}, 'C');
    // #endregion
    dbPorts = await prisma.port.findMany();
    // #region agent log
    logDebug('app/page.tsx:35', 'Ports fetched successfully', {count:dbPorts.length,firstPortKeys:dbPorts[0]?Object.keys(dbPorts[0]):[]}, 'D');
    // #endregion
    dbTerminals = await prisma.terminal.findMany();
  } catch (error: unknown) {
    // #region agent log
    const errorInfo = error instanceof Error ? {
      errorMessage: error.message,
      errorStack: error.stack?.substring(0, 500),
      errorName: error.name
    } : { errorString: String(error) };
    logDebug('app/page.tsx:38', 'Error in getData', errorInfo, 'E');
    // #endregion
    throw error;
  }

  const clusters: Cluster[] = dbClusters.map(c => ({
    id: c.id as ClusterId,
    name: c.name,
    description: c.description,
    priorityTier: c.priorityTier as PriorityTier,
    countries: safeParseArray(c.countries),
    // Strategic & Metadata Fields
    strategicNotes: c.strategicNotes || undefined,
    clusterWideIdentitySystem: c.clusterWideIdentitySystem || undefined,
    governanceCoordination: c.governanceCoordination || undefined,
    networkEffectIndicators: c.networkEffectIndicators || undefined
  }));

  const ports: Port[] = dbPorts.map(p => ({
    id: p.id,
    name: p.name,
    country: p.country,
    clusterId: p.clusterId as ClusterId,
    description: p.description || undefined,
    // Governance
    portAuthority: p.portAuthority || undefined,
    customsAuthority: p.customsAuthority || undefined,
    // Identity
    portWideIdentitySystem: p.portWideIdentitySystem || undefined,
    identityCompetitors: p.identityCompetitors ? safeParseArray(p.identityCompetitors) : undefined,
    identityAdoptionRate: p.identityAdoptionRate || undefined,
    // ISPS
    portLevelISPSRisk: p.portLevelISPSRisk as ISPSRiskLevel | undefined,
    ispsEnforcementStrength: p.ispsEnforcementStrength as ISPSEnforcementStrength | undefined,
    // Systems
    dominantTOSSystems: p.dominantTOSSystems ? safeParseArray(p.dominantTOSSystems) : undefined,
    dominantACSSystems: p.dominantACSSystems ? safeParseArray(p.dominantACSSystems) : undefined,
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
    ispsRiskLevel: (t.ispsRiskLevel || "Low") as ISPSRiskLevel,
    notes: t.notes || undefined,
    operatorGroup: t.operatorGroup || undefined,
    ownership: t.ownership || undefined,
    lastDeepResearchAt: t.lastDeepResearchAt ? t.lastDeepResearchAt.toISOString() : null,
    lastDeepResearchSummary: t.lastDeepResearchSummary || undefined,
    lastDeepResearchReport: t.lastDeepResearchReport || undefined,
  }));

  return { clusters, ports, terminals };
}

export default async function Home() {
  try {
    const { clusters, ports, terminals } = await getData();
    
    // #region agent log
    logDebug('app/page.tsx:95', 'About to render Dashboard', {
      clustersCount: clusters.length,
      portsCount: ports.length,
      terminalsCount: terminals.length,
      firstPortKeys: ports[0] ? Object.keys(ports[0]) : [],
      firstTerminalKeys: terminals[0] ? Object.keys(terminals[0]) : []
    }, 'H');
    // #endregion

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
    // #region agent log
    logDebug('app/page.tsx:110', 'Error in Home component', {errorMessage, errorStack: errorStack?.substring(0, 500)}, 'F');
    // #endregion
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
