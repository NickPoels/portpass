import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const terminalId = params.id;
        const body = await request.json();
        const { data_to_update, approved_fields } = body;

        if (!data_to_update) {
            return new Response(JSON.stringify({ error: 'Missing data_to_update in request body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Validate terminal exists
        const terminal = await prisma.terminal.findUnique({
            where: { id: terminalId },
            include: { port: true },
        });

        if (!terminal) {
            return new Response(JSON.stringify({ error: 'Terminal not found' }), {
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
            if (approved_fields.includes('operatorGroup') && data_to_update.operatorGroup !== undefined) {
                updateData.operatorGroup = data_to_update.operatorGroup;
            }
            if (approved_fields.includes('capacity') && data_to_update.capacity !== undefined) {
                updateData.capacity = data_to_update.capacity;
            }
            if (approved_fields.includes('cargoTypes') && data_to_update.cargoTypes !== undefined) {
                updateData.cargoTypes = data_to_update.cargoTypes;
            }
            if (approved_fields.includes('coordinates') || (approved_fields.includes('latitude') && approved_fields.includes('longitude'))) {
                if (data_to_update.latitude !== undefined) updateData.latitude = data_to_update.latitude;
                if (data_to_update.longitude !== undefined) updateData.longitude = data_to_update.longitude;
            }
            if (approved_fields.includes('portId') && data_to_update.portId !== undefined) {
                updateData.portId = data_to_update.portId;
            }
            if (approved_fields.includes('notes') && data_to_update.notes !== undefined) {
                updateData.notes = data_to_update.notes;
            }
        } else {
            // Fallback: apply all provided fields (backward compatibility)
            if (data_to_update.operatorGroup !== undefined) updateData.operatorGroup = data_to_update.operatorGroup;
            if (data_to_update.capacity !== undefined) updateData.capacity = data_to_update.capacity;
            if (data_to_update.cargoTypes !== undefined) updateData.cargoTypes = data_to_update.cargoTypes;
            if (data_to_update.latitude !== undefined) updateData.latitude = data_to_update.latitude;
            if (data_to_update.longitude !== undefined) updateData.longitude = data_to_update.longitude;
            if (data_to_update.portId !== undefined) updateData.portId = data_to_update.portId;
            if (data_to_update.notes !== undefined) updateData.notes = data_to_update.notes;
        }

        // Apply the changes
        const updatedTerminal = await prisma.terminal.update({
            where: { id: terminalId },
            data: updateData,
        });

        return new Response(JSON.stringify({ terminal: updatedTerminal }), {
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
