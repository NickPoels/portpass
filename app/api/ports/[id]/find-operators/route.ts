import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import OpenAI from 'openai';
import { geocodeTerminal } from '@/lib/geocoding';
import { executeResearchQuery, getResearchProvider } from '@/lib/research-provider';
import { generateOperatorQueries, OperatorQueryConfig } from '@/lib/operator-queries';
import { compareTwoStrings } from 'string-similarity';

// Force node runtime for network calls and streaming
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Operator data structure
interface OperatorData {
    name: string;
    operatorType: 'commercial' | 'captive';
    parentCompanies: string[] | null;
    capacity: string | null;
    cargoTypes: string[];
    primaryLatitude: number | null;
    primaryLongitude: number | null;
    locations: Array<{ name: string; latitude: number | null; longitude: number | null }> | null;
}

/**
 * Normalize operator name for comparison
 */
function normalizeOperatorName(name: string): string {
    return name
        .toLowerCase()
        .replace(/^(port of |port |terminal |term\.? )/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Check if two operators are similar (fuzzy match)
 */
function areOperatorsSimilar(
    name1: string,
    name2: string,
    operatorType1?: string | null,
    operatorType2?: string | null
): boolean {
    // If operator types are different and both are specified, they're not duplicates
    if (operatorType1 && operatorType2 && operatorType1 !== operatorType2) {
        return false;
    }

    const normalized1 = normalizeOperatorName(name1);
    const normalized2 = normalizeOperatorName(name2);

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
 * Merge operators found across multiple queries, prioritizing port authority sources
 */
function mergeOperatorResults(allOperators: OperatorData[]): OperatorData[] {
    const merged: OperatorData[] = [];
    const processed = new Set<string>();

    // Sort by source priority: port_authority > others
    const sorted = allOperators.sort((a, b) => {
        // For now, we don't track source category in OperatorData, so just return 0
        return 0;
    });

    for (const operator of sorted) {
        const normalizedName = normalizeOperatorName(operator.name);
        
        // Check if we've already processed a similar operator
        let isDuplicate = false;
        for (const processedOperator of merged) {
            if (areOperatorsSimilar(
                operator.name,
                processedOperator.name,
                operator.operatorType,
                processedOperator.operatorType
            )) {
                isDuplicate = true;
                
                // Merge data: keep the most complete version
                if (!processedOperator.primaryLatitude && operator.primaryLatitude) {
                    processedOperator.primaryLatitude = operator.primaryLatitude;
                    processedOperator.primaryLongitude = operator.primaryLongitude;
                }
                if (!processedOperator.capacity && operator.capacity) {
                    processedOperator.capacity = operator.capacity;
                }
                // Merge parent companies
                if (operator.parentCompanies && operator.parentCompanies.length > 0) {
                    if (!processedOperator.parentCompanies) {
                        processedOperator.parentCompanies = [];
                    }
                    processedOperator.parentCompanies = [
                        ...new Set([...processedOperator.parentCompanies, ...operator.parentCompanies])
                    ];
                }
                // Merge cargo types
                if (operator.cargoTypes && operator.cargoTypes.length > 0) {
                    processedOperator.cargoTypes = [
                        ...new Set([...processedOperator.cargoTypes, ...operator.cargoTypes])
                    ];
                }
                // Merge locations
                if (operator.locations && operator.locations.length > 0) {
                    if (!processedOperator.locations) {
                        processedOperator.locations = [];
                    }
                    processedOperator.locations.push(...operator.locations);
                }
                break;
            }
        }

        if (!isDuplicate) {
            processed.add(normalizedName);
            merged.push(operator);
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
                sendEvent('status', { message: 'Initializing terminal operator discovery...', step: 'init', progress: 0 });
                
                if (abortSignal.aborted) {
                    throw new Error('Request aborted');
                }

                // --- STEP 2: GENERATE QUERIES ---
                const queryConfigs = generateOperatorQueries(port.name, port.country);
                sendEvent('status', { 
                    message: `Generated ${queryConfigs.length} operator discovery queries`, 
                    step: 'init', 
                    progress: 5 
                });

                // --- STEP 3: EXECUTE MULTI-QUERY STRATEGY ---
                sendEvent('status', { message: 'Discovering terminal operators across multiple categories...', step: 'discovery', progress: 10 });
                
                const queryResults: Array<{
                    config: OperatorQueryConfig;
                    result: { content: string; sources: string[] } | null;
                    error?: string;
                }> = [];

                // Execute queries in parallel with error handling
                const queryPromises = queryConfigs.map(async (config) => {
                    try {
                        sendEvent('status', { 
                            message: `Searching ${config.category} operators...`, 
                            step: 'discovery', 
                            progress: 10 + (queryConfigs.indexOf(config) * 10),
                            category: config.category
                        });
                        
                        const result = await executeResearchQuery(
                            config.query,
                            `operator_discovery_${config.category}`,
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
                    throw new Error('All operator discovery queries failed');
                }

                // Combine all research content
                const combinedResearchContent = successfulQueries
                    .map(q => `=== ${q.config.category.toUpperCase()} OPERATORS ===\n${q.result!.content}`)
                    .join('\n\n');

                sendEvent('status', { message: 'Analyzing operator data from all sources...', step: 'analysis', progress: 60 });

                // --- STEP 4: EXTRACT STRUCTURED DATA ---
                sendEvent('status', { message: 'Extracting operator information...', step: 'extract', progress: 70 });
                
                const extractPrompt = `
Extract terminal operator information from the research findings below. Return ONLY the terminal operators found, use null if not found.

RESEARCH FINDINGS:
${combinedResearchContent}

PORT: ${port.name}, ${port.country}

Return JSON:
{
  "operators": [
    {
      "name": "string (REQUIRED - exact operator name, e.g., 'PSA Singapore', 'BASF Terminal Rotterdam')",
      "operatorType": "string (REQUIRED - 'commercial' or 'captive')",
      "parentCompanies": ["string"] | null (OPTIONAL - array of parent company names, e.g., ['PSA International'], or null if none),
      "capacity": "string | null (OPTIONAL - capacity information like '5M TEU', '10M tons', etc.)",
      "cargoTypes": ["string"] (REQUIRED - array of cargo types: 'Container', 'RoRo', 'Dry Bulk', 'Liquid Bulk', 'Break Bulk', 'Multipurpose', 'Passenger/Ferry'),
      "primaryLatitude": "number | null (REQUIRED - primary location latitude in decimal degrees, use first/main terminal location)",
      "primaryLongitude": "number | null (REQUIRED - primary location longitude in decimal degrees, use first/main terminal location)",
      "locations": [
        {
          "name": "string (REQUIRED - terminal/facility name, e.g., 'Container Terminal 1', 'North Terminal')",
          "latitude": "number | null (REQUIRED - decimal degrees, include if available)",
          "longitude": "number | null (REQUIRED - decimal degrees, include if available)"
        }
      ] | null (OPTIONAL - array of terminal locations operated by this operator, null if single location or unknown)
    }
  ]
}

CRITICAL INSTRUCTIONS:
- Extract ALL terminal operators mentioned in the research (both commercial and captive)
- Operator name is REQUIRED - use the exact name as mentioned (e.g., "PSA Singapore", not just "PSA")
- operatorType is REQUIRED:
  * "commercial" = third-party terminal operators (PSA, DP World, APM Terminals, etc.)
  * "captive" = companies operating terminals for their own cargo (BASF, Arcelor Mittal, Shell, etc.)
- parentCompanies: Include if operator belongs to international network (e.g., "PSA Singapore" → parentCompanies: ["PSA International"])
- For joint ventures: Use the JV name as the operator name, list parent companies in parentCompanies array
- cargoTypes: Include all cargo types handled by this operator
- primaryLatitude/primaryLongitude: Use the main/primary terminal location coordinates
- locations: Include ALL terminal locations operated by this operator at this port (if multiple). If operator has only one location or location is unknown, use null
- If an operator has multiple terminals, group them under one operator record with multiple locations
- If no operators are found, return empty array: {"operators": []}
- DO NOT create separate operators for each terminal - group terminals by operator
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
                if (!extractedData.operators || !Array.isArray(extractedData.operators)) {
                    throw {
                        category: 'VALIDATION_ERROR',
                        message: 'Received unexpected data format. Please try again.',
                        originalError: 'Operators array not found in response',
                        retryable: false
                    };
                }

                // Transform extracted data to OperatorData format
                const operatorsWithData: OperatorData[] = extractedData.operators.map((operator: any) => {
                    return {
                        name: operator.name || '',
                        operatorType: (operator.operatorType === 'commercial' || operator.operatorType === 'captive') 
                            ? operator.operatorType 
                            : 'commercial', // Default to commercial
                        parentCompanies: Array.isArray(operator.parentCompanies) ? operator.parentCompanies : null,
                        capacity: operator.capacity && typeof operator.capacity === 'string' ? operator.capacity.trim() : null,
                        cargoTypes: Array.isArray(operator.cargoTypes) ? operator.cargoTypes : [],
                        primaryLatitude: typeof operator.primaryLatitude === 'number' ? operator.primaryLatitude : null,
                        primaryLongitude: typeof operator.primaryLongitude === 'number' ? operator.primaryLongitude : null,
                        locations: Array.isArray(operator.locations) ? operator.locations.map((loc: any) => ({
                            name: loc.name || '',
                            latitude: typeof loc.latitude === 'number' ? loc.latitude : null,
                            longitude: typeof loc.longitude === 'number' ? loc.longitude : null
                        })) : null
                    };
                });

                // Merge operators from different queries
                const mergedOperators = mergeOperatorResults(operatorsWithData);

                // Count operators by type for reporting
                const operatorsByType: Record<string, number> = {};
                mergedOperators.forEach(op => {
                    const type = op.operatorType || 'unknown';
                    operatorsByType[type] = (operatorsByType[type] || 0) + 1;
                });

                sendEvent('status', { 
                    message: `Found ${mergedOperators.length} unique operator(s) across ${successfulQueries.length} categories`, 
                    step: 'merge', 
                    progress: 75,
                    operatorsByType
                });

                // --- STEP 5: DEDUPLICATE AGAINST EXISTING DATA ---
                sendEvent('status', { message: 'Checking for duplicates...', step: 'deduplicate', progress: 80 });

                // Get existing proposals and operators for this port
                const existingProposals = await prisma.terminalOperatorProposal.findMany({
                    where: { portId },
                    select: { name: true }
                });

                const existingOperators = await prisma.terminalOperator.findMany({
                    where: { portId },
                    select: { name: true }
                });

                // Create normalized name sets for exact matching
                const existingProposalNames = new Set(
                    existingProposals.map(p => normalizeOperatorName(p.name))
                );
                const existingOperatorNames = new Set(
                    existingOperators.map(o => normalizeOperatorName(o.name))
                );

                // Filter out duplicates using fuzzy matching
                const newProposals: OperatorData[] = [];
                const duplicatesSkipped: string[] = [];

                for (const operator of mergedOperators) {
                    if (!operator.name || typeof operator.name !== 'string') {
                        continue; // Skip invalid entries
                    }

                    const normalizedName = normalizeOperatorName(operator.name);

                    // Check exact match first (case-insensitive)
                    if (existingProposalNames.has(normalizedName) || existingOperatorNames.has(normalizedName)) {
                        duplicatesSkipped.push(operator.name);
                        continue;
                    }

                    // Check fuzzy match against existing operators/proposals
                    let isDuplicate = false;
                    const allExistingNames = Array.from(existingProposalNames).concat(Array.from(existingOperatorNames));
                    for (const existingName of allExistingNames) {
                        if (areOperatorsSimilar(operator.name, existingName, operator.operatorType)) {
                            isDuplicate = true;
                            duplicatesSkipped.push(operator.name);
                            break;
                        }
                    }

                    if (!isDuplicate) {
                        // Check against operators already in this batch
                        for (const newProposal of newProposals) {
                            if (areOperatorsSimilar(operator.name, newProposal.name, operator.operatorType, newProposal.operatorType)) {
                                isDuplicate = true;
                                duplicatesSkipped.push(operator.name);
                                // Merge data: keep the most complete version
                                if (!newProposal.primaryLatitude && operator.primaryLatitude) {
                                    newProposal.primaryLatitude = operator.primaryLatitude;
                                    newProposal.primaryLongitude = operator.primaryLongitude;
                                }
                                if (!newProposal.capacity && operator.capacity) {
                                    newProposal.capacity = operator.capacity;
                                }
                                if (operator.parentCompanies && operator.parentCompanies.length > 0) {
                                    if (!newProposal.parentCompanies) {
                                        newProposal.parentCompanies = [];
                                    }
                                    newProposal.parentCompanies = [
                                        ...new Set([...newProposal.parentCompanies, ...operator.parentCompanies])
                                    ];
                                }
                                if (operator.cargoTypes && operator.cargoTypes.length > 0) {
                                    newProposal.cargoTypes = [
                                        ...new Set([...newProposal.cargoTypes, ...operator.cargoTypes])
                                    ];
                                }
                                if (operator.locations && operator.locations.length > 0) {
                                    if (!newProposal.locations) {
                                        newProposal.locations = [];
                                    }
                                    newProposal.locations.push(...operator.locations);
                                }
                                break;
                            }
                        }
                    }

                    if (!isDuplicate) {
                        newProposals.push(operator);
                        existingProposalNames.add(normalizedName);
                    }
                }

                sendEvent('status', { 
                    message: `Filtered ${duplicatesSkipped.length} duplicate(s), ${newProposals.length} new operator(s) found`, 
                    step: 'deduplicate', 
                    progress: 85 
                });

                // --- STEP 6: GEOCODE OPERATORS WITHOUT COORDINATES ---
                sendEvent('status', { message: 'Geocoding operators without coordinates...', step: 'geocode', progress: 87 });
                
                for (const proposal of newProposals) {
                    // If primary coordinates are missing, try geocoding using operator name
                    if ((!proposal.primaryLatitude || !proposal.primaryLongitude)) {
                        try {
                            const geocoded = await geocodeTerminal(
                                proposal.name,
                                port.name,
                                port.country,
                                null
                            );
                            
                            if (geocoded) {
                                proposal.primaryLatitude = geocoded.latitude;
                                proposal.primaryLongitude = geocoded.longitude;
                            }
                        } catch (geocodeError) {
                            // Log but continue - geocoding will be attempted again at approval time
                            console.warn(`Geocoding failed for ${proposal.name}:`, geocodeError);
                        }
                    }
                }

                // --- STEP 7: CREATE PROPOSAL RECORDS ---
                sendEvent('status', { message: `Creating ${newProposals.length} operator proposal(s)...`, step: 'create', progress: 90 });

                const createdProposals: Array<{
                    id: string;
                    name: string;
                    operatorType: string | null;
                    latitude: number | null;
                    longitude: number | null;
                    status: string;
                }> = [];

                for (const proposal of newProposals) {
                    try {
                        const created = await prisma.terminalOperatorProposal.create({
                            data: {
                                portId,
                                name: proposal.name,
                                operatorType: proposal.operatorType,
                                parentCompanies: proposal.parentCompanies ? JSON.stringify(proposal.parentCompanies) : null,
                                capacity: proposal.capacity,
                                cargoTypes: proposal.cargoTypes.length > 0 ? JSON.stringify(proposal.cargoTypes) : null,
                                latitude: proposal.primaryLatitude,
                                longitude: proposal.primaryLongitude,
                                locations: proposal.locations && proposal.locations.length > 0 ? JSON.stringify(proposal.locations) : null,
                                status: 'pending'
                            }
                        });
                        createdProposals.push({
                            id: created.id,
                            name: created.name,
                            operatorType: created.operatorType,
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
                sendEvent('status', { message: `Terminal operator discovery complete. Found ${createdProposals.length} new operator(s).`, step: 'complete', progress: 100 });

                sendEvent('preview', {
                    proposals: createdProposals,
                    total_found: mergedOperators.length,
                    duplicates_skipped: duplicatesSkipped.length,
                    new_proposals: createdProposals.length,
                    operators_by_type: operatorsByType,
                    queries_succeeded: successfulQueries.length,
                    queries_failed: failedQueries.length,
                    failed_categories: failedQueries.map((q: { config: OperatorQueryConfig; result: null; error?: string }) => q.config.category)
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
                            message: 'Terminal operator discovery was cancelled.',
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
