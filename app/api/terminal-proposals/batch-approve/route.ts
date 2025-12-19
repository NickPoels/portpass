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
        const proposals = await prisma.terminalProposal.findMany({
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
        await prisma.terminalProposal.updateMany({
            where: { id: { in: proposalIds } },
            data: updateData
        });

        let createdTerminals: string[] = [];

        if (action === 'approve') {
            // Create terminals from approved proposals
            for (const proposal of proposals) {
                // Generate terminal ID
                const terminalId = `t-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                // Coordinate resolution strategy:
                // 1. Validate proposal coordinates if present
                // 2. Try geocoding if coordinates missing or invalid
                // 3. Fall back to port average if geocoding fails
                // 4. Only use Europe center as absolute last resort
                
                let latitude: number | null = proposal.latitude;
                let longitude: number | null = proposal.longitude;
                let coordinateSource = 'proposal';
                
                // Validate coordinates if present
                if (latitude !== null && longitude !== null) {
                    if (isNaN(latitude) || isNaN(longitude) || 
                        latitude < -90 || latitude > 90 || 
                        longitude < -180 || longitude > 180) {
                        // Invalid coordinates, reset to null to trigger geocoding
                        latitude = null;
                        longitude = null;
                    }
                }
                
                // Try geocoding if coordinates are missing or invalid
                if (!latitude || !longitude) {
                    try {
                        // Get address from proposal if available (may not exist in schema yet)
                        const address = (proposal as any).address || null;
                        
                        const geocoded = await geocodeTerminal(
                            proposal.name,
                            proposal.port.name,
                            proposal.port.country,
                            address
                        );
                        
                        if (geocoded) {
                            latitude = geocoded.latitude;
                            longitude = geocoded.longitude;
                            coordinateSource = address 
                                ? `geocoded from address: ${address}`
                                : `geocoded from terminal name`;
                        }
                    } catch (geocodeError) {
                        console.warn(`Geocoding failed for proposal ${proposal.id}:`, geocodeError);
                        // Continue to fallback
                    }
                }
                
                // Fall back to port average if still no coordinates
                if (!latitude || !longitude) {
                    const portTerminals = await prisma.terminal.findMany({
                        where: { portId: proposal.portId }
                    });
                    
                    if (portTerminals.length > 0) {
                        latitude = portTerminals.reduce((sum, t) => sum + t.latitude, 0) / portTerminals.length;
                        longitude = portTerminals.reduce((sum, t) => sum + t.longitude, 0) / portTerminals.length;
                        coordinateSource = 'port average';
                    } else {
                        // Absolute last resort: Europe center
                        latitude = 50.0;
                        longitude = 10.0;
                        coordinateSource = 'default (Europe center)';
                    }
                }
                
                // Safety check - should never happen, but ensure we have valid coordinates
                if (latitude === null || longitude === null || 
                    isNaN(latitude) || isNaN(longitude)) {
                    console.error(`Failed to resolve coordinates for proposal ${proposal.id}`);
                    // Use Europe center as emergency fallback
                    latitude = 50.0;
                    longitude = 10.0;
                    coordinateSource = 'emergency fallback';
                }

                const terminal = await prisma.terminal.create({
                    data: {
                        id: terminalId,
                        name: proposal.name,
                        portId: proposal.portId,
                        latitude,
                        longitude,
                        cargoTypes: JSON.stringify([]), // Empty array
                        capacity: null,
                        operatorGroup: null,
                        notes: `Created from terminal proposal. Coordinates ${coordinateSource}.`
                    }
                });

                createdTerminals.push(terminal.id);
            }

            revalidatePath('/');
        }

        return new Response(JSON.stringify({
            success: true,
            message: `${action === 'approve' ? 'Approved' : 'Rejected'} ${proposals.length} proposal(s)`,
            approvedCount: action === 'approve' ? proposals.length : 0,
            rejectedCount: action === 'reject' ? proposals.length : 0,
            createdTerminals
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
