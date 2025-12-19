import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const operatorId = params.id;
        const body = await request.json();
        const { data_to_update, approved_fields } = body;

        if (!data_to_update) {
            return new Response(JSON.stringify({ error: 'Missing data_to_update in request body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Validate operator exists
        const operator = await prisma.terminalOperator.findUnique({
            where: { id: operatorId },
            include: { port: true },
        });

        if (!operator) {
            return new Response(JSON.stringify({ error: 'Terminal operator not found' }), {
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
        if (approved_fields && Array.isArray(approved_fields)) {
            if (approved_fields.includes('operatorType') && data_to_update.operatorType !== undefined) {
                updateData.operatorType = data_to_update.operatorType;
            }
            if (approved_fields.includes('parentCompanies') && data_to_update.parentCompanies !== undefined) {
                updateData.parentCompanies = Array.isArray(data_to_update.parentCompanies) 
                    ? JSON.stringify(data_to_update.parentCompanies) 
                    : data_to_update.parentCompanies;
            }
            if (approved_fields.includes('capacity') && data_to_update.capacity !== undefined) {
                updateData.capacity = data_to_update.capacity;
            }
            if (approved_fields.includes('cargoTypes') && data_to_update.cargoTypes !== undefined) {
                updateData.cargoTypes = Array.isArray(data_to_update.cargoTypes) 
                    ? JSON.stringify(data_to_update.cargoTypes) 
                    : data_to_update.cargoTypes;
            }
            if (approved_fields.includes('coordinates') || (approved_fields.includes('latitude') && approved_fields.includes('longitude'))) {
                if (data_to_update.latitude !== undefined) updateData.latitude = data_to_update.latitude;
                if (data_to_update.longitude !== undefined) updateData.longitude = data_to_update.longitude;
            }
            if (approved_fields.includes('locations') && data_to_update.locations !== undefined) {
                updateData.locations = Array.isArray(data_to_update.locations) 
                    ? JSON.stringify(data_to_update.locations) 
                    : data_to_update.locations;
            }
            if (approved_fields.includes('strategicNotes') && data_to_update.strategicNotes !== undefined) {
                updateData.strategicNotes = data_to_update.strategicNotes;
            }
            if (approved_fields.includes('portId') && data_to_update.portId !== undefined) {
                updateData.portId = data_to_update.portId;
            }
        } else {
            // Fallback: apply all provided fields (backward compatibility)
            if (data_to_update.operatorType !== undefined) updateData.operatorType = data_to_update.operatorType;
            if (data_to_update.parentCompanies !== undefined) {
                updateData.parentCompanies = Array.isArray(data_to_update.parentCompanies) 
                    ? JSON.stringify(data_to_update.parentCompanies) 
                    : data_to_update.parentCompanies;
            }
            if (data_to_update.capacity !== undefined) updateData.capacity = data_to_update.capacity;
            if (data_to_update.cargoTypes !== undefined) {
                updateData.cargoTypes = Array.isArray(data_to_update.cargoTypes) 
                    ? JSON.stringify(data_to_update.cargoTypes) 
                    : data_to_update.cargoTypes;
            }
            if (data_to_update.latitude !== undefined) updateData.latitude = data_to_update.latitude;
            if (data_to_update.longitude !== undefined) updateData.longitude = data_to_update.longitude;
            if (data_to_update.locations !== undefined) {
                updateData.locations = Array.isArray(data_to_update.locations) 
                    ? JSON.stringify(data_to_update.locations) 
                    : data_to_update.locations;
            }
            if (data_to_update.strategicNotes !== undefined) updateData.strategicNotes = data_to_update.strategicNotes;
            if (data_to_update.portId !== undefined) updateData.portId = data_to_update.portId;
        }

        // Apply the changes
        const updatedOperator = await prisma.terminalOperator.update({
            where: { id: operatorId },
            data: updateData,
        });

        return new Response(JSON.stringify({ operator: updatedOperator }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
