import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import OpenAI from 'openai';

// Force node runtime for network calls and streaming
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Set max duration to 60s (or more if platform allows) for long research
export const maxDuration = 300;


export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const terminalId = params.id;

    // 1. Validate Terminal
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

    // 2. Set up Streaming Response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendEvent = (event: string, data: unknown) => {
                controller.enqueue(
                    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                );
            };

            try {
                // --- STEP 1: RESEARCH (Perplexity) ---
                sendEvent('status', { message: 'Researching terminal details...', step: 'perplexity' });

                const pplxPrompt = `
Research the port terminal described below. Focus on gathering missing data points.

TERMINAL CONTEXT:
- Name: ${terminal.name}
- Current Port: ${terminal.port.name} (${terminal.port.country})
- Known Cargo: ${terminal.cargoTypes}
- Coordinates: ${terminal.latitude}, ${terminal.longitude}

TASK:
1. Confirm identity and location. If coordinates are (0,0), find the exact Latitude/Longitude.
2. Verify which Port Authority this terminal belongs to.
3. Identify all specific cargo types handled (e.g. "Frozen Fish", "Steel Coils", "Grain" instead of just "General Cargo").
4. Determine ISPS Security Level (1, 2, or 3) and provide a reason/justification.
5. Key Infrastructure: Berth length, draft, crane types.
6. Annual Throughput/Volume estimates (TEU or Tonnage).
7. Operator & Ownership structure.

OUTPUT REQUIREMENTS:
- Be precise with numbers.
- List specific cargo commodities.
- If the terminal actually belongs to a different port (e.g. adjacent port), explicitly state it.
`;

                const pplxRes = await fetch('https://api.perplexity.ai/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.PPLX_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'sonar-deep-research',
                        messages: [
                            { role: 'system', content: 'You are a maritime research assistant.' },
                            { role: 'user', content: pplxPrompt },
                        ],
                        temperature: 0.1,
                    }),
                });

                if (!pplxRes.ok) {
                    throw new Error(`Perplexity API error: ${pplxRes.statusText}`);
                }

                const pplxJson = await pplxRes.json();
                const researchText = pplxJson.choices[0]?.message?.content || '';

                // --- STEP 2: STRUCTURE (OpenAI) ---
                sendEvent('status', { message: 'Structuring & verifying data...', step: 'openai' });

                const structurePrompt = `
You are a Database Update Agent. Parse the research report to update the Terminal record.
Follow these rules strictly:
1. **Latitude/Longitude**: ONLY provide if the current coordinates are notably wrong or (0,0). Otherwise return null.
2. **Port**: If the terminal is clearly in a different port than listed, providing the correct Port Name.
3. **Cargo Types**: Return a flat list of strings for all specific commodities found (e.g. ["Steel", "Reefer", "Project Cargo"]).
4. **ISPS**: Return "High", "Medium", "Low" based on security level (Level 1=Low, 2=Medium, 3=High).
5. **ISPS Reason**: Summarize why this security level is set.

REPORT:
${researchText}

SCHEMA (JSON):
{
  "profile_delta": {
    "official_name": "string | null",
    "operator_group": "string | null",
    "ownership": "string | null",
    "leadership": ["string"] | null,
    "cargo_types": ["string"],
    "infrastructure": "string | null",
    "volumes": "string | null",
    "digitalization_security": "string | null",
    "isps_level": "Low | Medium | High | Very High | null",
    "isps_reason": "string | null",
    "suggested_port_name": "string | null",
    "new_coordinates": { "lat": number, "lon": number } | null
  },
  "research_summary": "string"
}
`;

                const oiRes = await openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: [{ role: 'user', content: structurePrompt }],
                    response_format: { type: 'json_object' },
                });

                const oiJson = JSON.parse(oiRes.choices[0].message.content || '{}');
                const { profile_delta, research_summary } = oiJson;

                // --- STEP 3: LOGIC & SAVE ---
                sendEvent('status', { message: 'Checking existing data...', step: 'saving' });

                // Logic: Only overwrite if empty or explicitly new
                const dataToUpdate: any = {
                    lastDeepResearchAt: new Date(),
                    lastDeepResearchSummary: research_summary || researchText.substring(0, 1000),
                };

                // Basic string fields - update if empty in DB or if we have better data? 
                // Strategy: "Enrich" -> If DB has value, keep it. If DB is null/empty, take AI.
                // Exception: Deep Research fields (officialName, etc) are usually empty initially, so we fill them.
                if (!terminal.officialName && profile_delta.official_name) dataToUpdate.officialName = profile_delta.official_name;
                if (!terminal.operatorGroup && profile_delta.operator_group) dataToUpdate.operatorGroup = profile_delta.operator_group;
                if (!terminal.ownership && profile_delta.ownership) dataToUpdate.ownership = profile_delta.ownership;
                if (!terminal.infrastructure && profile_delta.infrastructure) dataToUpdate.infrastructure = profile_delta.infrastructure;
                if (!terminal.volumes && profile_delta.volumes) dataToUpdate.volumes = profile_delta.volumes;
                if (!terminal.digitalizationSecurity && profile_delta.digitalization_security) dataToUpdate.digitalizationSecurity = profile_delta.digitalization_security;

                // ISPS Logic
                if (!terminal.ispsRiskLevel || terminal.ispsRiskLevel === "Low") {
                    if (profile_delta.isps_level) dataToUpdate.ispsRiskLevel = profile_delta.isps_level;
                }
                // Always add reason if found
                if (profile_delta.isps_reason) dataToUpdate.ispsComplianceReason = profile_delta.isps_reason;

                // JSON Fields
                if (profile_delta.leadership) dataToUpdate.leadership = JSON.stringify(profile_delta.leadership);
                if (profile_delta.cargo_types && profile_delta.cargo_types.length > 0) {
                    // We are moving to dynamic tags. We replace the list with the detailed one found, 
                    // OR we could merge. Let's replace for now as "Deep Research" implies getting the truth.
                    dataToUpdate.cargoTypes = JSON.stringify(profile_delta.cargo_types);
                }

                // Map Logic: Only update if current is 0,0 OR if AI is very confident (we instructed AI to only return if 0,0 or wrong)
                if (profile_delta.new_coordinates) {
                    // Check if current is empty-ish
                    if (Math.abs(terminal.latitude) < 0.01 && Math.abs(terminal.longitude) < 0.01) {
                        dataToUpdate.latitude = profile_delta.new_coordinates.lat;
                        dataToUpdate.longitude = profile_delta.new_coordinates.lon;
                    }
                }

                // Port Logic
                if (profile_delta.suggested_port_name) {
                    // Fuzzy check? For now, we just log it or maybe auto-move if exact match found
                    // Let's try to find an exact match in DB
                    const suggestedPort = await prisma.port.findFirst({
                        where: { name: { contains: profile_delta.suggested_port_name } }
                    });
                    if (suggestedPort && suggestedPort.id !== terminal.portId) {
                        dataToUpdate.portId = suggestedPort.id;
                    }
                }

                const updatedTerminal = await prisma.terminal.update({
                    where: { id: terminalId },
                    data: dataToUpdate,
                });

                // --- COMPLETE ---
                sendEvent('complete', {
                    terminal: updatedTerminal,
                    full_report: researchText,
                    concise_summary: research_summary
                });

                controller.close();
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                sendEvent('error', { message });
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
