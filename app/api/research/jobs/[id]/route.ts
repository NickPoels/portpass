import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const jobId = params.id;

        const job = await prisma.researchJob.findUnique({
            where: { id: jobId }
        });

        if (!job) {
            return new Response(JSON.stringify({ error: 'Job not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response(JSON.stringify({
            id: job.id,
            type: job.type,
            entityId: job.entityId,
            status: job.status,
            progress: job.progress,
            error: job.error,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            createdAt: job.createdAt
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({
            error: 'Failed to get job status',
            message: errorMessage
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

