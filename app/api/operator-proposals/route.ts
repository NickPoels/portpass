import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET: List proposals
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const portId = searchParams.get('portId');
        const clusterId = searchParams.get('clusterId');
        const status = searchParams.get('status');

        const where: any = {};
        if (portId) where.portId = portId;
        if (status) where.status = status;
        if (clusterId) {
            where.port = { clusterId };
        }

        const proposals = await prisma.terminalOperatorProposal.findMany({
            where,
            include: {
                port: {
                    include: {
                        cluster: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        return new Response(JSON.stringify(proposals), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({
            error: 'Failed to fetch proposals',
            message: errorMessage
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

// POST: Create proposal (for manual entry)
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { portId, name, operatorType, parentCompanies, capacity, cargoTypes, latitude, longitude, locations } = body;

        if (!portId || !name) {
            return new Response(JSON.stringify({ error: 'portId and name are required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const proposal = await prisma.terminalOperatorProposal.create({
            data: {
                portId,
                name,
                operatorType: operatorType || null,
                parentCompanies: parentCompanies ? JSON.stringify(parentCompanies) : null,
                capacity: capacity || null,
                cargoTypes: cargoTypes ? JSON.stringify(cargoTypes) : null,
                latitude: latitude || null,
                longitude: longitude || null,
                locations: locations ? JSON.stringify(locations) : null,
                status: 'pending'
            },
            include: {
                port: true
            }
        });

        return new Response(JSON.stringify(proposal), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({
            error: 'Failed to create proposal',
            message: errorMessage
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

// PATCH: Update proposal status
export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, status } = body;

        if (!id || !status) {
            return new Response(JSON.stringify({ error: 'id and status are required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const updateData: any = { status };
        if (status === 'approved') {
            updateData.approvedAt = new Date();
        }

        const proposal = await prisma.terminalOperatorProposal.update({
            where: { id },
            data: updateData,
            include: {
                port: true
            }
        });

        return new Response(JSON.stringify(proposal), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({
            error: 'Failed to update proposal',
            message: errorMessage
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

// DELETE: Remove proposal
export async function DELETE(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const id = searchParams.get('id');

        if (!id) {
            return new Response(JSON.stringify({ error: 'id is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        await prisma.terminalOperatorProposal.delete({
            where: { id }
        });

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({
            error: 'Failed to delete proposal',
            message: errorMessage
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
