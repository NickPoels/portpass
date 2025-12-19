import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const clusterId = searchParams.get('clusterId');
        const pipelineId = searchParams.get('pipelineId'); // For future use

        if (!clusterId && !pipelineId) {
            return new Response(JSON.stringify({ error: 'clusterId or pipelineId is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Get all jobs for this cluster
        const where: any = {};
        if (clusterId) {
            where.clusterId = clusterId;
        }

        const jobs = await prisma.researchJob.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        // Get operator proposals count
        const operatorProposals = await prisma.terminalOperatorProposal.findMany({
            where: {
                port: clusterId ? { clusterId } : undefined,
                status: 'pending'
            }
        });

        // Calculate statistics
        const stats = {
            total: jobs.length,
            pending: jobs.filter(j => j.status === 'pending').length,
            running: jobs.filter(j => j.status === 'running').length,
            completed: jobs.filter(j => j.status === 'completed').length,
            failed: jobs.filter(j => j.status === 'failed').length,
            cancelled: jobs.filter(j => j.status === 'cancelled').length,
        };

        const avgProgress = jobs.length > 0
            ? Math.round(jobs.reduce((sum, j) => sum + j.progress, 0) / jobs.length)
            : 0;

        return new Response(JSON.stringify({
            jobs,
            stats,
            avgProgress,
            operatorProposalsCount: operatorProposals.length,
            operatorProposals: operatorProposals
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({
            error: 'Failed to get pipeline status',
            message: errorMessage
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}



