import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { clusterId } = body;

        if (!clusterId) {
            return new Response(JSON.stringify({ error: 'clusterId is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Cancel all pending and running jobs for this cluster
        const result = await prisma.researchJob.updateMany({
            where: {
                clusterId,
                status: { in: ['pending', 'running'] }
            },
            data: {
                status: 'cancelled',
                completedAt: new Date()
            }
        });

        return new Response(JSON.stringify({
            success: true,
            message: `Cancelled ${result.count} job(s)`,
            cancelledCount: result.count
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({
            error: 'Failed to cancel pipeline',
            message: errorMessage
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}



