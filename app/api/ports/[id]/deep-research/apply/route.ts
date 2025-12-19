import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import OpenAI from 'openai';
import { geocodePort } from '@/lib/geocoding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const portId = params.id;
        const body = await request.json();
        const { data_to_update, approved_fields } = body;

        if (!data_to_update) {
            return new Response(JSON.stringify({ error: 'Missing data_to_update in request body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Validate port exists
        const port = await prisma.port.findUnique({
            where: { id: portId },
        });

        if (!port) {
            return new Response(JSON.stringify({ error: 'Port not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Build update data - only include approved fields
        const updateData: any = {
            lastDeepResearchAt: data_to_update.lastDeepResearchAt ? new Date(data_to_update.lastDeepResearchAt) : new Date(),
            lastDeepResearchSummary: data_to_update.lastDeepResearchSummary || '',
        };

        // Only apply fields that are in approved_fields array
        const approvedFieldsSet = new Set(approved_fields || []);

        if (approvedFieldsSet.has('portAuthority') && data_to_update.portAuthority !== undefined) {
            updateData.portAuthority = data_to_update.portAuthority;
        }
        if (approvedFieldsSet.has('identityCompetitors') && data_to_update.identityCompetitors !== undefined) {
            updateData.identityCompetitors = data_to_update.identityCompetitors; // Already JSON string
        }
        if (approvedFieldsSet.has('identityAdoptionRate') && data_to_update.identityAdoptionRate !== undefined) {
            updateData.identityAdoptionRate = data_to_update.identityAdoptionRate;
        }
        if (approvedFieldsSet.has('portLevelISPSRisk') && data_to_update.portLevelISPSRisk !== undefined) {
            updateData.portLevelISPSRisk = data_to_update.portLevelISPSRisk;
        }
        if (approvedFieldsSet.has('ispsEnforcementStrength') && data_to_update.ispsEnforcementStrength !== undefined) {
            updateData.ispsEnforcementStrength = data_to_update.ispsEnforcementStrength;
        }
        if (approvedFieldsSet.has('strategicNotes') && data_to_update.strategicNotes !== undefined) {
            updateData.strategicNotes = data_to_update.strategicNotes;
        }
        if (approvedFieldsSet.has('latitude') && data_to_update.latitude !== undefined) {
            updateData.latitude = data_to_update.latitude;
        }
        if (approvedFieldsSet.has('longitude') && data_to_update.longitude !== undefined) {
            updateData.longitude = data_to_update.longitude;
        }
        // Handle location as a combined field
        if (approvedFieldsSet.has('location') && data_to_update.latitude !== undefined && data_to_update.longitude !== undefined) {
            updateData.latitude = data_to_update.latitude;
            updateData.longitude = data_to_update.longitude;
        }

        // Update port with approved fields
        await prisma.port.update({
            where: { id: portId },
            data: updateData,
        });

        return new Response(JSON.stringify({ 
            success: true,
            message: 'Port updated successfully',
            updatedFields: Array.from(approvedFieldsSet)
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ 
            error: 'Failed to update port',
            message: errorMessage
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
