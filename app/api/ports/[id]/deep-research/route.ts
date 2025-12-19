import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import OpenAI from 'openai';
import { geocodePort } from '@/lib/geocoding';
import { executeResearchQuery, getResearchProvider } from '@/lib/research-provider';
import { writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import {
    validatePortAuthority,
    validateISPSLevel,
    validateEnforcementStrength,
    validateIdentityCompetitors,
    validateIdentityAdoptionRate,
    validateCoordinates
} from '@/lib/field-validation';

// Force node runtime for network calls and streaming
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Helper function to write debug logs to file
function writeDebugLog(message: string, data?: any) {
    const logPath = join(process.cwd(), '.cursor', 'debug-runtime.log');
    const logEntry = `[${new Date().toISOString()}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
    try {
        appendFileSync(logPath, logEntry, 'utf8');
    } catch (err) {
        // Log to console if file write fails
        console.error('[DEBUG] Failed to write to log file:', err);
    }
    // Always log to console.error for visibility
    console.error(message, data || '');
    console.log(message, data || '');
}

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    writeDebugLog(`[DEBUG] ========== DEEP RESEARCH ROUTE HANDLER CALLED ==========`);
    writeDebugLog(`[DEBUG] Port ID from params: ${params.id}`);
    writeDebugLog(`[DEBUG] Request URL: ${request.url}`);
    // Validate environment variables early - provider-aware
    const provider = getResearchProvider();
    writeDebugLog(`[DEBUG] Research provider: ${provider}`);
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
    
    // Check if running in background mode (ignore abort signals)
    const url = new URL(request.url);
    const isBackgroundMode = url.searchParams.get('background') === 'true' || 
                             request.headers.get('X-Background-Mode') === 'true';
    
    // Per-query timeout for research queries
    // Standard queries: 3 minutes, Deep research (sonar-deep-research): 5 minutes
    const RESEARCH_QUERY_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for standard queries
    const DEEP_RESEARCH_QUERY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for sonar-deep-research
    
    /**
     * Create a timeout-based abort signal for background mode queries
     * This ensures individual research queries don't hang indefinitely
     * @param timeoutMs Optional timeout in milliseconds (defaults to RESEARCH_QUERY_TIMEOUT_MS)
     */
    function createQueryTimeoutSignal(timeoutMs?: number): AbortSignal {
        const timeout = timeoutMs ?? RESEARCH_QUERY_TIMEOUT_MS;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            console.log(`[DEBUG] ========== QUERY TIMEOUT TRIGGERED after ${timeout}ms ==========`);
            controller.abort();
        }, timeout);
        
        // Store timeout ID on the signal for potential cleanup
        (controller.signal as any)._timeoutId = timeoutId;
        console.log(`[DEBUG] Created query timeout signal - will abort after ${timeout}ms`);
        
        return controller.signal;
    }
    
    // Create a no-op abort signal for background mode (never aborts) - only used for non-query operations
    const noOpAbortController = new AbortController();
    const backgroundAbortSignal = noOpAbortController.signal;

    // 1. Validate Port
    const port = await prisma.port.findUnique({
        where: { id: portId },
        include: { cluster: true, terminals: true },
    });

    if (!port) {
        return new Response(JSON.stringify({ error: 'Port not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // 2. Set up Streaming Response
    const encoder = new TextEncoder();
    const streamStartTime = Date.now();
    writeDebugLog(`[DEBUG] Creating ReadableStream, isBackgroundMode: ${isBackgroundMode}`);
    const stream = new ReadableStream({
        async start(controller) {
            writeDebugLog(`[DEBUG] ========== STREAM START FUNCTION EXECUTED ==========`);
            writeDebugLog(`[DEBUG] Port ID: ${portId}, Background mode: ${isBackgroundMode}`);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:83',message:'Stream start',data:{portId,isBackgroundMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
            // #endregion
                const sendEvent = (event: string, data: unknown) => {
                try {
                    const eventData = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
                    controller.enqueue(encoder.encode(eventData));
                    const progress = (data as any)?.progress || 'N/A';
                    writeDebugLog(`[DEBUG] sendEvent: ${event}, progress: ${progress}`);
                } catch (err) {
                    writeDebugLog(`[DEBUG] sendEvent ERROR: ${err instanceof Error ? err.message : String(err)}`);
                }
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
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:91',message:'Abort signal setup',data:{portId,isBackgroundMode,aborted:abortSignal.aborted},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
            // #endregion

            // Confidence scoring function
            const calculateConfidence = (content: string, sources: string[]): number => {
                let score = 0;
                
                // Source quality (0.3 max)
                const hasOfficialSource = content.toLowerCase().includes('port authority') || 
                                         content.toLowerCase().includes('official') ||
                                         content.toLowerCase().includes('government') ||
                                         content.toLowerCase().includes('customs');
                const hasDirectory = content.toLowerCase().includes('directory') || 
                                   content.toLowerCase().includes('maritime');
                if (hasOfficialSource) score += 0.3;
                else if (hasDirectory) score += 0.2;
                else if (sources.length > 0) score += 0.1;
                
                // Data consistency (0.3 max)
                if (sources.length >= 2) score += 0.3;
                else if (sources.length === 1) score += 0.15;
                else score += 0.05;
                
                // Recency (0.2 max)
                const yearMatch = content.match(/\b(20\d{2})\b/);
                if (yearMatch) {
                    const year = parseInt(yearMatch[1]);
                    const currentYear = new Date().getFullYear();
                    const age = currentYear - year;
                    if (age <= 1) score += 0.2;
                    else if (age <= 3) score += 0.1;
                    else score += 0.05;
                } else {
                    score += 0.1;
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
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:137',message:'Starting research process',data:{portId,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                // #endregion
                console.log(`\n[Deep Research] ========================================`);
                console.log(`[Deep Research] Starting deep research for: ${port.name} (${port.country})`);
                console.log(`[Deep Research] Port ID: ${portId}`);
                console.log(`[Deep Research] Background mode: ${isBackgroundMode ? 'Yes' : 'No'}`);
                console.log(`[Deep Research] ========================================\n`);
                console.log(`[Deep Research] ${port.name} (${port.country}) - Initializing port research... [0%]`);
                sendEvent('status', { message: 'Initializing port research...', step: 'init', progress: 0 });
                
                if (abortSignal.aborted) {
                    throw new Error('Request aborted');
                }

                // --- STEP 2: MULTI-QUERY RESEARCH (PARALLEL) ---
                const researchQueries: Array<{ query: string; result: string; sources: string[]; queryType: string }> = [];
                
                // Execute queries 1-3 in parallel for maximum speed
                console.log(`[Deep Research] ${port.name} - Researching governance, ISPS risk, and strategic intelligence in parallel... [20%]`);
                console.log(`[DEBUG] Before parallel queries - portId: ${portId}, isBackgroundMode: ${isBackgroundMode}, elapsed: ${Date.now()-streamStartTime}ms`);
                sendEvent('status', { message: 'Researching governance, ISPS risk, and strategic intelligence...', step: 'parallel_queries', progress: 20 });
                
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:202',message:'Before parallel queries',data:{portId,isBackgroundMode,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                
                // Optimized queries - focused and concise
                const query1 = `Research the port authority and governance structure for ${port.name} in ${port.country}. Focus on: port authority name, governance model, decision-making processes. Cite sources.`;
                const query2 = `Assess ISPS security risk level and enforcement strength at ${port.name}. Include: risk level (Low/Medium/High/Very High), enforcement strength (Weak/Moderate/Strong/Very Strong), security incidents. Cite sources.`;
                const query5 = `Analyze network effects and cluster dynamics for ${port.name} in the ${port.cluster.name} cluster. Include: coordination with other ports, expansion opportunities, competitive positioning. Cite sources.`;
                
                const parallelStart = Date.now();
                writeDebugLog(`[DEBUG] ========== STARTING PARALLEL QUERIES ==========`);
                writeDebugLog(`[DEBUG] Promise.allSettled starting - timeout: ${RESEARCH_QUERY_TIMEOUT_MS}ms`);
                writeDebugLog(`[DEBUG] Time since stream start: ${Date.now() - streamStartTime}ms`);
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:211',message:'Promise.allSettled starting',data:{portId,timeoutMs:RESEARCH_QUERY_TIMEOUT_MS,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                
                // Create the parallel queries promise
                const parallelQueriesPromise: Promise<[PromiseSettledResult<any>, PromiseSettledResult<any>, PromiseSettledResult<any>]> = Promise.allSettled([
                    (async () => {
                        // #region agent log
                        const abortSignal1 = getQueryAbortSignal();
                        console.log(`[DEBUG] Query 1 (governance) starting - aborted: ${abortSignal1.aborted}, isBackgroundMode: ${isBackgroundMode}`);
                        fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:217',message:'Query 1 starting',data:{portId,aborted:abortSignal1.aborted,isBackgroundMode,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                        // #endregion
                        const query1Start = Date.now();
                        try {
                            writeDebugLog(`[DEBUG] Query 1 calling executeResearchQuery...`);
                            const res = await executeResearchQuery(query1, 'governance', abortSignal1);
                            const query1Duration = ((Date.now() - query1Start) / 1000).toFixed(1);
                            console.log(`[Deep Research] ${port.name} - Governance query completed (${query1Duration}s)`);
                            writeDebugLog(`[DEBUG] Query 1 success - duration: ${query1Duration}s`);
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:223',message:'Query 1 success',data:{portId,queryDuration:Date.now()-query1Start,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                            // #endregion
                            return { query: query1, result: res.content, sources: res.sources, name: 'governance' };
                        } catch (err: any) {
                            writeDebugLog(`[DEBUG] Query 1 ERROR: ${err?.message || String(err)}, aborted: ${abortSignal1.aborted}`);
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:227',message:'Query 1 error',data:{portId,error:err?.message||String(err),aborted:abortSignal1.aborted,queryDuration:Date.now()-query1Start,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                            // #endregion
                            throw err;
                        }
                    })(),
                    (async () => {
                        // #region agent log
                        const abortSignal2 = getQueryAbortSignal();
                        fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:232',message:'Query 2 starting',data:{portId,aborted:abortSignal2.aborted,isBackgroundMode,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                        // #endregion
                        const query2Start = Date.now();
                        try {
                            const res = await executeResearchQuery(query2, 'isps_risk', abortSignal2);
                            const query2Duration = ((Date.now() - query2Start) / 1000).toFixed(1);
                            console.log(`[Deep Research] ${port.name} - ISPS query completed (${query2Duration}s)`);
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:238',message:'Query 2 success',data:{portId,queryDuration:Date.now()-query2Start,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                            // #endregion
                            return { query: query2, result: res.content, sources: res.sources, name: 'isps_risk' };
                        } catch (err: any) {
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:242',message:'Query 2 error',data:{portId,error:err?.message||String(err),aborted:abortSignal2.aborted,queryDuration:Date.now()-query2Start,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                            // #endregion
                            throw err;
                        }
                    })(),
                    (async () => {
                        // #region agent log
                        // Strategic Intelligence uses sonar-deep-research which requires 5+ minutes, so use longer timeout
                        const abortSignal5 = isBackgroundMode 
                            ? createQueryTimeoutSignal(DEEP_RESEARCH_QUERY_TIMEOUT_MS) // 5 minutes for deep research model
                            : getQueryAbortSignal();
                        fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:247',message:'Query 3 starting',data:{portId,aborted:abortSignal5.aborted,isBackgroundMode,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                        // #endregion
                        const query5Start = Date.now();
                        try {
                            const res = await executeResearchQuery(query5, 'strategic_intelligence', abortSignal5);
                            const query5Duration = ((Date.now() - query5Start) / 1000).toFixed(1);
                            console.log(`[Deep Research] ${port.name} - Strategic intelligence query completed (${query5Duration}s)`);
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:253',message:'Query 3 success',data:{portId,queryDuration:Date.now()-query5Start,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                            // #endregion
                            return { query: query5, result: res.content, sources: res.sources, name: 'strategic_intelligence' };
                        } catch (err: any) {
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:257',message:'Query 3 error',data:{portId,error:err?.message||String(err),aborted:abortSignal5.aborted,queryDuration:Date.now()-query5Start,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                            // #endregion
                            throw err;
                        }
                    })()
                ]);
                
                // Add a safety timeout wrapper - account for one deep research query (5 min) + two standard queries (3 min each)
                // Use max of: (3 standard queries * 3 min) OR (2 standard + 1 deep research = 2*3 + 5 = 11 min)
                const PARALLEL_QUERIES_MAX_TIME = Math.max(RESEARCH_QUERY_TIMEOUT_MS * 3, DEEP_RESEARCH_QUERY_TIMEOUT_MS + RESEARCH_QUERY_TIMEOUT_MS * 2);
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => {
                        console.error(`[DEBUG] ========== PARALLEL QUERIES TIMEOUT after ${PARALLEL_QUERIES_MAX_TIME}ms ==========`);
                        reject(new Error(`Parallel queries exceeded maximum time of ${PARALLEL_QUERIES_MAX_TIME}ms`));
                    }, PARALLEL_QUERIES_MAX_TIME);
                });
                
                console.log(`[DEBUG] Waiting for parallel queries (max time: ${PARALLEL_QUERIES_MAX_TIME}ms)...`);
                let result1: PromiseSettledResult<any>, result2: PromiseSettledResult<any>, result5: PromiseSettledResult<any>;
                try {
                    [result1, result2, result5] = await Promise.race([
                        parallelQueriesPromise,
                        timeoutPromise
                    ]);
                } catch (timeoutError: any) {
                    console.error(`[DEBUG] Parallel queries timed out: ${timeoutError?.message}`);
                    // If timeout, create rejected results for all queries
                    const timeoutResult = { status: 'rejected' as const, reason: timeoutError };
                    result1 = timeoutResult;
                    result2 = timeoutResult;
                    result5 = timeoutResult;
                }
                
                const parallelDuration = ((Date.now() - parallelStart) / 1000).toFixed(1);
                writeDebugLog(`[DEBUG] ========== PARALLEL QUERIES COMPLETED ==========`);
                writeDebugLog(`[DEBUG] Duration: ${parallelDuration}s`);
                writeDebugLog(`[DEBUG] Results - result1: ${result1.status}, result2: ${result2.status}, result5: ${result5.status}`);
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:262',message:'Promise.allSettled completed',data:{portId,parallelDuration:((Date.now()-parallelStart)/1000).toFixed(1),elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                
                console.log(`[Deep Research] ${port.name} - All parallel queries completed in ${parallelDuration}s`);
                
                // Process results and track failed queries for retry
                const failedQueries: Array<{ query: string; queryType: string; error: any; retryable: boolean }> = [];
                
                if (result1.status === 'fulfilled') {
                    researchQueries.push({ query: result1.value.query, result: result1.value.result, sources: result1.value.sources, queryType: 'governance' });
                } else {
                    const error = result1.reason;
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    const isTimeout = errorMsg.includes('aborted') || errorMsg.includes('timeout') || errorMsg.includes('AbortError');
                    const isRetryable = !isTimeout && (typeof error === 'object' && error !== null && 'retryable' in error ? error.retryable : true) && !errorMsg.includes('401');
                    
                    if (isTimeout) {
                        console.error(`[Deep Research] ${port.name} - Governance query TIMEOUT after ${RESEARCH_QUERY_TIMEOUT_MS / 1000}s: ${errorMsg}`);
                    } else {
                        console.warn(`[Deep Research] ${port.name} - Governance query failed: ${errorMsg}`, error);
                        if (isRetryable) {
                            failedQueries.push({ query: query1, queryType: 'governance', error, retryable: true });
                        }
                    }
                }
                
                if (result2.status === 'fulfilled') {
                    researchQueries.push({ query: result2.value.query, result: result2.value.result, sources: result2.value.sources, queryType: 'isps_risk' });
                } else {
                    const error = result2.reason;
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    const isTimeout = errorMsg.includes('aborted') || errorMsg.includes('timeout') || errorMsg.includes('AbortError');
                    const isRetryable = !isTimeout && (typeof error === 'object' && error !== null && 'retryable' in error ? error.retryable : true) && !errorMsg.includes('401');
                    
                    if (isTimeout) {
                        console.error(`[Deep Research] ${port.name} - ISPS query TIMEOUT after ${RESEARCH_QUERY_TIMEOUT_MS / 1000}s: ${errorMsg}`);
                    } else {
                        console.warn(`[Deep Research] ${port.name} - ISPS query failed: ${errorMsg}`, error);
                        if (isRetryable) {
                            failedQueries.push({ query: query2, queryType: 'isps_risk', error, retryable: true });
                        }
                    }
                }
                
                if (result5.status === 'fulfilled') {
                    researchQueries.push({ query: result5.value.query, result: result5.value.result, sources: result5.value.sources, queryType: 'strategic_intelligence' });
                } else {
                    const error = result5.reason;
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    const isTimeout = errorMsg.includes('aborted') || errorMsg.includes('timeout') || errorMsg.includes('AbortError');
                    // Strategic Intelligence queries using sonar-deep-research can take longer, so allow timeout retries
                    const isRetryable = (isTimeout || (typeof error === 'object' && error !== null && 'retryable' in error ? error.retryable : true)) && !errorMsg.includes('401');
                    
                    // Enhanced logging for Strategic Intelligence query failures
                    if (isTimeout) {
                        console.error(`[Deep Research] ${port.name} - Strategic intelligence query TIMEOUT after ${RESEARCH_QUERY_TIMEOUT_MS / 1000}s: ${errorMsg}`);
                        console.log(`[Deep Research] ${port.name} - Will retry Strategic intelligence query (deep research models can take longer)`);
                    } else {
                        const errorDetails = typeof error === 'object' && error !== null ? {
                            category: 'category' in error ? error.category : 'UNKNOWN',
                            message: 'message' in error ? error.message : errorMsg,
                            originalError: 'originalError' in error ? error.originalError : errorMsg,
                            retryable: isRetryable,
                            status: 'status' in error ? error.status : undefined
                        } : { error: errorMsg, retryable: isRetryable };
                        console.error(`[Deep Research] ${port.name} - Strategic intelligence query FAILED:`, JSON.stringify(errorDetails, null, 2));
                    }
                    // Always retry Strategic Intelligence queries (including timeouts) since deep research can take longer
                    if (isRetryable) {
                        failedQueries.push({ query: query5, queryType: 'strategic_intelligence', error, retryable: true });
                    }
                }
                
                // Retry failed queries (one retry per query with 2s delay)
                if (failedQueries.length > 0) {
                    console.log(`[Deep Research] ${port.name} - Retrying ${failedQueries.length} failed query/queries after 2s delay...`);
                    sendEvent('status', { message: `Retrying ${failedQueries.length} failed query/queries...`, step: 'retry_queries', progress: 65 });
                    
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
                    
                    for (const failedQuery of failedQueries) {
                        try {
                            console.log(`[Deep Research] ${port.name} - Retrying ${failedQuery.queryType} query...`);
                            writeDebugLog(`[DEBUG] Retrying ${failedQuery.queryType} query...`);
                            const retryStart = Date.now();
                            // For Strategic Intelligence retries, use a longer timeout (5 minutes instead of 3)
                            const retryAbortSignal = failedQuery.queryType === 'strategic_intelligence' 
                                ? createQueryTimeoutSignal(DEEP_RESEARCH_QUERY_TIMEOUT_MS) // 5 minutes for deep research retry
                                : getQueryAbortSignal();
                            const retryRes = await executeResearchQuery(failedQuery.query, failedQuery.queryType, retryAbortSignal);
                            const retryDuration = ((Date.now() - retryStart) / 1000).toFixed(1);
                            console.log(`[Deep Research] ${port.name} - ${failedQuery.queryType} query RETRY SUCCESS (${retryDuration}s)`);
                            writeDebugLog(`[DEBUG] ${failedQuery.queryType} query RETRY SUCCESS (${retryDuration}s)`);
                            researchQueries.push({ 
                                query: failedQuery.query, 
                                result: retryRes.content, 
                                sources: retryRes.sources, 
                                queryType: failedQuery.queryType 
                            });
                        } catch (retryError: any) {
                            const retryErrorMsg = retryError instanceof Error ? retryError.message : String(retryError);
                            console.error(`[Deep Research] ${port.name} - ${failedQuery.queryType} query RETRY FAILED: ${retryErrorMsg}`, retryError);
                            writeDebugLog(`[DEBUG] ${failedQuery.queryType} query RETRY FAILED: ${retryErrorMsg}`);
                        }
                    }
                }
                
                console.log(`[Deep Research] ${port.name} - Research queries complete. ${researchQueries.length}/3 successful. [70%]`);
                sendEvent('status', { message: `Research complete. ${researchQueries.length}/3 queries successful.`, step: 'queries_complete', progress: 70 });

                // --- STEP 2.5: GEOCODE PORT LOCATION ---
                console.log(`[Deep Research] ${port.name} - Geocoding port location... [75%]`);
                sendEvent('status', { message: 'Geocoding port location...', step: 'geocode', progress: 75 });
                let portLocation: { latitude: number; longitude: number } | null = null;
                
                // Only geocode if port doesn't already have coordinates
                if (!port.latitude || !port.longitude) {
                    try {
                        portLocation = await geocodePort(port.name, port.country);
                        if (portLocation) {
                            console.log(`[Deep Research] ${port.name} - Location found: ${portLocation.latitude}, ${portLocation.longitude}`);
                            sendEvent('status', { message: `Location found: ${portLocation.latitude}, ${portLocation.longitude}`, step: 'geocode', progress: 80 });
                        } else {
                            console.warn(`[Deep Research] ${port.name} - Could not geocode port location`);
                            sendEvent('status', { message: 'Warning: Could not geocode port location', step: 'geocode', progress: 80 });
                        }
                    } catch (e) {
                        console.warn(`[Deep Research] ${port.name} - Geocoding failed: ${e instanceof Error ? e.message : String(e)}`);
                        sendEvent('status', { message: 'Warning: Geocoding failed, continuing...', step: 'geocode', progress: 80 });
                    }
                } else {
                    console.log(`[Deep Research] ${port.name} - Port already has coordinates, skipping geocoding`);
                    sendEvent('status', { message: 'Port already has coordinates, skipping geocoding', step: 'geocode', progress: 80 });
                }

                // Combine all research results with section headers and query indices
                const queryTypeToTitle: Record<string, string> = {
                    'governance': '## Governance Report',
                    'isps_risk': '## ISPS Risk & Enforcement Report',
                    'strategic_intelligence': '## Strategic Intelligence Report'
                };
                
                const researchText = researchQueries.map((q) => {
                    const title = queryTypeToTitle[q.queryType] || `## Report`;
                    return `${title}\n\n${q.result}`;
                }).join('\n\n---\n\n');

                // --- STEP 3: EXTRACT STRUCTURED DATA ---
                console.log(`[Deep Research] ${port.name} - Extracting structured data... [85%]`);
                sendEvent('status', { message: 'Extracting structured data...', step: 'extract', progress: 85 });
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:229',message:'Before extraction',data:{portId,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                // #endregion
                
                // Use more context - summarize if too long instead of truncating
                let extractResearchText = researchText;
                if (researchText.length > 12000) {
                    // For very long research, include first 8000 chars and last 2000 chars
                    extractResearchText = researchText.substring(0, 8000) + '\n\n[... middle section truncated ...]\n\n' + researchText.substring(researchText.length - 2000);
                } else if (researchText.length > 6000) {
                    extractResearchText = researchText.substring(0, 6000) + '\n\n[... truncated ...]';
                }
                
                // Build query index map for source attribution - map original query types to actual indices
                const originalQueryTypeMap: Record<string, number> = {
                    'governance': 0,
                    'isps_risk': 1,
                    'strategic_intelligence': 2
                };
                
                // Create mapping from original query type to actual index in researchQueries
                const queryTypeToIndex: Record<string, number> = {};
                researchQueries.forEach((q, idx) => {
                    queryTypeToIndex[q.queryType] = idx;
                });
                
                // Build query index map with correct titles
                const queryIndexMap = researchQueries.map((q, idx) => ({
                    index: idx,
                    originalType: q.queryType,
                    originalIndex: originalQueryTypeMap[q.queryType],
                    query: q.query.substring(0, 100) + '...',
                    title: queryTypeToTitle[q.queryType] || `Report`
                }));
                
                // Build dynamic query index description
                const queryIndexDescription = queryIndexMap.map(q => {
                    const typeName = q.originalType === 'governance' ? 'Governance' : 
                                   q.originalType === 'isps_risk' ? 'ISPS Risk' : 
                                   'Strategic Intelligence';
                    return `${q.index}=${typeName}`;
                }).join(', ');
                
                const extractPrompt = `
Extract structured data from the research findings below. For each field you extract, provide:
1. The extracted value
2. Your confidence in the extraction (0.0 to 1.0, where 1.0 = explicit mention, 0.5 = inferred, 0.3 = partial/uncertain)
3. Which research query/queries provided this information (use query indices: ${queryIndexDescription})
4. Quality indicator: "explicit" (directly stated), "inferred" (logically derived), or "partial" (incomplete/uncertain)

RESEARCH QUERIES:
${queryIndexMap.map(q => `Query ${q.index} (${q.title.replace('## ', '')}): ${q.query}`).join('\n')}

RESEARCH FINDINGS:
${extractResearchText}

CURRENT PORT DATA:
- Name: ${port.name}
- Country: ${port.country}
- Cluster: ${port.cluster.name}
- Port Authority: ${port.portAuthority || 'unknown'}
- ISPS Risk: ${port.portLevelISPSRisk || 'unknown'}
- Enforcement: ${port.ispsEnforcementStrength || 'unknown'}

Return JSON with this structure (query indices: ${queryIndexDescription}):
{
  "port_authority": {
    "value": "string | null",
    "confidence": 0.0-1.0,
    "sources": [0],  // Array of query indices from available queries (examples only - use actual indices from: ${queryIndexDescription})
    "quality": "explicit | inferred | partial"
  },
  "identity_competitors": {
    "value": ["string"] | null,
    "confidence": 0.0-1.0,
    "sources": [0],  // Use indices from available queries
    "quality": "explicit | inferred | partial"
  },
  "identity_adoption_rate": {
    "value": "string | null",
    "confidence": 0.0-1.0,
    "sources": [0],  // Use indices from available queries
    "quality": "explicit | inferred | partial"
  },
  "port_level_isps_risk": {
    "value": "Low | Medium | High | Very High | null",
    "confidence": 0.0-1.0,
    "sources": [0],  // Use indices from available queries
    "quality": "explicit | inferred | partial"
  },
  "isps_enforcement_strength": {
    "value": "Weak | Moderate | Strong | Very Strong | null",
    "confidence": 0.0-1.0,
    "sources": [0],  // Use indices from available queries
    "quality": "explicit | inferred | partial"
  }
}

IMPORTANT:
- Use null for value if the field is not found in the research
- Confidence should reflect how certain you are about the extraction
- Sources should list all query indices (0-2) that mention this information
- Quality should indicate how the information was found
`;

                let extractRes;
                try {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:259',message:'Before OpenAI extraction call',data:{portId,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                    // #endregion
                    const extractStart = Date.now();
                    console.log(`[Deep Research] ${port.name} - Calling OpenAI for data extraction...`);
                    extractRes = await openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [{ role: 'user', content: extractPrompt }],
                        response_format: { type: 'json_object' },
                    });
                    const extractDuration = ((Date.now() - extractStart) / 1000).toFixed(1);
                    console.log(`[Deep Research] ${port.name} - Data extraction completed (${extractDuration}s)`);
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:264',message:'After OpenAI extraction call',data:{portId,extractDuration:Date.now()-extractStart,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                    // #endregion
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
                    const extractContent = extractRes.choices[0].message.content || '{}';
                    extractedData = JSON.parse(extractContent);
                    console.log(`[Deep Research] ${port.name} - Extracted data keys: ${Object.keys(extractedData).join(', ')}`);
                    console.log(`[Deep Research] ${port.name} - Research queries available: ${researchQueries.length}, types: ${researchQueries.map(q => q.queryType).join(', ')}`);
                } catch (parseError) {
                    console.error(`[Deep Research] ${port.name} - Failed to parse extraction JSON:`, parseError);
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
                    'port_authority': 'portAuthority',
                    'identity_competitors': 'identityCompetitors',
                    'identity_adoption_rate': 'identityAdoptionRate',
                    'port_level_isps_risk': 'portLevelISPSRisk',
                    'isps_enforcement_strength': 'ispsEnforcementStrength'
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
                console.log(`[Deep Research] ${port.name} - Calculating confidence scores... [94%]`);
                sendEvent('status', { message: 'Calculating confidence scores...', step: 'confidence', progress: 94 });
                
                const fieldConfidences: Record<string, number> = {};
                const allSources = researchQueries.flatMap(q => q.sources);
                
                // Combine LLM confidence with heuristic confidence
                const getHeuristicConfidence = (fieldKey: string, queryIndices: number[]): number => {
                    if (queryIndices.length === 0) {
                        // Fallback to old method if no sources provided
                        let relevantResult = '';
                        if (fieldKey === 'portAuthority') {
                            relevantResult = researchQueries.find(q => q.query.includes('port authority') || q.query.includes('governance'))?.result || '';
                        } else if (fieldKey === 'identityCompetitors' || fieldKey === 'identityAdoptionRate') {
                            relevantResult = researchQueries.find(q => q.query.includes('identity'))?.result || '';
                        } else if (fieldKey.includes('ISPS') || fieldKey.includes('isps')) {
                            relevantResult = researchQueries.find(q => q.query.includes('ISPS') || q.query.includes('security'))?.result || '';
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
                console.log(`[Deep Research] ${port.name} - Validating extracted data... [94.5%]`);
                sendEvent('status', { message: 'Validating extracted data...', step: 'validate', progress: 94.5 });
                
                const validationResults: Record<string, any> = {};
                const validationErrors: Record<string, string[]> = {};
                const validationWarnings: Record<string, string[]> = {};
                
                // Validate each extracted field
                if (normalizedExtractedData.port_authority !== null && normalizedExtractedData.port_authority !== undefined) {
                    const result = validatePortAuthority(normalizedExtractedData.port_authority);
                    validationResults.portAuthority = result;
                    if (result.errors.length > 0) validationErrors.portAuthority = result.errors;
                    if (result.warnings.length > 0) validationWarnings.portAuthority = result.warnings;
                    if (result.correctedValue) normalizedExtractedData.port_authority = result.correctedValue;
                    // Adjust confidence based on validation
                    if (!result.isValid) {
                        fieldConfidences.portAuthority = Math.max(0, (fieldConfidences.portAuthority || 0.5) - 0.2);
                    } else if (result.warnings.length > 0) {
                        fieldConfidences.portAuthority = Math.max(0, (fieldConfidences.portAuthority || 0.5) - 0.1);
                    }
                }
                
                if (normalizedExtractedData.port_level_isps_risk !== null && normalizedExtractedData.port_level_isps_risk !== undefined) {
                    const result = validateISPSLevel(normalizedExtractedData.port_level_isps_risk);
                    validationResults.portLevelISPSRisk = result;
                    if (result.errors.length > 0) validationErrors.portLevelISPSRisk = result.errors;
                    if (result.warnings.length > 0) validationWarnings.portLevelISPSRisk = result.warnings;
                    if (result.correctedValue) normalizedExtractedData.port_level_isps_risk = result.correctedValue;
                    if (!result.isValid) {
                        fieldConfidences.portLevelISPSRisk = Math.max(0, (fieldConfidences.portLevelISPSRisk || 0.5) - 0.2);
                    }
                }
                
                if (normalizedExtractedData.isps_enforcement_strength !== null && normalizedExtractedData.isps_enforcement_strength !== undefined) {
                    const result = validateEnforcementStrength(normalizedExtractedData.isps_enforcement_strength);
                    validationResults.ispsEnforcementStrength = result;
                    if (result.errors.length > 0) validationErrors.ispsEnforcementStrength = result.errors;
                    if (result.warnings.length > 0) validationWarnings.ispsEnforcementStrength = result.warnings;
                    if (result.correctedValue) normalizedExtractedData.isps_enforcement_strength = result.correctedValue;
                    if (!result.isValid) {
                        fieldConfidences.ispsEnforcementStrength = Math.max(0, (fieldConfidences.ispsEnforcementStrength || 0.5) - 0.2);
                    }
                }
                
                if (normalizedExtractedData.identity_competitors !== null && normalizedExtractedData.identity_competitors !== undefined) {
                    const result = validateIdentityCompetitors(normalizedExtractedData.identity_competitors);
                    validationResults.identityCompetitors = result;
                    if (result.errors.length > 0) validationErrors.identityCompetitors = result.errors;
                    if (result.warnings.length > 0) validationWarnings.identityCompetitors = result.warnings;
                    if (result.correctedValue) normalizedExtractedData.identity_competitors = result.correctedValue;
                    if (!result.isValid) {
                        fieldConfidences.identityCompetitors = Math.max(0, (fieldConfidences.identityCompetitors || 0.5) - 0.2);
                    }
                }
                
                if (normalizedExtractedData.identity_adoption_rate !== null && normalizedExtractedData.identity_adoption_rate !== undefined) {
                    const result = validateIdentityAdoptionRate(normalizedExtractedData.identity_adoption_rate);
                    validationResults.identityAdoptionRate = result;
                    if (result.errors.length > 0) validationErrors.identityAdoptionRate = result.errors;
                    if (result.warnings.length > 0) validationWarnings.identityAdoptionRate = result.warnings;
                    if (result.correctedValue) normalizedExtractedData.identity_adoption_rate = result.correctedValue;
                    if (!result.isValid) {
                        fieldConfidences.identityAdoptionRate = Math.max(0, (fieldConfidences.identityAdoptionRate || 0.5) - 0.2);
                    }
                }

                // --- STEP 5: CONFLICT DETECTION ---
                console.log(`[Deep Research] ${port.name} - Detecting conflicts... [94.7%]`);
                sendEvent('status', { message: 'Detecting conflicts...', step: 'conflict_detection', progress: 94.7 });
                
                // Detect conflicts between research queries
                const conflictDetectionPrompt = `
Analyze the research queries below and identify any conflicts or discrepancies in the extracted data.

RESEARCH QUERIES:
${researchQueries.map((q, idx) => `
Query ${idx} (${queryTypeToTitle[researchQueries[idx]?.queryType]?.replace('## ', '') || `Report ${idx + 1}`}):
${q.query}

Result:
${q.result.substring(0, 1000)}${q.result.length > 1000 ? '...' : ''}
`).join('\n---\n')}

EXTRACTED DATA:
- Port Authority: ${normalizedExtractedData.port_authority || 'null'}
- Identity Competitors: ${JSON.stringify(normalizedExtractedData.identity_competitors) || 'null'}
- Identity Adoption Rate: ${normalizedExtractedData.identity_adoption_rate || 'null'}
- ISPS Risk: ${normalizedExtractedData.port_level_isps_risk || 'null'}
- ISPS Enforcement: ${normalizedExtractedData.isps_enforcement_strength || 'null'}

Identify:
1. Fields where different queries provide conflicting values
2. Fields where values are inconsistent across queries
3. Confidence in each conflicting value
4. Suggested resolution (if possible)

Return JSON:
{
  "conflicts": [
    {
      "field": "port_authority | identity_competitors | identity_adoption_rate | port_level_isps_risk | isps_enforcement_strength",
      "conflictingValues": [
        {
          "value": "string",
          "sourceQueryIndex": 0,
          "sourceQueryTitle": "Governance Report",
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
                    const conflictStart = Date.now();
                    const conflictRes = await openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [{ role: 'user', content: conflictDetectionPrompt }],
                        response_format: { type: 'json_object' },
                        temperature: 0.2,
                    });
                    const conflictDuration = ((Date.now() - conflictStart) / 1000).toFixed(1);
                    conflictData = JSON.parse(conflictRes.choices[0].message.content || '{"conflicts": []}');
                    const conflictCount = conflictData.conflicts?.length || 0;
                    console.log(`[Deep Research] ${port.name} - Conflict detection completed (${conflictDuration}s, ${conflictCount} conflict(s) found)`);
                } catch (e) {
                    console.error(`[Deep Research] ${port.name} - Conflict detection failed:`, e);
                    // Continue without conflict data
                }

                // --- STEP 6: LLM FIELD-BY-FIELD ANALYSIS ---
                console.log(`[Deep Research] ${port.name} - Analyzing field updates... [95%]`);
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
                    { key: 'portAuthority', label: 'Port Authority', extracted: normalizedExtractedData.port_authority, current: port.portAuthority },
                    { key: 'identityCompetitors', label: 'Identity Competitors', extracted: normalizedExtractedData.identity_competitors, current: port.identityCompetitors ? JSON.parse(port.identityCompetitors) : null },
                    { key: 'identityAdoptionRate', label: 'Identity Adoption Rate', extracted: normalizedExtractedData.identity_adoption_rate, current: port.identityAdoptionRate },
                    { key: 'portLevelISPSRisk', label: 'Port-Level ISPS Risk', extracted: normalizedExtractedData.port_level_isps_risk, current: port.portLevelISPSRisk },
                    { key: 'ispsEnforcementStrength', label: 'ISPS Enforcement Strength', extracted: normalizedExtractedData.isps_enforcement_strength, current: port.ispsEnforcementStrength },
                ];

                // Add location proposal if geocoded
                if (portLocation) {
                    const coordValidation = validateCoordinates(portLocation.latitude, portLocation.longitude);
                    fieldProposals.push({
                        field: 'location',
                        currentValue: port.latitude && port.longitude ? { latitude: port.latitude, longitude: port.longitude } : null,
                        proposedValue: coordValidation.correctedValue || portLocation,
                        confidence: coordValidation.isValid ? 0.9 : 0.5, // High confidence for geocoding if valid
                        shouldUpdate: !port.latitude || !port.longitude, // Only update if missing
                        reasoning: 'Location geocoded from port name and country using OpenStreetMap',
                        sources: [],
                        updatePriority: 'medium',
                        validationErrors: coordValidation.errors.length > 0 ? coordValidation.errors : undefined,
                        validationWarnings: coordValidation.warnings.length > 0 ? coordValidation.warnings : undefined,
                        hasConflict: false
                    });
                }

                const fieldsWithData = fieldsToAnalyze.filter(f => f.extracted);
                
                if (fieldsWithData.length > 0) {
                    const getRelevantResearch = (fieldKey: string): string => {
                        if (fieldKey === 'portAuthority') {
                            return researchQueries.find(q => q.query.includes('governance') || q.query.includes('authority'))?.result || '';
                        } else if (fieldKey.includes('identity')) {
                            return researchQueries.find(q => q.query.includes('identity'))?.result || '';
                        } else if (fieldKey.includes('ISPS') || fieldKey.includes('isps')) {
                            return researchQueries.find(q => q.query.includes('ISPS') || q.query.includes('security'))?.result || '';
                        }
                        return '';
                    };
                    
                    const batchAnalysisPrompt = `
You are evaluating whether to update multiple port database fields. Analyze each field independently.

PORT: ${port.name}
COUNTRY: ${port.country}
CLUSTER: ${port.cluster.name}

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
3. What is the update priority? (high/medium/low - high for governance and identity systems)

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
                        const analysisStart = Date.now();
                        console.log(`[Deep Research] ${port.name} - Calling OpenAI for field analysis...`);
                        const batchAnalysisRes = await openai.chat.completions.create({
                            model: 'gpt-4o',
                            messages: [{ role: 'user', content: batchAnalysisPrompt }],
                            response_format: { type: 'json_object' },
                            temperature: 0.2,
                        });
                        const analysisDuration = ((Date.now() - analysisStart) / 1000).toFixed(1);
                        console.log(`[Deep Research] ${port.name} - Field analysis completed (${analysisDuration}s)`);

                        const batchAnalysis = JSON.parse(batchAnalysisRes.choices[0].message.content || '{}');
                        const analyses = Array.isArray(batchAnalysis.analyses) ? batchAnalysis.analyses : [];

                        for (const fieldInfo of fieldsWithData) {
                            const analysis = analyses.find((a: any) => {
                                if (!a.field) return false;
                                const aField = String(a.field).toLowerCase().trim();
                                const keyLower = fieldInfo.key.toLowerCase();
                                const labelLower = fieldInfo.label.toLowerCase();
                                
                                if (aField === keyLower || aField === labelLower) return true;
                                if (aField.includes(keyLower) || keyLower.includes(aField)) return true;
                                if (aField.includes(labelLower) || labelLower.includes(aField)) return true;
                                
                                return false;
                            }) || {};
                            
                            const shouldUpdate = analysis.shouldUpdate !== undefined ? analysis.shouldUpdate : true;
                            
                            // Get conflict information for this field
                            const fieldKeyMap: Record<string, string> = {
                                'portAuthority': 'port_authority',
                                'identityCompetitors': 'identity_competitors',
                                'identityAdoptionRate': 'identity_adoption_rate',
                                'portLevelISPSRisk': 'port_level_isps_risk',
                                'ispsEnforcementStrength': 'isps_enforcement_strength'
                            };
                            const conflictKey = fieldKeyMap[fieldInfo.key];
                            const fieldConflicts = conflictData.conflicts?.find((c: any) => c.field === conflictKey);
                            
                            // Get source query names for this field
                            const sourceQueryIndices = fieldSources[fieldInfo.key] || [];
                            const sourceQueryNames = sourceQueryIndices.map(idx => {
                                const query = researchQueries[idx];
                                return query ? queryTypeToTitle[query.queryType]?.replace('## ', '') || `Query ${idx}` : `Query ${idx}`;
                            });
                            
                            fieldProposals.push({
                                field: fieldInfo.key,
                                currentValue: fieldInfo.current,
                                proposedValue: fieldInfo.extracted,
                                confidence: fieldConfidences[fieldInfo.key] || 0.5,
                                shouldUpdate,
                                reasoning: analysis.reasoning || 'No specific reasoning provided',
                                sources: sourceQueryNames.length > 0 ? sourceQueryNames : allSources,
                                updatePriority: analysis.updatePriority || (['portAuthority'].includes(fieldInfo.key) ? 'high' : 'medium'),
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
                        // Fallback: use simple comparison
                        for (const fieldInfo of fieldsWithData) {
                            const shouldUpdate = fieldInfo.current !== fieldInfo.extracted && 
                                               (fieldConfidences[fieldInfo.key] || 0.5) >= 0.5;
                            
                            // Get conflict information for this field
                            const fieldKeyMap: Record<string, string> = {
                                'portAuthority': 'port_authority',
                                'identityCompetitors': 'identity_competitors',
                                'identityAdoptionRate': 'identity_adoption_rate',
                                'portLevelISPSRisk': 'port_level_isps_risk',
                                'ispsEnforcementStrength': 'isps_enforcement_strength'
                            };
                            const conflictKey = fieldKeyMap[fieldInfo.key];
                            const fieldConflicts = conflictData.conflicts?.find((c: any) => c.field === conflictKey);
                            
                            // Get source query names for this field
                            const sourceQueryIndices = fieldSources[fieldInfo.key] || [];
                            const sourceQueryNames = sourceQueryIndices.map(idx => {
                                const query = researchQueries[idx];
                                return query ? queryTypeToTitle[query.queryType]?.replace('## ', '') || `Query ${idx}` : `Query ${idx}`;
                            });
                            
                            fieldProposals.push({
                                field: fieldInfo.key,
                                currentValue: fieldInfo.current,
                                proposedValue: fieldInfo.extracted,
                                confidence: fieldConfidences[fieldInfo.key] || 0.5,
                                shouldUpdate,
                                reasoning: shouldUpdate ? 'Proposed value differs from current and has sufficient confidence' : 'Insufficient confidence or no change needed',
                                sources: sourceQueryNames.length > 0 ? sourceQueryNames : allSources,
                                updatePriority: ['portAuthority'].includes(fieldInfo.key) ? 'high' : 'medium',
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

                // Generate research summary
                console.log(`[Deep Research] ${port.name} - Generating research summary... [96%]`);
                const summaryResearchText = researchText.length > 4000 ? researchText.substring(0, 4000) + '\n[... truncated ...]' : researchText;
                const summaryPrompt = `Summarize the key findings from this port research in 2-3 sentences:\n\n${summaryResearchText}`;
                let researchSummary = '';
                try {
                    const summaryStart = Date.now();
                    const summaryRes = await openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [{ role: 'user', content: summaryPrompt }],
                        temperature: 0.3,
                    });
                    const summaryDuration = ((Date.now() - summaryStart) / 1000).toFixed(1);
                    researchSummary = summaryRes.choices[0].message.content || researchText.substring(0, 200);
                    console.log(`[Deep Research] ${port.name} - Research summary generated (${summaryDuration}s)`);
                } catch (e) {
                    console.warn(`[Deep Research] ${port.name} - Summary generation failed: ${e instanceof Error ? e.message : String(e)}`);
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

                // --- STEP 6: GENERATE STRATEGIC NOTES ---
                console.log(`[Deep Research] ${port.name} - Generating strategic notes... [98%]`);
                sendEvent('status', { message: 'Generating strategic notes...', step: 'notes', progress: 98 });
                
                const notesResearchText = researchText.length > 6000 ? researchText.substring(0, 6000) + '\n\n[... truncated for token limits ...]' : researchText;
                
                const notesPrompt = `
Based on the research findings below, generate strategic intelligence notes for this port.
Include:
- Strategic insights not captured in structured fields
- Network effects and cluster dynamics
- Governance and decision-making context
- Expansion opportunities
- Data quality observations
- Any other relevant GTM intelligence

RESEARCH FINDINGS:
${notesResearchText}

CURRENT STRATEGIC NOTES:
${port.strategicNotes || '(none)'}

Format: Append new findings to existing notes with a separator.
Return JSON:
{
  "newFindings": "string - new intelligence findings",
  "combinedNotes": "string - existing notes + new findings with separator"
}
`;

                let notesProposal = {
                    currentNotes: port.strategicNotes || '',
                    newFindings: '',
                    combinedNotes: port.strategicNotes || ''
                };

                try {
                    const notesStart = Date.now();
                    const notesRes = await openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [{ role: 'user', content: notesPrompt }],
                        response_format: { type: 'json_object' },
                        temperature: 0.4,
                    });
                    const notesDuration = ((Date.now() - notesStart) / 1000).toFixed(1);
                    const notesData = JSON.parse(notesRes.choices[0].message.content || '{}');
                    notesProposal = {
                        currentNotes: port.strategicNotes || '',
                        newFindings: notesData.newFindings || '',
                        combinedNotes: notesData.combinedNotes || port.strategicNotes || ''
                    };
                    console.log(`[Deep Research] ${port.name} - Strategic notes generated (${notesDuration}s)`);
                } catch (e) {
                    console.warn(`[Deep Research] ${port.name} - Strategic notes generation failed: ${e instanceof Error ? e.message : String(e)}`);
                    const dateStr = new Date().toISOString().split('T')[0];
                    notesProposal = {
                        currentNotes: port.strategicNotes || '',
                        newFindings: `--- Deep Research ${dateStr} ---\nKey findings from research: ${researchSummary}`,
                        combinedNotes: port.strategicNotes 
                            ? `${port.strategicNotes}\n\n--- Deep Research ${dateStr} ---\n${researchSummary}`
                            : `--- Deep Research ${dateStr} ---\n${researchSummary}`
                    };
                }

                // --- STEP 7: BUILD UPDATE DATA FROM PROPOSALS ---
                console.log(`[Deep Research] ${port.name} - Preparing changes for review... [99%]`);
                sendEvent('status', { message: 'Preparing changes for review...', step: 'prepare', progress: 99 });

                interface PortUpdateData {
                    lastDeepResearchAt: Date;
                    lastDeepResearchSummary: string;
                    portAuthority?: string;
                    identityCompetitors?: string;
                    identityAdoptionRate?: string;
                    portLevelISPSRisk?: string;
                    ispsEnforcementStrength?: string;
                    strategicNotes?: string;
                    latitude?: number;
                    longitude?: number;
                }

                const dataToUpdate: PortUpdateData = {
                    lastDeepResearchAt: new Date(),
                    lastDeepResearchSummary: researchSummary,
                };

                const formattedFieldProposals = fieldProposals.map(proposal => {
                    let formattedProposal = { ...proposal };
                    
                    // Format array fields
                    if (proposal.field === 'identityCompetitors' && Array.isArray(proposal.proposedValue)) {
                        dataToUpdate.identityCompetitors = JSON.stringify(proposal.proposedValue);
                    }
                    // Format other fields
                    else if (proposal.proposedValue !== null && proposal.proposedValue !== undefined && proposal.proposedValue !== '') {
                        if (proposal.field === 'portAuthority') {
                            dataToUpdate.portAuthority = proposal.proposedValue;
                        } else if (proposal.field === 'identityAdoptionRate') {
                            dataToUpdate.identityAdoptionRate = proposal.proposedValue;
                        } else if (proposal.field === 'portLevelISPSRisk') {
                            dataToUpdate.portLevelISPSRisk = proposal.proposedValue;
                        } else if (proposal.field === 'ispsEnforcementStrength') {
                            dataToUpdate.ispsEnforcementStrength = proposal.proposedValue;
                        }
                    }

                    // Add location to dataToUpdate if geocoded
                    if (proposal.field === 'location' && proposal.proposedValue) {
                        dataToUpdate.latitude = proposal.proposedValue.latitude;
                        dataToUpdate.longitude = proposal.proposedValue.longitude;
                    }

                    formattedProposal = {
                        ...formattedProposal,
                        autoApproved: proposal.confidence > 0.80
                    };

                    return formattedProposal;
                });

                // Add strategic notes proposal
                formattedFieldProposals.push({
                    field: 'strategicNotes',
                    currentValue: notesProposal.currentNotes,
                    proposedValue: notesProposal.combinedNotes,
                    confidence: 0.7,
                    shouldUpdate: true,
                    reasoning: 'Strategic intelligence notes generated from research findings',
                    sources: allSources,
                    updatePriority: 'low',
                    autoApproved: false
                });

                // --- STEP 7: SEND PREVIEW EVENT ---
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:647',message:'Before preview event',data:{portId,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                // #endregion
                const totalDuration = ((Date.now() - streamStartTime) / 1000).toFixed(1);
                const proposalCount = formattedFieldProposals.filter(p => p.shouldUpdate).length;
                console.log(`[Deep Research] ${port.name} - Research complete! Total time: ${totalDuration}s [100%]`);
                console.log(`[Deep Research] ${port.name} - Generated ${proposalCount} field proposal(s) for review`);
                sendEvent('status', { message: 'Research complete - Review changes', step: 'complete', progress: 100 });

                sendEvent('preview', {
                    field_proposals: formattedFieldProposals,
                    notes_proposal: notesProposal,
                    research_queries: researchQueries,
                    full_report: researchText,
                    concise_summary: researchSummary,
                    data_to_update: dataToUpdate
                });

                // Save full research report to database (overwrites previous report)
                // This MUST succeed for persistence to work
                try {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:661',message:'Before DB save',data:{portId,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                    // #endregion
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
                    await prisma.port.update({
                        where: { id: portId },
                        data: { 
                            lastDeepResearchReport: reportToSave,
                            lastDeepResearchAt: new Date() // Also update timestamp
                        }
                    });
                    console.log(`[Deep Research] ${port.name} - Research report saved to database`);
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:681',message:'After DB save',data:{portId,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                    // #endregion
                } catch (dbError) {
                    // This is a critical error - log it but don't fail the request
                    const errorMsg = dbError instanceof Error ? dbError.message : String(dbError);
                    const errorStack = dbError instanceof Error ? dbError.stack?.substring(0, 1000) : undefined;
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:686',message:'DB save failed',data:{portId,error:errorMsg,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                    // #endregion
                    console.error('CRITICAL: Failed to save full research report to database:', dbError);
                    // Send error event to frontend so user knows
                    sendEvent('error', {
                        category: 'DATABASE_ERROR',
                        message: 'Research completed but failed to save report. Report will not persist after refresh.',
                        originalError: errorMsg,
                        retryable: false
                    });
                }

                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:696',message:'Before controller.close()',data:{portId,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                // #endregion
                console.log(`[Deep Research] ${port.name} - Stream closed, research complete`);
                controller.close();
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deep-research/route.ts:698',message:'After controller.close()',data:{portId,elapsed:Date.now()-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                // #endregion
            } catch (error: unknown) {
                const portName = port?.name || 'Unknown';
                if (error && typeof error === 'object' && 'category' in error) {
                    const err = error as { category: string; message: string; originalError?: string; retryable: boolean };
                    console.error(`[Deep Research] ${portName} - Error (${err.category}): ${err.message}`);
                    sendEvent('error', {
                        category: err.category,
                        message: err.message,
                        originalError: err.originalError,
                        retryable: err.retryable
                    });
                } else if (error instanceof Error) {
                    if (error.message === 'Request aborted' || error.name === 'AbortError') {
                        console.log(`[Deep Research] ${portName} - Research was cancelled`);
                        sendEvent('error', {
                            category: 'NETWORK_ERROR',
                            message: 'Research was cancelled.',
                            retryable: false
                        });
                    } else {
                        console.error(`[Deep Research] ${portName} - Unexpected error: ${error.message}`);
                        sendEvent('error', {
                            category: 'UNKNOWN_ERROR',
                            message: 'An unexpected error occurred. Please try again.',
                            originalError: error.message,
                            retryable: true
                        });
                    }
                } else {
                    console.error(`[Deep Research] ${portName} - Unknown error: ${String(error)}`);
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
