import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { queueTerminalResearchJob, processJobQueue } from '@/lib/research-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const terminalId = params.id;

        // Verify terminal exists
        const terminal = await prisma.terminal.findUnique({
            where: { id: terminalId }
        });

        if (!terminal) {
            return new Response(JSON.stringify({ error: 'Terminal not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Check if there's already a pending or running job for this terminal
        const existingJob = await prisma.researchJob.findFirst({
            where: {
                type: 'terminal',
                entityId: terminalId,
                status: { in: ['pending', 'running'] }
            },
            orderBy: { createdAt: 'desc' }
        });

        if (existingJob) {
            return new Response(JSON.stringify({
                jobId: existingJob.id,
                status: existingJob.status,
                message: 'Research job already exists for this terminal'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Clear old research report before starting new research
        await prisma.terminal.update({
            where: { id: terminalId },
            data: { 
                lastDeepResearchReport: null,
                lastDeepResearchAt: null
            }
        });
        console.log(`[Deep Research Start] Cleared old research report for terminal ${terminalId}`);

        // Create a new research job
        const jobId = await queueTerminalResearchJob(terminalId);

        // Start processing in background (non-blocking)
        processJobQueue().catch(error => {
            console.error('Error processing job queue:', error);
        });

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

