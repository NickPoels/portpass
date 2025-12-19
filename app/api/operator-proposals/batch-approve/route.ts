import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { geocodeTerminal } from '@/lib/geocoding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { proposalIds, action } = body; // action: "approve" | "reject"

        if (!Array.isArray(proposalIds) || proposalIds.length === 0) {
            return new Response(JSON.stringify({ error: 'proposalIds array is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!action || !['approve', 'reject'].includes(action)) {
            return new Response(JSON.stringify({ error: 'action must be "approve" or "reject"' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Get proposals
        const proposals = await prisma.terminalOperatorProposal.findMany({
            where: { id: { in: proposalIds } },
            include: { port: true }
        });

        if (proposals.length === 0) {
            return new Response(JSON.stringify({ error: 'No proposals found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const updateData: any = {
            status: action === 'approve' ? 'approved' : 'rejected'
        };

        if (action === 'approve') {
            updateData.approvedAt = new Date();
        }

        // Update proposals
        await prisma.terminalOperatorProposal.updateMany({
            where: { id: { in: proposalIds } },
            data: updateData
        });

        let createdOperators: string[] = [];

        if (action === 'approve') {
            // Create operators from approved proposals
            for (const proposal of proposals) {
                // Generate operator ID
                const operatorId = `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                // Coordinate resolution strategy
                let latitude: number | null = proposal.latitude;
                let longitude: number | null = proposal.longitude;
                let coordinateSource = 'proposal';
                
                // Validate coordinates if present
                if (latitude !== null && longitude !== null) {
                    if (isNaN(latitude) || isNaN(longitude) || 
                        latitude < -90 || latitude > 90 || 
                        longitude < -180 || longitude > 180) {
                        latitude = null;
                        longitude = null;
                    }
                }
                
                // Try geocoding if coordinates are missing or invalid
                if (!latitude || !longitude) {
                    try {
                        const geocoded = await geocodeTerminal(
                            proposal.name,
                            proposal.port.name,
                            proposal.port.country,
                            null
                        );
                        
                        if (geocoded) {
                            latitude = geocoded.latitude;
                            longitude = geocoded.longitude;
                            coordinateSource = 'geocoded from operator name';
                        }
                    } catch (geocodeError) {
                        console.warn(`Geocoding failed for proposal ${proposal.id}:`, geocodeError);
                    }
                }
                
                // Fall back to port average if still no coordinates
                if (!latitude || !longitude) {
                    const portOperators = await prisma.terminalOperator.findMany({
                        where: { portId: proposal.portId }
                    });
                    
                    if (portOperators.length > 0 && portOperators[0].latitude && portOperators[0].longitude) {
                        const validOps = portOperators.filter(o => o.latitude && o.longitude);
                        if (validOps.length > 0) {
                            latitude = validOps.reduce((sum, o) => sum + o.latitude!, 0) / validOps.length;
                            longitude = validOps.reduce((sum, o) => sum + o.longitude!, 0) / validOps.length;
                            coordinateSource = 'port average';
                        }
                    }
                }
                
                // Safety check - ensure we have valid coordinates
                if (latitude === null || longitude === null || 
                    isNaN(latitude) || isNaN(longitude)) {
                    // Use port coordinates or Europe center
                    latitude = proposal.port.latitude || 50.0;
                    longitude = proposal.port.longitude || 10.0;
                    coordinateSource = 'port/default';
                }

                // Parse JSON fields
                const cargoTypes = proposal.cargoTypes ? JSON.parse(proposal.cargoTypes) : [];
                const parentCompanies = proposal.parentCompanies ? JSON.parse(proposal.parentCompanies) : null;
                const locations = proposal.locations ? JSON.parse(proposal.locations) : null;

                const operator = await prisma.terminalOperator.create({
                    data: {
                        id: operatorId,
                        name: proposal.name,
                        portId: proposal.portId,
                        operatorType: proposal.operatorType || 'commercial',
                        parentCompanies: parentCompanies ? JSON.stringify(parentCompanies) : null,
                        capacity: proposal.capacity,
                        cargoTypes: JSON.stringify(cargoTypes),
                        latitude,
                        longitude,
                        locations: locations ? JSON.stringify(locations) : null,
                        strategicNotes: `Created from operator proposal. Coordinates ${coordinateSource}.`
                    }
                });

                createdOperators.push(operator.id);
            }

            revalidatePath('/');
        }

        return new Response(JSON.stringify({
            success: true,
            message: `${action === 'approve' ? 'Approved' : 'Rejected'} ${proposals.length} proposal(s)`,
            approvedCount: action === 'approve' ? proposals.length : 0,
            rejectedCount: action === 'reject' ? proposals.length : 0,
            createdOperators
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({
            error: 'Failed to process proposals',
            message: errorMessage
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
