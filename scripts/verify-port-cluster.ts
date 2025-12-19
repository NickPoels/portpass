import { PrismaClient } from '@prisma/client';
import portsData from '../data/ports.json';
import clustersData from '../data/clusters.json';

const prisma = new PrismaClient();

interface Port {
    id: string;
    name: string;
    country: string;
    clusterId: string;
    description?: string;
}

interface Cluster {
    id: string;
    name: string;
    countries: string[];
    priorityTier: number;
    description: string;
}

async function verifySeedFiles() {
    console.log('\n=== VERIFYING SEED FILES ===\n');
    
    const ports = portsData as Port[];
    const clusters = clustersData as Cluster[];
    
    // Get valid cluster IDs
    const validClusterIds = new Set(clusters.map(c => c.id));
    
    // Track port IDs and their cluster assignments
    const portClusterMap = new Map<string, string>();
    const duplicatePortIds: string[] = [];
    const portsWithoutCluster: Port[] = [];
    const portsWithInvalidCluster: Port[] = [];
    const clusterPortCounts = new Map<string, number>();
    
    // Verify each port
    for (const port of ports) {
        // Check for duplicate port IDs
        if (portClusterMap.has(port.id)) {
            duplicatePortIds.push(port.id);
            continue;
        }
        
        // Check if port has clusterId
        if (!port.clusterId) {
            portsWithoutCluster.push(port);
            continue;
        }
        
        // Check if clusterId is valid
        if (!validClusterIds.has(port.clusterId)) {
            portsWithInvalidCluster.push(port);
            continue;
        }
        
        // Track port-cluster assignment
        portClusterMap.set(port.id, port.clusterId);
        
        // Count ports per cluster
        const count = clusterPortCounts.get(port.clusterId) || 0;
        clusterPortCounts.set(port.clusterId, count + 1);
    }
    
    // Report results
    console.log(`Total ports in seed file: ${ports.length}`);
    console.log(`Total clusters in seed file: ${clusters.length}\n`);
    
    if (duplicatePortIds.length > 0) {
        console.log(`❌ ERROR: Found ${duplicatePortIds.length} duplicate port ID(s):`);
        duplicatePortIds.forEach(id => console.log(`   - ${id}`));
    } else {
        console.log('✓ No duplicate port IDs found');
    }
    
    if (portsWithoutCluster.length > 0) {
        console.log(`❌ ERROR: Found ${portsWithoutCluster.length} port(s) without clusterId:`);
        portsWithoutCluster.forEach(p => console.log(`   - ${p.id} (${p.name})`));
    } else {
        console.log('✓ All ports have a clusterId');
    }
    
    if (portsWithInvalidCluster.length > 0) {
        console.log(`❌ ERROR: Found ${portsWithInvalidCluster.length} port(s) with invalid clusterId:`);
        portsWithInvalidCluster.forEach(p => console.log(`   - ${p.id} (${p.name}): ${p.clusterId}`));
    } else {
        console.log('✓ All clusterIds are valid');
    }
    
    console.log('\n--- Ports per Cluster (Seed Files) ---');
    const sortedClusters = Array.from(clusterPortCounts.entries())
        .sort((a, b) => b[1] - a[1]);
    
    for (const [clusterId, count] of sortedClusters) {
        const cluster = clusters.find(c => c.id === clusterId);
        console.log(`  ${clusterId}: ${count} port(s) ${cluster ? `(${cluster.name})` : ''}`);
    }
    
    const allValid = duplicatePortIds.length === 0 && 
                     portsWithoutCluster.length === 0 && 
                     portsWithInvalidCluster.length === 0;
    
    return { allValid, portClusterMap, clusterPortCounts };
}

