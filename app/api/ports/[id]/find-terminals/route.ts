import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import OpenAI from 'openai';
import { geocodeTerminal } from '@/lib/geocoding';
import { executeResearchQuery, getResearchProvider } from '@/lib/research-provider';
import { generateTerminalQueries, TerminalQueryConfig } from '@/lib/terminal-queries';
import { compareTwoStrings } from 'string-similarity';

// Force node runtime for network calls and streaming
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Terminal data structure with additional fields
interface TerminalData {
    name: string;
    latitude: number | null;
    longitude: number | null;
    address: string | null;
    operator?: string | null;
    terminalType?: string | null;
    alternativeNames?: string[];
    capacity?: string | null;
    berthNumbers?: string | null;
    sourceCategory?: string; // Which query found this terminal
}

/**
 * Normalize terminal name for comparison
 */
function normalizeTerminalName(name: string): string {
    return name
        .toLowerCase()
        .replace(/^(port of |port |terminal |term\.? )/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Check if two terminals are similar (fuzzy match)
 */
function areTerminalsSimilar(
    name1: string,
    name2: string,
    terminalType1?: string | null,
    terminalType2?: string | null
): boolean {
    // If terminal types are different and both are specified, they're not duplicates
    if (terminalType1 && terminalType2 && terminalType1 !== terminalType2) {
        return false;
    }

    const normalized1 = normalizeTerminalName(name1);
    const normalized2 = normalizeTerminalName(name2);

    // Exact match after normalization
    if (normalized1 === normalized2) {
        return true;
    }

    // Calculate similarity score
    const similarity = compareTwoStrings(normalized1, normalized2);
    
    // Threshold: 0.85 similarity considered duplicate
    return similarity > 0.85;
}

/**
 * Merge terminals found across multiple queries, prioritizing port authority sources
 */
function mergeTerminalResults(allTerminals: TerminalData[]): TerminalData[] {
    const merged: TerminalData[] = [];
    const processed = new Set<string>();

    // Sort by source priority: port_authority > others
    const sorted = allTerminals.sort((a, b) => {
        if (a.sourceCategory === 'port_authority' && b.sourceCategory !== 'port_authority') return -1;
        if (a.sourceCategory !== 'port_authority' && b.sourceCategory === 'port_authority') return 1;
        return 0;
    });

    for (const terminal of sorted) {
        const normalizedName = normalizeTerminalName(terminal.name);
        
        // Check if we've already processed a similar terminal
        let isDuplicate = false;
        for (const processedTerminal of merged) {
            if (areTerminalsSimilar(
                terminal.name,
                processedTerminal.name,
                terminal.terminalType,
                processedTerminal.terminalType
            )) {
                isDuplicate = true;
                
                // Merge data: keep the most complete version
                if (!processedTerminal.latitude && terminal.latitude) {
                    processedTerminal.latitude = terminal.latitude;
                    processedTerminal.longitude = terminal.longitude;
                }
                if (!processedTerminal.address && terminal.address) {
                    processedTerminal.address = terminal.address;
                }
                if (!processedTerminal.operator && terminal.operator) {
                    processedTerminal.operator = terminal.operator;
                }
                if (!processedTerminal.capacity && terminal.capacity) {
                    processedTerminal.capacity = terminal.capacity;
                }
                if (!processedTerminal.berthNumbers && terminal.berthNumbers) {
                    processedTerminal.berthNumbers = terminal.berthNumbers;
                }
                // Merge alternative names
                if (terminal.alternativeNames && terminal.alternativeNames.length > 0) {
                    if (!processedTerminal.alternativeNames) {
                        processedTerminal.alternativeNames = [];
                    }
                    processedTerminal.alternativeNames.push(...terminal.alternativeNames);
                }
                break;
            }
        }

        if (!isDuplicate) {
            processed.add(normalizedName);
            merged.push(terminal);
        }
    }

    return merged;
}

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    // Validate environment variables early - provider-aware
    const provider = getResearchProvider();
    if (!process.env.OPENAI_API_KEY) {
        return new Response(JSON.stringify({ 
            error: 'OPENAI_API_KEY not configured',
            category: 'API_ERROR',
            message: 'OpenAI API key is required for data extraction and analysis. Please configure OPENAI_API_KEY.',
            retryable: false
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    if (provider === 'perplexity' && !process.env.PPLX_API_KEY) {
        return new Response(JSON.stringify({ 
            error: 'PPLX_API_KEY not configured',
            category: 'API_ERROR',
            message: 'Perplexity API key is required when RESEARCH_PROVIDER=perplexity. Please configure PPLX_API_KEY or set RESEARCH_PROVIDER=openai.',
            retryable: false
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
        return new Response(JSON.stringify({ 
            error: 'OPENAI_API_KEY not configured',
            category: 'API_ERROR',
            message: 'OpenAI API key is required when RESEARCH_PROVIDER=openai. Please configure OPENAI_API_KEY.',
            retryable: false
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const portId = params.id;

    // 1. Validate Port
    const port = await prisma.port.findUnique({
        where: { id: portId },
        include: { cluster: true },
    });

    if (!port) {
        return new Response(JSON.stringify({ error: 'Port not found' }), {
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

            // Check for abort signal
            const abortSignal = request.signal;
            
            try {
                // --- STEP 1: INITIALIZE ---
                sendEvent('status', { message: 'Initializing terminal discovery...', step: 'init', progress: 0 });
                
                if (abortSignal.aborted) {
                    throw new Error('Request aborted');
                }

                // --- STEP 2: GENERATE QUERIES ---
                const queryConfigs = generateTerminalQueries(port.name, port.country);
                sendEvent('status', { 
                    message: `Generated ${queryConfigs.length} terminal discovery queries`, 
                    step: 'init', 
                    progress: 5 
                });

                // --- STEP 3: EXECUTE MULTI-QUERY STRATEGY ---
                sendEvent('status', { message: 'Discovering terminals across multiple categories...', step: 'discovery', progress: 10 });
                
                const queryResults: Array<{
                    config: TerminalQueryConfig;
                    result: { content: string; sources: string[] } | null;
                    error?: string;
                }> = [];

                // Execute queries in parallel with error handling
                const queryPromises = queryConfigs.map(async (config) => {
                    try {
                        sendEvent('status', { 
                            message: `Searching ${config.category} terminals...`, 
                            step: 'discovery', 
                            progress: 10 + (queryConfigs.indexOf(config) * 10),
                            category: config.category
                        });
                        
                        const result = await executeResearchQuery(
                            config.query,
                            `terminal_discovery_${config.category}`,
                            abortSignal,
                            config.systemPrompt,
                            config.model
                        );
                        
                        return { config, result, error: undefined };
                    } catch (error: any) {
                        // Log error but continue with other queries
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        console.warn(`Query failed for ${config.category}:`, errorMessage);
                        return { config, result: null, error: errorMessage };
                    }
                });

                const results = await Promise.all(queryPromises);
                queryResults.push(...results);

                // Filter out failed queries and aggregate successful results
                const successfulQueries = queryResults.filter(q => q.result !== null);
                const failedQueries = queryResults.filter(q => q.result === null);

                if (failedQueries.length > 0) {
                    sendEvent('status', { 
                        message: `Warning: ${failedQueries.length} query(s) failed, continuing with ${successfulQueries.length} successful query(s)...`, 
                        step: 'discovery', 
                        progress: 50,
                        failedCategories: failedQueries.map(q => q.config.category)
                    });
                }

                if (successfulQueries.length === 0) {
                    throw new Error('All terminal discovery queries failed');
                }

                // Combine all research content
                const combinedResearchContent = successfulQueries
                    .map(q => `=== ${q.config.category.toUpperCase()} TERMINALS ===\n${q.result!.content}`)
                    .join('\n\n');

                sendEvent('status', { message: 'Analyzing terminal data from all sources...', step: 'analysis', progress: 60 });

                // --- STEP 4: EXTRACT STRUCTURED DATA ---
                sendEvent('status', { message: 'Extracting terminal information...', step: 'extract', progress: 70 });
                
                const extractPrompt = `
Extract terminal information from the research findings below. Return ONLY the terminals found, use null if not found.

RESEARCH FINDINGS:
${combinedResearchContent}

PORT: ${port.name}, ${port.country}

Return JSON:
{
  "terminals": [
    {
      "name": "string (REQUIRED - exact terminal name)",
      "latitude": "number | null (REQUIRED - decimal degrees, include if available)",
      "longitude": "number | null (REQUIRED - decimal degrees, include if available)",
      "address": "string | null (OPTIONAL - full address or location description if coordinates not available)",
      "operator": "string | null (OPTIONAL - terminal operator/company name)",
      "terminalType": "string | null (OPTIONAL - container, roro, liquid_bulk, dry_bulk, multipurpose, etc.)",
      "alternativeNames": ["string"] | null (OPTIONAL - alternative names or abbreviations),
      "capacity": "string | null (OPTIONAL - capacity information like TEU, tonnage, etc.)",
      "berthNumbers": "string | null (OPTIONAL - berth or quay numbers if coordinates unavailable)"
    }
  ]
}

CRITICAL: 
- Extract ALL terminals mentioned in the research
- Terminal name is REQUIRED for each terminal
- Coordinates (latitude/longitude) are REQUIRED - include if available in research
- Address is OPTIONAL but STRONGLY RECOMMENDED if coordinates are not found - provide full address or detailed location description
- Include operator name if mentioned
- Include terminal type/category if identifiable
- Include alternative names if terminal is referred to by different names
- Include capacity information if available
- Include berth/quay numbers if coordinates are not available
- If no terminals are found, return empty array: {"terminals": []}
`;

                let extractRes;
                try {
                    extractRes = await openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [{ role: 'user', content: extractPrompt }],
                        response_format: { type: 'json_object' },
                        temperature: 0.1,
                    });
                } catch (openaiError: any) {
                    if (openaiError.name === 'AbortError' || abortSignal.aborted) {
                        throw new Error('Request aborted');
                    }
                    throw {
                        category: 'API_ERROR',
                        message: 'AI processing service temporarily unavailable. Please try again in a moment.',
                        originalError: openaiError.message || String(openaiError),
                        retryable: true
                    };
                }

                if (abortSignal.aborted) {
                    throw new Error('Request aborted');
                }
                
                let extractedData: any;
                try {
                    extractedData = JSON.parse(extractRes.choices[0].message.content || '{}');
                } catch (parseError) {
                    throw {
                        category: 'VALIDATION_ERROR',
                        message: 'Received unexpected data format. Please try again.',
                        originalError: 'Failed to parse AI response as JSON',
                        retryable: false
                    };
                }

                // Validate extracted data
                if (!extractedData.terminals || !Array.isArray(extractedData.terminals)) {
                    throw {
                        category: 'VALIDATION_ERROR',
                        message: 'Received unexpected data format. Please try again.',
                        originalError: 'Terminals array not found in response',
                        retryable: false
                    };
                }

                // Add source category to terminals based on which query found them
                const terminalsWithSource: TerminalData[] = extractedData.terminals.map((terminal: any) => {
                    // Try to determine source category from terminal type or name
                    let sourceCategory = 'unknown';
                    const terminalType = terminal.terminalType?.toLowerCase() || '';
                    const name = (terminal.name || '').toLowerCase();
                    
                    if (terminalType.includes('container') || name.includes('container')) {
                        sourceCategory = 'container';
                    } else if (terminalType.includes('roro') || name.includes('roro') || name.includes('roll-on')) {
                        sourceCategory = 'roro';
                    } else if (terminalType.includes('liquid') || name.includes('liquid') || name.includes('lng') || name.includes('oil')) {
                        sourceCategory = 'liquid_bulk';
                    } else if (terminalType.includes('dry') || name.includes('bulk')) {
                        sourceCategory = 'dry_bulk';
                    } else if (terminalType.includes('multipurpose') || terminalType.includes('breakbulk')) {
                        sourceCategory = 'multipurpose';
                    }
                    
                    return {
                        name: terminal.name || '',
                        latitude: typeof terminal.latitude === 'number' ? terminal.latitude : null,
                        longitude: typeof terminal.longitude === 'number' ? terminal.longitude : null,
                        address: terminal.address && typeof terminal.address === 'string' ? terminal.address.trim() : null,
                        operator: terminal.operator && typeof terminal.operator === 'string' ? terminal.operator.trim() : null,
                        terminalType: terminal.terminalType && typeof terminal.terminalType === 'string' ? terminal.terminalType.trim() : null,
                        alternativeNames: Array.isArray(terminal.alternativeNames) ? terminal.alternativeNames : null,
                        capacity: terminal.capacity && typeof terminal.capacity === 'string' ? terminal.capacity.trim() : null,
                        berthNumbers: terminal.berthNumbers && typeof terminal.berthNumbers === 'string' ? terminal.berthNumbers.trim() : null,
                        sourceCategory
                    };
                });

                // Merge terminals from different queries (prioritize port authority sources)
                const mergedTerminals = mergeTerminalResults(terminalsWithSource);

                // Count terminals by category for reporting
                const terminalsByCategory: Record<string, number> = {};
                mergedTerminals.forEach(t => {
                    const category = t.sourceCategory || 'unknown';
                    terminalsByCategory[category] = (terminalsByCategory[category] || 0) + 1;
                });

                sendEvent('status', { 
                    message: `Found ${mergedTerminals.length} unique terminal(s) across ${successfulQueries.length} categories`, 
                    step: 'merge', 
                    progress: 75,
                    terminalsByCategory
                });

                // --- STEP 5: DEDUPLICATE AGAINST EXISTING DATA ---
                sendEvent('status', { message: 'Checking for duplicates...', step: 'deduplicate', progress: 80 });

                // Get existing proposals and terminals for this port
                const existingProposals = await prisma.terminalProposal.findMany({
                    where: { portId },
                    select: { name: true }
                });

                const existingTerminals = await prisma.terminal.findMany({
                    where: { portId },
                    select: { name: true }
                });

                // Create normalized name sets for exact matching
                const existingProposalNames = new Set(
                    existingProposals.map(p => normalizeTerminalName(p.name))
                );
                const existingTerminalNames = new Set(
                    existingTerminals.map(t => normalizeTerminalName(t.name))
                );

                // Filter out duplicates using fuzzy matching
                const newProposals: TerminalData[] = [];
                const duplicatesSkipped: string[] = [];

                for (const terminal of mergedTerminals) {
                    if (!terminal.name || typeof terminal.name !== 'string') {
                        continue; // Skip invalid entries
                    }

                    const normalizedName = normalizeTerminalName(terminal.name);

                    // Check exact match first (case-insensitive)
                    if (existingProposalNames.has(normalizedName) || existingTerminalNames.has(normalizedName)) {
                        duplicatesSkipped.push(terminal.name);
                        continue;
                    }

                    // Check fuzzy match against existing terminals/proposals
                    let isDuplicate = false;
                    const allExistingNames = Array.from(existingProposalNames).concat(Array.from(existingTerminalNames));
                    for (const existingName of allExistingNames) {
                        if (areTerminalsSimilar(terminal.name, existingName, terminal.terminalType)) {
                            isDuplicate = true;
                            duplicatesSkipped.push(terminal.name);
                            break;
                        }
                    }

                    if (!isDuplicate) {
                        // Check against terminals already in this batch
                        for (const newProposal of newProposals) {
                            if (areTerminalsSimilar(terminal.name, newProposal.name, terminal.terminalType, newProposal.terminalType)) {
                                isDuplicate = true;
                                duplicatesSkipped.push(terminal.name);
                                // Merge data: keep the most complete version
                                if (!newProposal.latitude && terminal.latitude) {
                                    newProposal.latitude = terminal.latitude;
                                    newProposal.longitude = terminal.longitude;
                                }
                                if (!newProposal.address && terminal.address) {
                                    newProposal.address = terminal.address;
                                }
                                if (!newProposal.operator && terminal.operator) {
                                    newProposal.operator = terminal.operator;
                                }
                                if (!newProposal.capacity && terminal.capacity) {
                                    newProposal.capacity = terminal.capacity;
                                }
                                if (!newProposal.berthNumbers && terminal.berthNumbers) {
                                    newProposal.berthNumbers = terminal.berthNumbers;
                                }
                                break;
                            }
                        }
                    }

                    if (!isDuplicate) {
                        newProposals.push(terminal);
                        existingProposalNames.add(normalizedName);
                    }
                }

                sendEvent('status', { 
                    message: `Filtered ${duplicatesSkipped.length} duplicate(s), ${newProposals.length} new terminal(s) found`, 
                    step: 'deduplicate', 
                    progress: 85 
                });

                // --- STEP 6: GEOCODE TERMINALS WITHOUT COORDINATES ---
                sendEvent('status', { message: 'Geocoding terminals without coordinates...', step: 'geocode', progress: 87 });
                
                for (const proposal of newProposals) {
                    // If coordinates are missing but address is available, try geocoding
                    if ((!proposal.latitude || !proposal.longitude) && proposal.address) {
                        try {
                            const geocoded = await geocodeTerminal(
                                proposal.name,
                                port.name,
                                port.country,
                                proposal.address
                            );
                            
                            if (geocoded) {
                                proposal.latitude = geocoded.latitude;
                                proposal.longitude = geocoded.longitude;
                            }
                        } catch (geocodeError) {
                            // Log but continue - geocoding will be attempted again at approval time
                            console.warn(`Geocoding failed for ${proposal.name}:`, geocodeError);
                        }
                    }
                }

                // --- STEP 7: CREATE PROPOSAL RECORDS ---
                sendEvent('status', { message: `Creating ${newProposals.length} terminal proposal(s)...`, step: 'create', progress: 90 });

                const createdProposals: Array<{
                    id: string;
                    name: string;
                    latitude: number | null;
                    longitude: number | null;
                    status: string;
                }> = [];

                for (const proposal of newProposals) {
                    try {
                        const created = await prisma.terminalProposal.create({
                            data: {
                                portId,
                                name: proposal.name,
                                latitude: proposal.latitude,
                                longitude: proposal.longitude,
                                status: 'pending'
                            }
                        });
                        createdProposals.push({
                            id: created.id,
                            name: created.name,
                            latitude: created.latitude,
                            longitude: created.longitude,
                            status: created.status
                        });
                    } catch (createError) {
                        // Log error but continue with other proposals
                        console.error(`Failed to create proposal for ${proposal.name}:`, createError);
                    }
                }

                // --- STEP 8: SEND COMPLETE EVENT ---
                sendEvent('status', { message: `Terminal discovery complete. Found ${createdProposals.length} new terminal(s).`, step: 'complete', progress: 100 });

                sendEvent('preview', {
                    proposals: createdProposals,
                    total_found: mergedTerminals.length,
                    duplicates_skipped: duplicatesSkipped.length,
                    new_proposals: createdProposals.length,
                    terminals_by_category: terminalsByCategory,
                    queries_succeeded: successfulQueries.length,
                    queries_failed: failedQueries.length,
                    failed_categories: failedQueries.map((q: { config: TerminalQueryConfig; result: null; error?: string }) => q.config.category)
                });

                controller.close();
            } catch (error: unknown) {
                if (error && typeof error === 'object' && 'category' in error) {
                    const err = error as { category: string; message: string; originalError?: string; retryable: boolean };
                    sendEvent('error', {
                        category: err.category,
                        message: err.message,
                        originalError: err.originalError,
                        retryable: err.retryable
                    });
                } else if (error instanceof Error) {
                    if (error.message === 'Request aborted' || error.name === 'AbortError') {
                        sendEvent('error', {
                            category: 'NETWORK_ERROR',
                            message: 'Terminal discovery was cancelled.',
                            retryable: false
                        });
                    } else {
                        sendEvent('error', {
                            category: 'UNKNOWN_ERROR',
                            message: 'An unexpected error occurred. Please try again.',
                            originalError: error.message,
                            retryable: true
                        });
                    }
                } else {
                    sendEvent('error', {
                        category: 'UNKNOWN_ERROR',
                        message: 'An unexpected error occurred. Please try again.',
                        retryable: true
                    });
                }
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
