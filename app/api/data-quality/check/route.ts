import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ValidationResult {
    passed: boolean;
    errors: Array<{ id: string; name: string; message: string }>;
    warnings: Array<{ id: string; name: string; message: string }>;
}

interface DataQualityCheckResult {
    overallStatus: 'pass' | 'fail';
    statistics: {
        totalClusters: number;
        totalPorts: number;
        totalTerminals: number;
    };
    portClusterCheck: ValidationResult & {
        portsPerCluster: Array<{ clusterId: string; clusterName: string; portCount: number }>;
    };
    terminalPortCheck: ValidationResult & {
        terminalsPerPort: Array<{ portId: string; portName: string; terminalCount: number }>;
    };
}

// GET: Run data quality checks
export async function GET(request: NextRequest) {
    try {
        // Get all clusters
        const clusters = await prisma.cluster.findMany({
            include: { ports: true },
            orderBy: { id: 'asc' }
        });

        // Get all ports with their clusters
        const ports = await prisma.port.findMany({
            include: { 
                cluster: true,
                terminals: true
            },
            orderBy: { clusterId: 'asc' }
        });

        // Get all terminals with their ports
        const terminals = await prisma.terminal.findMany({
            include: { port: true },
            orderBy: { portId: 'asc' }
        });

        // Validate: One Port Per Cluster
        const portClusterErrors: Array<{ id: string; name: string; message: string }> = [];
        const portClusterWarnings: Array<{ id: string; name: string; message: string }> = [];
        const portsPerCluster = new Map<string, { clusterName: string; portCount: number }>();

        for (const port of ports) {
            // Check if port has clusterId
            if (!port.clusterId) {
                portClusterErrors.push({
                    id: port.id,
                    name: port.name,
                    message: 'Port does not have a clusterId assigned'
                });
                continue;
            }

            // Check if cluster exists
            if (!port.cluster) {
                portClusterErrors.push({
                    id: port.id,
                    name: port.name,
                    message: `Port references invalid clusterId: ${port.clusterId}`
                });
                continue;
            }

            // Count ports per cluster
            const existing = portsPerCluster.get(port.clusterId);
            if (existing) {
                existing.portCount++;
            } else {
                portsPerCluster.set(port.clusterId, {
                    clusterName: port.cluster.name,
                    portCount: 1
                });
            }
        }

        // Convert portsPerCluster map to array
        const portsPerClusterArray = Array.from(portsPerCluster.entries()).map(([clusterId, data]) => ({
            clusterId,
            clusterName: data.clusterName,
            portCount: data.portCount
        })).sort((a, b) => b.portCount - a.portCount);

        // Validate: One Terminal Per Port
        const terminalPortErrors: Array<{ id: string; name: string; message: string }> = [];
        const terminalPortWarnings: Array<{ id: string; name: string; message: string }> = [];
        const terminalsPerPort = new Map<string, { portName: string; terminalCount: number }>();

        for (const terminal of terminals) {
            // Check if terminal has portId
            if (!terminal.portId) {
                terminalPortErrors.push({
                    id: terminal.id,
                    name: terminal.name,
                    message: 'Terminal does not have a portId assigned'
                });
                continue;
            }

            // Check if port exists
            if (!terminal.port) {
                terminalPortErrors.push({
                    id: terminal.id,
                    name: terminal.name,
                    message: `Terminal references invalid portId: ${terminal.portId}`
                });
                continue;
            }

            // Count terminals per port
            const existing = terminalsPerPort.get(terminal.portId);
            if (existing) {
                existing.terminalCount++;
            } else {
                terminalsPerPort.set(terminal.portId, {
                    portName: terminal.port.name,
                    terminalCount: 1
                });
            }
        }

        // Convert terminalsPerPort map to array
        const terminalsPerPortArray = Array.from(terminalsPerPort.entries()).map(([portId, data]) => ({
            portId,
            portName: data.portName,
            terminalCount: data.terminalCount
        })).sort((a, b) => b.terminalCount - a.terminalCount);

        // Build result
        const portClusterCheck: ValidationResult & { portsPerCluster: typeof portsPerClusterArray } = {
            passed: portClusterErrors.length === 0 && portClusterWarnings.length === 0,
            errors: portClusterErrors,
            warnings: portClusterWarnings,
            portsPerCluster: portsPerClusterArray
        };

        const terminalPortCheck: ValidationResult & { terminalsPerPort: typeof terminalsPerPortArray } = {
            passed: terminalPortErrors.length === 0 && terminalPortWarnings.length === 0,
            errors: terminalPortErrors,
            warnings: terminalPortWarnings,
            terminalsPerPort: terminalsPerPortArray
        };

        const result: DataQualityCheckResult = {
            overallStatus: portClusterCheck.passed && terminalPortCheck.passed ? 'pass' : 'fail',
            statistics: {
                totalClusters: clusters.length,
                totalPorts: ports.length,
                totalTerminals: terminals.length
            },
            portClusterCheck,
            terminalPortCheck
        };

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({
            error: 'Failed to run data quality check',
            message: errorMessage
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