async function verifyDatabase() {
    console.log('\n\n=== VERIFYING DATABASE ===\n');
    
    try {
        // Get all ports with their clusters
        const ports = await prisma.port.findMany({
            include: { cluster: true },
            orderBy: { clusterId: 'asc' }
        });
        
        // Get all clusters
        const clusters = await prisma.cluster.findMany({
            include: { ports: true }
        });
        
        console.log(`Total ports in database: ${ports.length}`);
        console.log(`Total clusters in database: ${clusters.length}\n`);
        
        // Check for ports without cluster
        const portsWithoutCluster = ports.filter(p => !p.clusterId || !p.cluster);
        if (portsWithoutCluster.length > 0) {
            console.log(`❌ ERROR: Found ${portsWithoutCluster.length} port(s) without cluster in database:`);
            portsWithoutCluster.forEach(p => console.log(`   - ${p.id} (${p.name})`));
        } else {
            console.log('✓ All ports in database have a valid cluster');
        }
        
        // Count ports per cluster
        console.log('\n--- Ports per Cluster (Database) ---');
        const dbClusterCounts = new Map<string, number>();
        
        for (const cluster of clusters) {
            const count = cluster.ports.length;
            dbClusterCounts.set(cluster.id, count);
            console.log(`  ${cluster.id}: ${count} port(s) (${cluster.name})`);
        }
        
        // Check for ports not in any cluster (shouldn't happen due to FK, but check anyway)
        const orphanedPorts = ports.filter(p => !p.cluster);
        if (orphanedPorts.length > 0) {
            console.log(`\n❌ ERROR: Found ${orphanedPorts.length} orphaned port(s) (cluster FK missing):`);
            orphanedPorts.forEach(p => console.log(`   - ${p.id} (${p.name})`));
        }
        
        return { allValid: portsWithoutCluster.length === 0 && orphanedPorts.length === 0, dbClusterCounts };
    } catch (error) {
        console.error('❌ Error querying database:', error);
        return { allValid: false, dbClusterCounts: new Map() };
    }
}

async function compareSeedAndDatabase(seedPortClusterMap: Map<string, string>, seedClusterCounts: Map<string, number>, dbClusterCounts: Map<string, number>) {
    console.log('\n\n=== COMPARING SEED FILES AND DATABASE ===\n');
    
    try {
        const dbPorts = await prisma.port.findMany({
            include: { cluster: true }
        });
        
        const mismatches: Array<{ portId: string; portName: string; seedCluster: string; dbCluster: string }> = [];
        
        for (const dbPort of dbPorts) {
            const seedCluster = seedPortClusterMap.get(dbPort.id);
            const dbCluster = dbPort.clusterId;
            
            if (seedCluster && seedCluster !== dbCluster) {
                mismatches.push({
                    portId: dbPort.id,
                    portName: dbPort.name,
                    seedCluster,
                    dbCluster
                });
            }
        }
        
        if (mismatches.length > 0) {
            console.log(`❌ ERROR: Found ${mismatches.length} port(s) with mismatched cluster assignments:`);
            mismatches.forEach(m => {
                console.log(`   - ${m.portId} (${m.portName}):`);
                console.log(`     Seed file: ${m.seedCluster}`);
                console.log(`     Database: ${m.dbCluster}`);
            });
        } else {
            console.log('✓ Seed files and database are in sync');
        }
        
        // Compare cluster counts
        console.log('\n--- Cluster Count Comparison ---');
        const allClusterIds = new Set([...seedClusterCounts.keys(), ...dbClusterCounts.keys()]);
        let countMismatches = 0;
        
        for (const clusterId of allClusterIds) {
            const seedCount = seedClusterCounts.get(clusterId) || 0;
            const dbCount = dbClusterCounts.get(clusterId) || 0;
            
            if (seedCount !== dbCount) {
                countMismatches++;
                console.log(`❌ ${clusterId}: Seed=${seedCount}, DB=${dbCount}`);
            } else {
                console.log(`✓ ${clusterId}: ${seedCount} ports`);
            }
        }
        
        return mismatches.length === 0 && countMismatches === 0;
    } catch (error) {
        console.error('❌ Error comparing seed and database:', error);
        return false;
    }
}

async function main() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║   Port-Cluster Verification: One Port - One Cluster      ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    
    const seedResults = await verifySeedFiles();
    const dbResults = await verifyDatabase();
    const comparisonResults = await compareSeedAndDatabase(
        seedResults.portClusterMap,
        seedResults.clusterPortCounts,
        dbResults.dbClusterCounts
    );
    
    console.log('\n\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║                      FINAL SUMMARY                        ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    
    const allValid = seedResults.allValid && dbResults.allValid && comparisonResults;
    
    if (allValid) {
        console.log('✅ SUCCESS: All verifications passed!');
        console.log('   ✓ Seed files are valid');
        console.log('   ✓ Database is valid');
        console.log('   ✓ Seed files and database are in sync');
        console.log('   ✓ One port - one cluster requirement is satisfied');
    } else {
        console.log('❌ FAILURE: Some verifications failed. Please review the errors above.');
        process.exit(1);
    }
}

main()
    .catch((e) => {
        console.error('\n❌ Fatal error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

