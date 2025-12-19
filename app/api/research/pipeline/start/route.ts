import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { queuePortResearchJobs, processJobQueue } from '@/lib/research-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { clusterId, portIds } = body;

        if (!clusterId) {
            return new Response(JSON.stringify({ error: 'clusterId is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Verify cluster exists
        const cluster = await prisma.cluster.findUnique({
            where: { id: clusterId }
        });

        if (!cluster) {
            return new Response(JSON.stringify({ error: 'Cluster not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Queue port research jobs
        const jobIds = await queuePortResearchJobs(clusterId, portIds);

        // Start processing in background (non-blocking)
        processJobQueue().catch(error => {
            console.error('Error processing job queue:', error);
        });

        return new Response(JSON.stringify({
            success: true,
            message: `Started research pipeline for ${jobIds.length} port(s)`,
            jobIds,
            clusterId
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({
            error: 'Failed to start pipeline',
            message: errorMessage
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}



