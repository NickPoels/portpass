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
        totalOperators: number;
    };
    portClusterCheck: ValidationResult & {
        portsPerCluster: Array<{ clusterId: string; clusterName: string; portCount: number }>;
    };
    operatorPortCheck: ValidationResult & {
        operatorsPerPort: Array<{ portId: string; portName: string; operatorCount: number }>;
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
                terminalOperators: true
            },
            orderBy: { clusterId: 'asc' }
        });

        // Get all operators with their ports
        const operators = await prisma.terminalOperator.findMany({
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

        // Validate: Operators Per Port
        const operatorPortErrors: Array<{ id: string; name: string; message: string }> = [];
        const operatorPortWarnings: Array<{ id: string; name: string; message: string }> = [];
        const operatorsPerPort = new Map<string, { portName: string; operatorCount: number }>();

        for (const operator of operators) {
            // Check if operator has portId
            if (!operator.portId) {
                operatorPortErrors.push({
                    id: operator.id,
                    name: operator.name,
                    message: 'Operator does not have a portId assigned'
                });
                continue;
            }

            // Check if port exists
            if (!operator.port) {
                operatorPortErrors.push({
                    id: operator.id,
                    name: operator.name,
                    message: `Operator references invalid portId: ${operator.portId}`
                });
                continue;
            }

            // Count operators per port
            const existing = operatorsPerPort.get(operator.portId);
            if (existing) {
                existing.operatorCount++;
            } else {
                operatorsPerPort.set(operator.portId, {
                    portName: operator.port.name,
                    operatorCount: 1
                });
            }
        }

        // Convert operatorsPerPort map to array
        const operatorsPerPortArray = Array.from(operatorsPerPort.entries()).map(([portId, data]) => ({
            portId,
            portName: data.portName,
            operatorCount: data.operatorCount
        })).sort((a, b) => b.operatorCount - a.operatorCount);

        // Build result
        const portClusterCheck: ValidationResult & { portsPerCluster: typeof portsPerClusterArray } = {
            passed: portClusterErrors.length === 0 && portClusterWarnings.length === 0,
            errors: portClusterErrors,
            warnings: portClusterWarnings,
            portsPerCluster: portsPerClusterArray
        };

        const operatorPortCheck: ValidationResult & { operatorsPerPort: typeof operatorsPerPortArray } = {
            passed: operatorPortErrors.length === 0 && operatorPortWarnings.length === 0,
            errors: operatorPortErrors,
            warnings: operatorPortWarnings,
            operatorsPerPort: operatorsPerPortArray
        };

        const result: DataQualityCheckResult = {
            overallStatus: portClusterCheck.passed && operatorPortCheck.passed ? 'pass' : 'fail',
            statistics: {
                totalClusters: clusters.length,
                totalPorts: ports.length,
                totalOperators: operators.length
            },
            portClusterCheck,
            operatorPortCheck
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

