import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import OpenAI from 'openai';
import { executeResearchQuery, getResearchProvider } from '@/lib/research-provider';
import {
    validateOperatorType,
    validateParentCompanies,
    validateCapacity,
    validateCargoTypes,
    validateCoordinates
} from '@/lib/field-validation';

// Force node runtime for network calls and streaming
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Set max duration to 60s (or more if platform allows) for long research
export const maxDuration = 300;


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

    const operatorId = params.id;
    
    // Check if running in background mode (ignore abort signals)
    const url = new URL(request.url);
    const isBackgroundMode = url.searchParams.get('background') === 'true' || 
                             request.headers.get('X-Background-Mode') === 'true';
    
    // Per-query timeout for research queries (2.5 minutes per query)
    const RESEARCH_QUERY_TIMEOUT_MS = 2.5 * 60 * 1000; // 2.5 minutes
    
    /**
     * Create a timeout-based abort signal for background mode queries
     * This ensures individual research queries don't hang indefinitely
     */
    function createQueryTimeoutSignal(): AbortSignal {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, RESEARCH_QUERY_TIMEOUT_MS);
        
        // Store timeout ID on the signal for potential cleanup
        (controller.signal as any)._timeoutId = timeoutId;
        
        return controller.signal;
    }
    
    // Create a no-op abort signal for background mode (never aborts) - only used for non-query operations
    const noOpAbortController = new AbortController();
    const backgroundAbortSignal = noOpAbortController.signal;

    // 1. Validate Operator
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

    // 2. Set up Streaming Response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendEvent = (event: string, data: unknown) => {
                controller.enqueue(
                    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                );
            };

            // Helper to get abort signal for research queries
            // In background mode, create a timeout-based signal for each query to prevent hangs
            // In normal mode, use the request signal
            const getQueryAbortSignal = () => {
                if (isBackgroundMode) {
                    return createQueryTimeoutSignal();
                }
                return request.signal;
            };
            
            // Use no-op abort signal for non-query operations in background mode
            const abortSignal = isBackgroundMode ? backgroundAbortSignal : request.signal;

            // Confidence scoring function
            const calculateConfidence = (content: string, sources: string[]): number => {
                let score = 0;
                
                // Source quality (0.3 max)
                const hasOfficialSource = content.toLowerCase().includes('port authority') || 
                                         content.toLowerCase().includes('official') ||
                                         content.toLowerCase().includes('government');
                const hasDirectory = content.toLowerCase().includes('directory') || 
                                   content.toLowerCase().includes('maritime');
                if (hasOfficialSource) score += 0.3;
                else if (hasDirectory) score += 0.2;
                else if (sources.length > 0) score += 0.1;
                
                // Data consistency (0.3 max)
                if (sources.length >= 2) score += 0.3;
                else if (sources.length === 1) score += 0.15;
                else score += 0.05;
                
                // Recency (0.2 max) - check for year mentions
                const yearMatch = content.match(/\b(20\d{2})\b/);
                if (yearMatch) {
                    const year = parseInt(yearMatch[1]);
                    const currentYear = new Date().getFullYear();
                    const age = currentYear - year;
                    if (age <= 1) score += 0.2;
                    else if (age <= 3) score += 0.1;
                    else score += 0.05;
                } else {
                    score += 0.1; // Default if no year found
                }
                
                // Completeness (0.2 max)
                const hasNumbers = /\d/.test(content);
                const hasSpecifics = content.length > 100;
                if (hasNumbers && hasSpecifics) score += 0.2;
                else if (hasSpecifics) score += 0.1;
                else score += 0.05;
                
                return Math.min(score, 1.0);
            };
            
            try {
                // --- STEP 1: INITIALIZE ---
                sendEvent('status', { message: 'Initializing research...', step: 'init', progress: 0 });
                
                if (abortSignal.aborted) {
                    throw new Error('Request aborted');
                }

                // --- STEP 2: MULTI-QUERY RESEARCH ---
                const researchQueries: Array<{ query: string; result: string; sources: string[]; queryType: string }> = [];
                
                // Execute queries 1-2 in parallel for maximum speed
                sendEvent('status', { message: 'Querying identity, location, and capacity...', step: 'parallel_queries', progress: 20 });
                
                // Optimized queries - focused and concise for operators
                const query1 = `Find the exact location (latitude, longitude) of ${operator.name} in ${operator.port.name}, ${operator.port.country}. Confirm if ${operator.name} is located in ${operator.port.name} or a different port. Include all terminal locations operated by this operator. Cite sources.`;
                const query2 = `Research the annual capacity (TEU or tonnage), cargo types, operator type (commercial or captive), and parent companies for ${operator.name}. Include specific cargo categories and any international network affiliations. Cite sources.`;
                
                const parallelStart = Date.now();
                const [result1, result2] = await Promise.allSettled([
                    (async () => {
                        const res = await executeResearchQuery(query1, 'identity_location', getQueryAbortSignal());
                        console.log(`[Deep Research] ${operator.name} - Location query completed`);
                        return { query: query1, result: res.content, sources: res.sources, name: 'identity_location' };
                    })(),
                    (async () => {
                        const res = await executeResearchQuery(query2, 'capacity_operations', getQueryAbortSignal());
                        console.log(`[Deep Research] ${operator.name} - Capacity query completed`);
                        return { query: query2, result: res.content, sources: res.sources, name: 'capacity_operations' };
                    })()
                ]);
                
                const parallelDuration = ((Date.now() - parallelStart) / 1000).toFixed(1);
                console.log(`[Deep Research] ${operator.name} - All parallel queries completed in ${parallelDuration}s`);
                
                // Process results and track failed queries for retry
                const failedQueries: Array<{ query: string; queryType: string; error: any; retryable: boolean }> = [];
                
                if (result1.status === 'fulfilled') {
                    researchQueries.push({ query: result1.value.query, result: result1.value.result, sources: result1.value.sources, queryType: 'identity_location' });
                } else {
                    const error = result1.reason;
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    const isTimeout = errorMsg.includes('aborted') || errorMsg.includes('timeout') || errorMsg.includes('AbortError');
                    const isRetryable = !isTimeout && (typeof error === 'object' && error !== null && 'retryable' in error ? error.retryable : true) && !errorMsg.includes('401');
                    
                    if (isTimeout) {
                        console.error(`[Deep Research] ${operator.name} - Location query TIMEOUT after ${RESEARCH_QUERY_TIMEOUT_MS / 1000}s: ${errorMsg}`);
                    } else {
                        console.warn(`[Deep Research] ${operator.name} - Location query failed: ${errorMsg}`, error);
                        if (isRetryable) {
                            failedQueries.push({ query: query1, queryType: 'identity_location', error, retryable: true });
                        }
                    }
                }
                
                if (result2.status === 'fulfilled') {
                    researchQueries.push({ query: result2.value.query, result: result2.value.result, sources: result2.value.sources, queryType: 'capacity_operations' });
                } else {
                    const error = result2.reason;
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    const isTimeout = errorMsg.includes('aborted') || errorMsg.includes('timeout') || errorMsg.includes('AbortError');
                    const isRetryable = !isTimeout && (typeof error === 'object' && error !== null && 'retryable' in error ? error.retryable : true) && !errorMsg.includes('401');
                    
                    if (isTimeout) {
                        console.error(`[Deep Research] ${operator.name} - Capacity query TIMEOUT after ${RESEARCH_QUERY_TIMEOUT_MS / 1000}s: ${errorMsg}`);
                    } else {
                        console.warn(`[Deep Research] ${operator.name} - Capacity query failed: ${errorMsg}`, error);
                        if (isRetryable) {
                            failedQueries.push({ query: query2, queryType: 'capacity_operations', error, retryable: true });
                        }
                    }
                }
                
                // Retry failed queries (one retry per query with 2s delay)
                if (failedQueries.length > 0) {
                    console.log(`[Deep Research] ${operator.name} - Retrying ${failedQueries.length} failed query/queries after 2s delay...`);
                    sendEvent('status', { message: `Retrying ${failedQueries.length} failed query/queries...`, step: 'retry_queries', progress: 65 });
                    
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
                    
                    for (const failedQuery of failedQueries) {
                        try {
                            console.log(`[Deep Research] ${operator.name} - Retrying ${failedQuery.queryType} query...`);
                            const retryStart = Date.now();
                            const retryRes = await executeResearchQuery(failedQuery.query, failedQuery.queryType, getQueryAbortSignal());
                            const retryDuration = ((Date.now() - retryStart) / 1000).toFixed(1);
                            console.log(`[Deep Research] ${operator.name} - ${failedQuery.queryType} query RETRY SUCCESS (${retryDuration}s)`);
                            researchQueries.push({ 
                                query: failedQuery.query, 
                                result: retryRes.content, 
                                sources: retryRes.sources, 
                                queryType: failedQuery.queryType 
                            });
                        } catch (retryError: any) {
                            const retryErrorMsg = retryError instanceof Error ? retryError.message : String(retryError);
                            console.error(`[Deep Research] ${operator.name} - ${failedQuery.queryType} query RETRY FAILED: ${retryErrorMsg}`, retryError);
                        }
                    }
                }
                
                console.log(`[Deep Research] ${operator.name} - Research queries complete. ${researchQueries.length}/2 successful. [70%]`);
                sendEvent('status', { message: `Research complete. ${researchQueries.length}/2 queries successful.`, step: 'queries_complete', progress: 70 });

                // Combine all research results with section headers and query indices
                const queryTypeToTitle: Record<string, string> = {
                    'identity_location': '## Location Report',
                    'capacity_operations': '## Capacity & Operations Report'
                };
                
                const researchText = researchQueries.map((q) => {
                    const title = queryTypeToTitle[q.queryType] || `## Report`;
                    return `${title}\n\n${q.result}`;
                }).join('\n\n---\n\n');

                // --- STEP 3: EXTRACT STRUCTURED DATA ---
                sendEvent('status', { message: 'Extracting structured data...', step: 'extract', progress: 85 });
                
                // Use more context - summarize if too long instead of truncating
                let extractResearchText = researchText;
                if (researchText.length > 12000) {
                    // For very long research, include first 8000 chars and last 2000 chars
                    extractResearchText = researchText.substring(0, 8000) + '\n\n[... middle section truncated ...]\n\n' + researchText.substring(researchText.length - 2000);
                } else if (researchText.length > 8000) {
                    extractResearchText = researchText.substring(0, 8000) + '\n\n[... truncated ...]';
                }
                
                // Build query index map for source attribution
                const queryIndexMap = researchQueries.map((q, idx) => ({
                    index: idx,
                    query: q.query.substring(0, 100) + '...',
                    title: reportTitles[idx] || `Report ${idx + 1}`
                }));
                
                const extractPrompt = `
Extract structured data from the research findings below. For each field you extract, provide:
1. The extracted value
2. Your confidence in the extraction (0.0 to 1.0, where 1.0 = explicit mention, 0.5 = inferred, 0.3 = partial/uncertain)
3. Which research query/queries provided this information (use query indices: 0=Location, 1=Capacity & Operations)
4. Quality indicator: "explicit" (directly stated), "inferred" (logically derived), or "partial" (incomplete/uncertain)

RESEARCH QUERIES:
${queryIndexMap.map(q => `Query ${q.index} (${q.title}): ${q.query}`).join('\n')}

RESEARCH FINDINGS:
${extractResearchText}

CURRENT OPERATOR DATA:
- Name: ${operator.name}
- Port: ${operator.port.name} (${operator.port.country})
- Operator Type: ${operator.operatorType || 'unknown'}
- Parent Companies: ${operator.parentCompanies ? JSON.parse(operator.parentCompanies).join(', ') : 'none'}
- Capacity: ${operator.capacity || 'unknown'}
- Cargo Types: ${typeof operator.cargoTypes === 'string' ? operator.cargoTypes : JSON.stringify(operator.cargoTypes)}
- Coordinates: ${operator.latitude || 'null'}, ${operator.longitude || 'null'}

Return JSON with this structure:
{
  "operator_type": {
    "value": "commercial | captive | null",
    "confidence": 0.0-1.0,
    "sources": [0, 1],  // Array of query indices
    "quality": "explicit | inferred | partial"
  },
  "parent_companies": {
    "value": ["string"] | null,  // Array of parent company names
    "confidence": 0.0-1.0,
    "sources": [1],
    "quality": "explicit | inferred | partial"
  },
  "cargo_types": {
    "value": ["Container", "RoRo", "Dry Bulk", "Liquid Bulk", "Break Bulk", "Multipurpose", "Passenger/Ferry"] | null,
    "confidence": 0.0-1.0,
    "sources": [1],
    "quality": "explicit | inferred | partial"
  },
  "capacity": {
    "value": "string | null",
    "confidence": 0.0-1.0,
    "sources": [1],
    "quality": "explicit | inferred | partial"
  },
  "suggested_port_name": {
    "value": "string | null",
    "confidence": 0.0-1.0,
    "sources": [0],
    "quality": "explicit | inferred | partial"
  },
  "new_coordinates": {
    "value": { "lat": number, "lon": number } | null,
    "confidence": 0.0-1.0,
    "sources": [0],
    "quality": "explicit | inferred | partial"
  }
}

IMPORTANT:
- Use null for value if the field is not found in the research
- Confidence should reflect how certain you are about the extraction
- Sources should list all query indices (0-1) that mention this information
- Quality should indicate how the information was found
- For cargo_types, use only valid values: Container, RoRo, Dry Bulk, Liquid Bulk, Break Bulk, Multipurpose, Passenger/Ferry
`;

                let extractRes;
                try {
                    extractRes = await openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [{ role: 'user', content: extractPrompt }],
                        response_format: { type: 'json_object' },
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

                // --- STEP 3.5: NORMALIZE EXTRACTED DATA STRUCTURE ---
                // Handle both old format (simple values) and new format (objects with confidence)
                const normalizedExtractedData: any = {};
                const llmConfidences: Record<string, number> = {};
                const fieldSources: Record<string, number[]> = {};
                const fieldQualities: Record<string, 'explicit' | 'inferred' | 'partial'> = {};
                
                const fieldMappings: Record<string, string> = {
                    'operator_type': 'operatorType',
                    'parent_companies': 'parentCompanies',
                    'cargo_types': 'cargoTypes',
                    'capacity': 'capacity',
                    'suggested_port_name': 'portId',
                    'new_coordinates': 'coordinates',
                    'strategic_notes': 'strategicNotes'
                };
                
                for (const [key, mappedKey] of Object.entries(fieldMappings)) {
                    const rawValue = extractedData[key];
                    
                    if (rawValue === null || rawValue === undefined) {
                        normalizedExtractedData[key] = null;
                        continue;
                    }
                    
                    // Check if new format (object with value, confidence, sources, quality)
                    if (typeof rawValue === 'object' && !Array.isArray(rawValue) && 'value' in rawValue) {
                        normalizedExtractedData[key] = rawValue.value;
                        llmConfidences[mappedKey] = Math.max(0, Math.min(1, rawValue.confidence || 0.5));
                        fieldSources[mappedKey] = Array.isArray(rawValue.sources) ? rawValue.sources : [];
                        if (rawValue.quality && ['explicit', 'inferred', 'partial'].includes(rawValue.quality)) {
                            fieldQualities[mappedKey] = rawValue.quality;
                        }
                    } else {
                        // Old format - simple value
                        normalizedExtractedData[key] = rawValue;
                        llmConfidences[mappedKey] = 0.5; // Default confidence
                        fieldSources[mappedKey] = []; // No source attribution
                    }
                }

                // --- STEP 4: CALCULATE COMBINED CONFIDENCE SCORES ---
                sendEvent('status', { message: 'Calculating confidence scores...', step: 'confidence', progress: 92 });
                
                const fieldConfidences: Record<string, number> = {};
                const allSources = researchQueries.flatMap(q => q.sources);
                
                // Combine LLM confidence with heuristic confidence
                const getHeuristicConfidence = (fieldKey: string, queryIndices: number[]): number => {
                    if (queryIndices.length === 0) {
                        // Fallback to old method if no sources provided
                        let relevantResult = '';
                        if (fieldKey === 'operatorGroup') {
                            relevantResult = researchQueries.find(q => q.query.includes('operates'))?.result || '';
                        } else if (fieldKey === 'capacity' || fieldKey === 'cargoTypes') {
                            relevantResult = researchQueries.find(q => q.query.includes('capacity') || q.query.includes('cargo'))?.result || '';
                        } else if (fieldKey === 'coordinates') {
                            relevantResult = researchQueries.find(q => q.query.includes('location') || q.query.includes('latitude'))?.result || '';
                        } else if (fieldKey === 'portId') {
                            relevantResult = researchQueries.find(q => q.query.includes('port'))?.result || '';
                        }
                        
                        const relevantSources = researchQueries
                            .filter((q, idx) => q.query.includes(fieldKey.toLowerCase()) || relevantResult.includes(q.result))
                            .flatMap(q => q.sources);
                        
                        return calculateConfidence(relevantResult, relevantSources);
                    }
                    
                    // Use sources from LLM
                    const relevantQueries = researchQueries.filter((_, idx) => queryIndices.includes(idx));
                    const relevantResult = relevantQueries.map(q => q.result).join('\n\n');
                    const relevantSources = relevantQueries.flatMap(q => q.sources);
                    
                    return calculateConfidence(relevantResult, relevantSources);
                };
                
                // Calculate combined confidence for each field
                for (const [key, mappedKey] of Object.entries(fieldMappings)) {
                    if (normalizedExtractedData[key] !== null && normalizedExtractedData[key] !== undefined) {
                        const llmConf = llmConfidences[mappedKey] || 0.5;
                        const heuristicConf = getHeuristicConfidence(mappedKey, fieldSources[mappedKey] || []);
                        
                        // Weighted average: 60% LLM confidence, 40% heuristic
                        fieldConfidences[mappedKey] = (llmConf * 0.6) + (heuristicConf * 0.4);
                    }
                }

                // --- STEP 4.5: VALIDATE EXTRACTED DATA ---
                sendEvent('status', { message: 'Validating extracted data...', step: 'validate', progress: 92.5 });
                
                const validationResults: Record<string, any> = {};
                const validationErrors: Record<string, string[]> = {};
                const validationWarnings: Record<string, string[]> = {};
                
                // Validate each extracted field
                if (normalizedExtractedData.operator_type !== null && normalizedExtractedData.operator_type !== undefined) {
                    const result = validateOperatorType(normalizedExtractedData.operator_type);
                    validationResults.operatorType = result;
                    if (result.errors.length > 0) validationErrors.operatorType = result.errors;
                    if (result.warnings.length > 0) validationWarnings.operatorType = result.warnings;
                    if (result.correctedValue) normalizedExtractedData.operator_type = result.correctedValue;
                    if (!result.isValid) {
                        fieldConfidences.operatorType = Math.max(0, (fieldConfidences.operatorType || 0.5) - 0.2);
                    }
                }
                
                if (normalizedExtractedData.parent_companies !== null && normalizedExtractedData.parent_companies !== undefined) {
                    const result = validateParentCompanies(normalizedExtractedData.parent_companies);
                    validationResults.parentCompanies = result;
                    if (result.errors.length > 0) validationErrors.parentCompanies = result.errors;
                    if (result.warnings.length > 0) validationWarnings.parentCompanies = result.warnings;
                    if (result.correctedValue) normalizedExtractedData.parent_companies = result.correctedValue;
                    if (!result.isValid) {
                        fieldConfidences.parentCompanies = Math.max(0, (fieldConfidences.parentCompanies || 0.5) - 0.2);
                    }
                }
                
                if (normalizedExtractedData.capacity !== null && normalizedExtractedData.capacity !== undefined) {
                    const result = validateCapacity(normalizedExtractedData.capacity);
                    validationResults.capacity = result;
                    if (result.errors.length > 0) validationErrors.capacity = result.errors;
                    if (result.warnings.length > 0) validationWarnings.capacity = result.warnings;
                    if (result.correctedValue) normalizedExtractedData.capacity = result.correctedValue;
                    if (!result.isValid) {
                        fieldConfidences.capacity = Math.max(0, (fieldConfidences.capacity || 0.5) - 0.2);
                    }
                }
                
                if (normalizedExtractedData.cargo_types !== null && normalizedExtractedData.cargo_types !== undefined) {
                    const result = validateCargoTypes(normalizedExtractedData.cargo_types);
                    validationResults.cargoTypes = result;
                    if (result.errors.length > 0) validationErrors.cargoTypes = result.errors;
                    if (result.warnings.length > 0) validationWarnings.cargoTypes = result.warnings;
                    if (result.correctedValue) normalizedExtractedData.cargo_types = result.correctedValue;
                    if (!result.isValid) {
                        fieldConfidences.cargoTypes = Math.max(0, (fieldConfidences.cargoTypes || 0.5) - 0.2);
                    }
                }
                
                if (normalizedExtractedData.new_coordinates !== null && normalizedExtractedData.new_coordinates !== undefined) {
                    const coords = normalizedExtractedData.new_coordinates;
                    const result = validateCoordinates(coords.lat, coords.lon);
                    validationResults.coordinates = result;
                    if (result.errors.length > 0) validationErrors.coordinates = result.errors;
                    if (result.warnings.length > 0) validationWarnings.coordinates = result.warnings;
                    if (result.correctedValue) normalizedExtractedData.new_coordinates = result.correctedValue;
                    if (!result.isValid) {
                        fieldConfidences.coordinates = Math.max(0, (fieldConfidences.coordinates || 0.5) - 0.2);
                    }
                }

                // --- STEP 5: CONFLICT DETECTION ---
                sendEvent('status', { message: 'Detecting conflicts...', step: 'conflict_detection', progress: 92.7 });
                
                // Detect conflicts between research queries
                const conflictDetectionPrompt = `
Analyze the research queries below and identify any conflicts or discrepancies in the extracted data.

RESEARCH QUERIES:
${researchQueries.map((q, idx) => `
Query ${idx} (${reportTitles[idx] || `Report ${idx + 1}`}):
${q.query}

Result:
${q.result.substring(0, 1000)}${q.result.length > 1000 ? '...' : ''}
`).join('\n---\n')}

EXTRACTED DATA:
- Operator Type: ${normalizedExtractedData.operator_type || 'null'}
- Parent Companies: ${JSON.stringify(normalizedExtractedData.parent_companies) || 'null'}
- Cargo Types: ${JSON.stringify(normalizedExtractedData.cargo_types) || 'null'}
- Capacity: ${normalizedExtractedData.capacity || 'null'}
- Suggested Port: ${normalizedExtractedData.suggested_port_name || 'null'}
- Coordinates: ${normalizedExtractedData.new_coordinates ? `${normalizedExtractedData.new_coordinates.lat}, ${normalizedExtractedData.new_coordinates.lon}` : 'null'}

Identify:
1. Fields where different queries provide conflicting values
2. Fields where values are inconsistent across queries
3. Confidence in each conflicting value
4. Suggested resolution (if possible)

Return JSON:
{
  "conflicts": [
    {
      "field": "operator_type | parent_companies | cargo_types | capacity | suggested_port_name | new_coordinates",
      "conflictingValues": [
        {
          "value": "string | object",
          "sourceQueryIndex": 0,
          "sourceQueryTitle": "Location Report",
          "confidence": 0.0-1.0,
          "evidence": "string - quote from research"
        }
      ],
      "suggestedResolution": "string | null"
    }
  ]
}
`;

                let conflictData: any = { conflicts: [] };
                try {
                    const conflictRes = await openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [{ role: 'user', content: conflictDetectionPrompt }],
                        response_format: { type: 'json_object' },
                        temperature: 0.2,
                    });
                    conflictData = JSON.parse(conflictRes.choices[0].message.content || '{"conflicts": []}');
                } catch (e) {
                    console.error('Conflict detection failed:', e);
                    // Continue without conflict data
                }

                // --- STEP 6: LLM FIELD-BY-FIELD ANALYSIS ---
                sendEvent('status', { message: 'Analyzing field updates...', step: 'llm_analysis', progress: 95 });
                
                interface FieldProposal {
                    field: string;
                    currentValue: any;
                    proposedValue: any;
                    confidence: number;
                    shouldUpdate: boolean;
                    reasoning: string;
                    sources: string[];
                    updatePriority: "high" | "medium" | "low";
                    validationErrors?: string[];
                    validationWarnings?: string[];
                    conflicts?: Array<{
                        conflictingValue: any;
                        sourceQuery: string;
                        sourceIndex: number;
                        confidence: number;
                        evidence?: string;
                    }>;
                    hasConflict: boolean;
                    llmQuality?: 'explicit' | 'inferred' | 'partial';
                }

                const fieldProposals: FieldProposal[] = [];
                const fieldsToAnalyze = [
                    { key: 'operatorType', label: 'Operator Type', extracted: normalizedExtractedData.operator_type, current: operator.operatorType },
                    { key: 'parentCompanies', label: 'Parent Companies', extracted: normalizedExtractedData.parent_companies, current: operator.parentCompanies ? JSON.parse(operator.parentCompanies) : null },
                    { key: 'capacity', label: 'Capacity', extracted: normalizedExtractedData.capacity, current: operator.capacity },
                    { key: 'cargoTypes', label: 'Cargo Types', extracted: normalizedExtractedData.cargo_types, current: typeof operator.cargoTypes === 'string' ? JSON.parse(operator.cargoTypes) : operator.cargoTypes },
                    { key: 'coordinates', label: 'Coordinates', extracted: normalizedExtractedData.new_coordinates, current: operator.latitude && operator.longitude ? { lat: operator.latitude, lon: operator.longitude } : null },
                    { key: 'portId', label: 'Port', extracted: normalizedExtractedData.suggested_port_name, current: operator.port.name },
                ];

                // Batch field analysis into a single call to reduce token usage
                const fieldsWithData = fieldsToAnalyze.filter(f => f.extracted);
                
                if (fieldsWithData.length > 0) {
                    sendEvent('status', { message: 'Analyzing field updates...', step: 'llm_analysis', progress: 95 });
                    
                    // Build relevant research context for each field (only include relevant queries)
                    const getRelevantResearch = (fieldKey: string): string => {
                        if (fieldKey === 'operatorType' || fieldKey === 'parentCompanies') {
                            return researchQueries.find(q => q.query.includes('operator') || q.query.includes('parent') || q.query.includes('network'))?.result || '';
                        } else if (fieldKey === 'capacity' || fieldKey === 'cargoTypes') {
                            return researchQueries.find(q => q.query.includes('capacity') || q.query.includes('cargo'))?.result || '';
                        } else if (fieldKey === 'coordinates') {
                            return researchQueries.find(q => q.query.includes('location') || q.query.includes('latitude'))?.result || '';
                        } else if (fieldKey === 'portId') {
                            return researchQueries.find(q => q.query.includes('port'))?.result || '';
                        }
                        return ''; // No relevant research
                    };
                    
                    // Create a single batch analysis prompt for all fields
                    const batchAnalysisPrompt = `
You are evaluating whether to update multiple terminal database fields. Analyze each field independently.

OPERATOR: ${operator.name}
PORT: ${operator.port.name} (${operator.port.country})

FIELDS TO EVALUATE:
${fieldsWithData.map(f => `
FIELD: ${f.label} (key: ${f.key})
CURRENT VALUE: ${JSON.stringify(f.current || 'null')}
PROPOSED VALUE: ${JSON.stringify(f.extracted)}
CONFIDENCE SCORE: ${fieldConfidences[f.key]?.toFixed(2) || '0.50'}
RELEVANT RESEARCH:
${getRelevantResearch(f.key).substring(0, 2000)}${getRelevantResearch(f.key).length > 2000 ? '\n[... truncated ...]' : ''}
`).join('\n---\n')}

For each field, evaluate:
1. Should this field be updated? (Consider if proposed value is more accurate/complete)
2. Why or why not? (Provide reasoning)
3. What is the update priority? (high/medium/low - high for critical fields like coordinates, capacity, operator)

Return JSON object with "analyses" array:
{
  "analyses": [
    {
      "field": "field_key",
      "shouldUpdate": boolean,
      "reasoning": "string",
      "updatePriority": "high" | "medium" | "low"
    },
    ...
  ]
}
`;

                    try {
                        const batchAnalysisRes = await openai.chat.completions.create({
                            model: 'gpt-4o',
                            messages: [{ role: 'user', content: batchAnalysisPrompt }],
                            response_format: { type: 'json_object' },
                            temperature: 0.2,
                        });

                        const batchAnalysis = JSON.parse(batchAnalysisRes.choices[0].message.content || '{}');
                        const analyses = Array.isArray(batchAnalysis.analyses) ? batchAnalysis.analyses : (Array.isArray(batchAnalysis) ? batchAnalysis : []);

                        // Map analyses to field proposals with improved matching
                        for (const fieldInfo of fieldsWithData) {
                            // Try multiple matching strategies for field names (handle variations from LLM)
                            const analysis = analyses.find((a: any) => {
                                if (!a.field) return false;
                                const aField = String(a.field).toLowerCase().trim();
                                const keyLower = fieldInfo.key.toLowerCase();
                                const labelLower = fieldInfo.label.toLowerCase();
                                
                                // Exact match
                                if (aField === keyLower || aField === labelLower) return true;
                                
                                // Partial matches
                                if (aField.includes(keyLower) || keyLower.includes(aField)) return true;
                                if (aField.includes(labelLower) || labelLower.includes(aField)) return true;
                                
                                // Special cases for operatorType and parentCompanies
                                if (fieldInfo.key === 'operatorType' && (aField.includes('operator') || aField.includes('type'))) return true;
                                if (fieldInfo.key === 'parentCompanies' && (aField.includes('parent') || aField.includes('company'))) return true;
                                
                                // Handle snake_case variations
                                const keySnake = fieldInfo.key.replace(/([A-Z])/g, '_$1').toLowerCase();
                                if (aField === keySnake || aField.includes(keySnake)) return true;
                                
                                return false;
                            }) || analyses[fieldsWithData.indexOf(fieldInfo)] || {};
                            
                            // Default shouldUpdate to true if analysis is empty (let user decide in preview)
                            const shouldUpdate = analysis.shouldUpdate !== undefined ? analysis.shouldUpdate : true;
                            
                            // Get conflict information for this field
                            const fieldKeyMap: Record<string, string> = {
                                'operatorType': 'operator_type',
                                'parentCompanies': 'parent_companies',
                                'cargoTypes': 'cargo_types',
                                'capacity': 'capacity',
                                'coordinates': 'new_coordinates',
                                'portId': 'suggested_port_name'
                            };
                            const conflictKey = fieldKeyMap[fieldInfo.key];
                            const fieldConflicts = conflictData.conflicts?.find((c: any) => c.field === conflictKey);
                            
                            // Get source query names for this field
                            const sourceQueryIndices = fieldSources[fieldInfo.key] || [];
                            const sourceQueryNames = sourceQueryIndices.map(idx => reportTitles[idx] || `Query ${idx}`);
                            
                            fieldProposals.push({
                                field: fieldInfo.key,
                                currentValue: fieldInfo.current,
                                proposedValue: fieldInfo.extracted,
                                confidence: fieldConfidences[fieldInfo.key] || 0.5,
                                shouldUpdate,
                                reasoning: analysis.reasoning || 'No specific reasoning provided',
                                sources: sourceQueryNames.length > 0 ? sourceQueryNames : allSources,
                                updatePriority: analysis.updatePriority || (['coordinates', 'capacity', 'operatorGroup'].includes(fieldInfo.key) ? 'high' : 'medium'),
                                validationErrors: validationErrors[fieldInfo.key],
                                validationWarnings: validationWarnings[fieldInfo.key],
                                conflicts: fieldConflicts?.conflictingValues?.map((cv: any) => ({
                                    conflictingValue: cv.value,
                                    sourceQuery: cv.sourceQueryTitle || `Query ${cv.sourceQueryIndex}`,
                                    sourceIndex: cv.sourceQueryIndex,
                                    confidence: cv.confidence || 0.5,
                                    evidence: cv.evidence
                                })),
                                hasConflict: fieldConflicts && fieldConflicts.conflictingValues && fieldConflicts.conflictingValues.length > 1,
                                llmQuality: fieldQualities[fieldInfo.key]
                            });
                        }
                    } catch (e) {
                        // Fallback: use simple comparison for each field
                        for (const fieldInfo of fieldsWithData) {
                            const shouldUpdate = fieldInfo.current !== fieldInfo.extracted && 
                                               (fieldConfidences[fieldInfo.key] || 0.5) >= 0.5;
                            
                            // Get conflict information for this field
                            const fieldKeyMap: Record<string, string> = {
                                'operatorType': 'operator_type',
                                'parentCompanies': 'parent_companies',
                                'cargoTypes': 'cargo_types',
                                'capacity': 'capacity',
                                'coordinates': 'new_coordinates',
                                'portId': 'suggested_port_name'
                            };
                            const conflictKey = fieldKeyMap[fieldInfo.key];
                            const fieldConflicts = conflictData.conflicts?.find((c: any) => c.field === conflictKey);
                            
                            // Get source query names for this field
                            const sourceQueryIndices = fieldSources[fieldInfo.key] || [];
                            const sourceQueryNames = sourceQueryIndices.map(idx => reportTitles[idx] || `Query ${idx}`);
                            
                            fieldProposals.push({
                                field: fieldInfo.key,
                                currentValue: fieldInfo.current,
                                proposedValue: fieldInfo.extracted,
                                confidence: fieldConfidences[fieldInfo.key] || 0.5,
                                shouldUpdate,
                                reasoning: shouldUpdate ? 'Proposed value differs from current and has sufficient confidence' : 'Insufficient confidence or no change needed',
                                sources: sourceQueryNames.length > 0 ? sourceQueryNames : allSources,
                                updatePriority: ['coordinates', 'capacity', 'operatorType', 'parentCompanies'].includes(fieldInfo.key) ? 'high' : 'medium',
                                validationErrors: validationErrors[fieldInfo.key],
                                validationWarnings: validationWarnings[fieldInfo.key],
                                conflicts: fieldConflicts?.conflictingValues?.map((cv: any) => ({
                                    conflictingValue: cv.value,
                                    sourceQuery: cv.sourceQueryTitle || `Query ${cv.sourceQueryIndex}`,
                                    sourceIndex: cv.sourceQueryIndex,
                                    confidence: cv.confidence || 0.5,
                                    evidence: cv.evidence
                                })),
                                hasConflict: fieldConflicts && fieldConflicts.conflictingValues && fieldConflicts.conflictingValues.length > 1,
                                llmQuality: fieldQualities[fieldInfo.key]
                            });
                        }
                    }
                }


                // Generate research summary (truncate if needed)
                const summaryResearchText = researchText.length > 4000 ? researchText.substring(0, 4000) + '\n[... truncated ...]' : researchText;
                const summaryPrompt = `Summarize the key findings from this terminal research in 2-3 sentences:\n\n${summaryResearchText}`;
                let researchSummary = '';
                try {
                    const summaryRes = await openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [{ role: 'user', content: summaryPrompt }],
                        temperature: 0.3,
                    });
                    researchSummary = summaryRes.choices[0].message.content || researchText.substring(0, 200);
                } catch (e) {
                    researchSummary = researchText.substring(0, 200);
                }

                // Validation is now done in STEP 4.5 above
                // Additional critical validations that should prevent processing
                const criticalValidationErrors: string[] = [];
                
                // Check for critical validation errors that should stop processing
                for (const [fieldKey, errors] of Object.entries(validationErrors)) {
                    if (errors && errors.length > 0) {
                        // Only fail on critical errors, warnings are handled in proposals
                        const criticalErrors = errors.filter(e => 
                            e.includes('must be') || 
                            e.includes('required') || 
                            e.includes('cannot be')
                        );
                        if (criticalErrors.length > 0) {
                            criticalValidationErrors.push(`${fieldKey}: ${criticalErrors.join('; ')}`);
                        }
                    }
                }
                
                if (criticalValidationErrors.length > 0) {
                    throw {
                        category: 'VALIDATION_ERROR',
                        message: 'Critical validation errors detected. Please review the extracted data.',
                        originalError: criticalValidationErrors.join(' | '),
                        retryable: false
                    };
                }
                
                if (abortSignal.aborted) {
                    throw new Error('Request aborted');
                }

                // --- STEP 6: GENERATE NOTES/INTEL (Last Step) ---
                sendEvent('status', { message: 'Generating intelligence notes...', step: 'notes', progress: 98 });
                
                // Truncate researchText for notes (keep first 6000 chars ~1500 tokens)
                const notesResearchText = researchText.length > 6000 ? researchText.substring(0, 6000) + '\n\n[... truncated for token limits ...]' : researchText;
                
                const notesPrompt = `
Based on the research findings below, generate strategic intelligence notes for this terminal operator.
Include:
- Strategic insights not captured in structured fields
- Operational context
- Recent developments or changes
- Data quality observations
- Any other relevant intelligence

RESEARCH FINDINGS:
${notesResearchText}

CURRENT NOTES:
${operator.strategicNotes || '(none)'}

Format: Append new findings to existing notes with a separator.
Return JSON:
{
  "newFindings": "string - new intelligence findings",
  "combinedNotes": "string - existing notes + new findings with separator"
}
`;

                let notesProposal = {
                    currentNotes: operator.strategicNotes || '',
                    newFindings: '',
                    combinedNotes: operator.strategicNotes || ''
                };

                try {
                    const notesRes = await openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [{ role: 'user', content: notesPrompt }],
                        response_format: { type: 'json_object' },
                        temperature: 0.4,
                    });
                    const notesData = JSON.parse(notesRes.choices[0].message.content || '{}');
                    notesProposal = {
                        currentNotes: operator.strategicNotes || '',
                        newFindings: notesData.newFindings || '',
                        combinedNotes: notesData.combinedNotes || operator.strategicNotes || ''
                    };
                } catch (e) {
                    // Fallback: simple append
                    const dateStr = new Date().toISOString().split('T')[0];
                    notesProposal = {
                        currentNotes: operator.strategicNotes || '',
                        newFindings: `--- Deep Research ${dateStr} ---\nKey findings from research: ${researchSummary}`,
                        combinedNotes: operator.strategicNotes 
                            ? `${operator.strategicNotes}\n\n--- Deep Research ${dateStr} ---\n${researchSummary}`
                            : `--- Deep Research ${dateStr} ---\n${researchSummary}`
                    };
                }

                // --- STEP 7: BUILD UPDATE DATA FROM PROPOSALS ---
                sendEvent('status', { message: 'Preparing changes for review...', step: 'prepare', progress: 99 });

                interface OperatorUpdateData {
                    lastDeepResearchAt: Date;
                    lastDeepResearchSummary: string;
                    operatorType?: string;
                    parentCompanies?: string;
                    cargoTypes?: string;
                    capacity?: string;
                    latitude?: number;
                    longitude?: number;
                    portId?: string;
                    strategicNotes?: string;
                }

                const dataToUpdate: OperatorUpdateData = {
                    lastDeepResearchAt: new Date(),
                    lastDeepResearchSummary: researchSummary,
                };

                // Process port change if needed
                let portChangeSuggestion: { from: string; to: string; country: string } | null = null;
                const portProposal = fieldProposals.find(p => p.field === 'portId');
                if (portProposal && portProposal.shouldUpdate && typeof portProposal.proposedValue === 'string') {
                    const allPorts = await prisma.port.findMany();
                    let suggestedPort = allPorts.find(
                        p => p.name.toLowerCase() === portProposal.proposedValue.toLowerCase()
                    );

                    if (!suggestedPort) {
                        const matchingPorts = allPorts.filter(
                            p => p.name.toLowerCase().includes(portProposal.proposedValue.toLowerCase()) &&
                                 p.country === operator.port.country
                        );
                        if (matchingPorts.length === 1) {
                            suggestedPort = matchingPorts[0];
                        }
                    }

                    if (suggestedPort && suggestedPort.id !== operator.portId && suggestedPort.country === operator.port.country) {
                        dataToUpdate.portId = suggestedPort.id;
                        portChangeSuggestion = {
                            from: operator.port.name,
                            to: suggestedPort.name,
                            country: suggestedPort.country
                        };
                    } else if (suggestedPort) {
                        portChangeSuggestion = {
                            from: operator.port.name,
                            to: suggestedPort.name,
                            country: suggestedPort.country
                        };
                    }
                }

                // Build field proposals with proper formatting
                // IMPORTANT: Include ALL proposals in dataToUpdate so user can approve/reject them
                // The shouldUpdate and confidence checks are for UI display only - user makes final decision
                const formattedFieldProposals = fieldProposals.map(proposal => {
                    let formattedProposal = { ...proposal };
                    
                    // Format coordinates
                    if (proposal.field === 'coordinates' && typeof proposal.proposedValue === 'object' && proposal.proposedValue !== null) {
                        // Always include in dataToUpdate if there's a proposed value (user will decide)
                        dataToUpdate.latitude = proposal.proposedValue.lat;
                        dataToUpdate.longitude = proposal.proposedValue.lon;
                    }
                    // Format cargo types
                    else if (proposal.field === 'cargoTypes' && Array.isArray(proposal.proposedValue)) {
                        // Always include in dataToUpdate if there's a proposed value
                        dataToUpdate.cargoTypes = JSON.stringify(proposal.proposedValue);
                    }
                    // Format other fields - include ALL proposals in dataToUpdate for user approval
                    else if (proposal.proposedValue !== null && proposal.proposedValue !== undefined && proposal.proposedValue !== '') {
                        if (proposal.field === 'operatorType') {
                            dataToUpdate.operatorType = proposal.proposedValue;
                        } else if (proposal.field === 'parentCompanies' && Array.isArray(proposal.proposedValue)) {
                            dataToUpdate.parentCompanies = JSON.stringify(proposal.proposedValue);
                        } else if (proposal.field === 'capacity') {
                            dataToUpdate.capacity = proposal.proposedValue;
                        }
                    }

                    // Add auto-approved flag
                    formattedProposal = {
                        ...formattedProposal,
                        autoApproved: proposal.confidence > 0.80
                    };

                    return formattedProposal;
                });

                // Add strategic notes proposal (always included, user can edit)
                formattedFieldProposals.push({
                    field: 'strategicNotes',
                    currentValue: notesProposal.currentNotes,
                    proposedValue: notesProposal.combinedNotes,
                    confidence: 0.7, // Medium confidence for notes
                    shouldUpdate: true,
                    reasoning: 'Intelligence notes generated from research findings',
                    sources: allSources,
                    updatePriority: 'low',
                    autoApproved: false // Notes always require review
                });
                
                // Add strategic notes to dataToUpdate
                if (notesProposal) {
                    dataToUpdate.strategicNotes = notesProposal.combinedNotes;
                }

                // --- STEP 8: SEND PREVIEW EVENT ---
                sendEvent('status', { message: 'Research complete - Review changes', step: 'complete', progress: 100 });

                sendEvent('preview', {
                    field_proposals: formattedFieldProposals,
                    notes_proposal: notesProposal,
                    research_queries: researchQueries,
                    full_report: researchText,
                    concise_summary: researchSummary,
                    port_change_suggestion: portChangeSuggestion,
                    data_to_update: dataToUpdate
                });

                // Save full research report to database (overwrites previous report)
                // This MUST succeed for persistence to work
                try {
                    // Clean and prepare report for storage
                    const MAX_REPORT_SIZE = 500 * 1024; // 500KB limit for safety
                    let reportToSave = String(researchText || '').trim();
                    
                    // Remove problematic characters
                    reportToSave = reportToSave.replace(/\0/g, ''); // Remove null bytes
                    
                    // Truncate if too large
                    if (reportToSave.length > MAX_REPORT_SIZE) {
                        reportToSave = reportToSave.substring(0, MAX_REPORT_SIZE) + '\n\n[... report truncated due to size limit ...]';
                    }
                    
                    // Save to database - this is critical for persistence
                    await prisma.terminalOperator.update({
                        where: { id: operatorId },
                        data: { 
                            lastDeepResearchReport: reportToSave,
                            lastDeepResearchAt: new Date() // Also update timestamp
                        }
                    });
                } catch (dbError) {
                    // This is a critical error - log it but don't fail the request
                    const errorMsg = dbError instanceof Error ? dbError.message : String(dbError);
                    const errorStack = dbError instanceof Error ? dbError.stack?.substring(0, 1000) : undefined;
                    console.error('CRITICAL: Failed to save full research report to database:', dbError);
                    // Send error event to frontend so user knows
                    sendEvent('error', {
                        category: 'DATABASE_ERROR',
                        message: 'Research completed but failed to save report. Report will not persist after refresh.',
                        originalError: errorMsg,
                        retryable: false
                    });
                }

                controller.close();
            } catch (error: unknown) {
                // Handle categorized errors
                if (error && typeof error === 'object' && 'category' in error) {
                    const err = error as { category: string; message: string; originalError?: string; retryable: boolean };
                    sendEvent('error', {
                        category: err.category,
                        message: err.message,
                        originalError: err.originalError,
                        retryable: err.retryable
                    });
                } else if (error instanceof Error) {
                    // Check if it's an abort
                    if (error.message === 'Request aborted' || error.name === 'AbortError') {
                        sendEvent('error', {
                            category: 'NETWORK_ERROR',
                            message: 'Research was cancelled.',
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
