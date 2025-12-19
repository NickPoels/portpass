import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { queuePortResearchJob, processJobQueue } from '@/lib/research-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const portId = params.id;

        // Verify port exists
        const port = await prisma.port.findUnique({
            where: { id: portId }
        });

        if (!port) {
            return new Response(JSON.stringify({ error: 'Port not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Check if there's already a pending or running job for this port
        const existingJob = await prisma.researchJob.findFirst({
            where: {
                type: 'port',
                entityId: portId,
                status: { in: ['pending', 'running'] }
            },
            orderBy: { createdAt: 'desc' }
        });

        if (existingJob) {
            return new Response(JSON.stringify({
                jobId: existingJob.id,
                status: existingJob.status,
                message: 'Research job already exists for this port'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Clear old research report before starting new research
        await prisma.port.update({
            where: { id: portId },
            data: { 
                lastDeepResearchReport: null,
                lastDeepResearchAt: null
            }
        });
        console.log(`[Deep Research Start] Cleared old research report for port ${portId}`);

        // Create a new research job
        console.error(`[DEBUG] ========== CREATING RESEARCH JOB ==========`);
        console.error(`[DEBUG] Port ID: ${portId}`);
        console.log(`[DEBUG] ========== CREATING RESEARCH JOB ==========`);
        console.log(`[DEBUG] Port ID: ${portId}`);
        const jobId = await queuePortResearchJob(portId);
        console.error(`[DEBUG] Job created with ID: ${jobId}`);
        console.log(`[DEBUG] Job created with ID: ${jobId}`);

        // Start processing in background (non-blocking)
        console.error(`[DEBUG] Calling processJobQueue()...`);
        console.log(`[DEBUG] Calling processJobQueue()...`);
        processJobQueue().catch(error => {
            console.error('[DEBUG] Error processing job queue:', error);
        });
        console.error(`[DEBUG] processJobQueue() called (non-blocking)`);
        console.log(`[DEBUG] processJobQueue() called (non-blocking)`);

        return new Response(JSON.stringify({
            success: true,
            jobId,
            message: 'Research job started in background'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({
            error: 'Failed to start research job',
            message: errorMessage
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

