import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { queueTerminalOperatorResearchJob, processJobQueue } from '@/lib/research-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const operatorId = params.id;

        // Verify operator exists
        const operator = await prisma.terminalOperator.findUnique({
            where: { id: operatorId }
        });

        if (!operator) {
            return new Response(JSON.stringify({ error: 'Terminal operator not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Check if there's already a pending or running job for this operator
        const existingJob = await prisma.researchJob.findFirst({
            where: {
                type: 'terminal_operator',
                entityId: operatorId,
                status: { in: ['pending', 'running'] }
            },
            orderBy: { createdAt: 'desc' }
        });

        if (existingJob) {
            return new Response(JSON.stringify({
                jobId: existingJob.id,
                status: existingJob.status,
                message: 'Research job already exists for this terminal operator'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Clear old research report before starting new research
        await prisma.terminalOperator.update({
            where: { id: operatorId },
            data: { 
                lastDeepResearchReport: null,
                lastDeepResearchAt: null
            }
        });
        console.log(`[Deep Research Start] Cleared old research report for operator ${operatorId}`);

        // Create a new research job
        const jobId = await queueTerminalOperatorResearchJob(operatorId);

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
