import OpenAI from 'openai';
import { appendFileSync } from 'fs';
import { join } from 'path';

// Helper function to write debug logs to file
function writeDebugLog(message: string, data?: any) {
    const logPath = join(process.cwd(), '.cursor', 'debug-runtime.log');
    const logEntry = `[${new Date().toISOString()}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
    try {
        appendFileSync(logPath, logEntry, 'utf8');
    } catch (err) {
        // Ignore file write errors
    }
    console.error(message, data || '');
    console.log(message, data || '');
}

export type ResearchProvider = 'perplexity' | 'openai';

export interface ResearchQueryResult {
    content: string;
    sources: string[];
}

/**
 * Get the configured research provider from environment variable
 */
export function getResearchProvider(): ResearchProvider {
    const provider = (process.env.RESEARCH_PROVIDER || 'perplexity').toLowerCase().trim();
    if (provider !== 'perplexity' && provider !== 'openai') {
        throw new Error(`Invalid RESEARCH_PROVIDER: ${provider}. Must be 'perplexity' or 'openai'`);
    }
    return provider as ResearchProvider;
}

/**
 * Validate API keys based on provider
 */
function validateApiKeys(provider: ResearchProvider): void {
    if (provider === 'perplexity') {
        if (!process.env.PPLX_API_KEY) {
            throw new Error('PPLX_API_KEY is required when RESEARCH_PROVIDER=perplexity');
        }
    } else if (provider === 'openai') {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is required when RESEARCH_PROVIDER=openai');
        }
    }
}

/**
 * Execute a research query using Perplexity
 * @param model - Optional Perplexity model override ('sonar', 'sonar-pro', 'sonar-deep-research')
 *                Defaults to 'sonar-deep-research' for backward compatibility
 */
async function executePerplexityQuery(
    query: string,
    systemPrompt: string,
    abortSignal?: AbortSignal,
    model?: 'sonar' | 'sonar-pro' | 'sonar-deep-research'
): Promise<ResearchQueryResult> {
    console.log(`[DEBUG] executePerplexityQuery entry - model: ${model}, aborted: ${abortSignal?.aborted}, hasApiKey: ${!!process.env.PPLX_API_KEY}`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-provider.ts:41',message:'executePerplexityQuery entry',data:{model,aborted:abortSignal?.aborted,hasApiKey:!!process.env.PPLX_API_KEY},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    if (abortSignal?.aborted) {
        console.error(`[DEBUG] Request already aborted!`);
        throw new Error('Request aborted');
    }

    // Default to sonar-deep-research for backward compatibility
    const selectedModel = model || 'sonar-deep-research';
    
    // Validate model name
    const validModels = ['sonar', 'sonar-pro', 'sonar-deep-research'];
    if (!validModels.includes(selectedModel)) {
        throw new Error(`Invalid Perplexity model: ${selectedModel}. Must be one of: ${validModels.join(', ')}`);
    }

    const apiKey = (process.env.PPLX_API_KEY || '').trim();
    
    // Try the requested model first, with fallback to sonar-deep-research
    const modelsToTry = [selectedModel, 'sonar-deep-research'];
    let lastError: any = null;

    for (const modelToTry of modelsToTry) {
        writeDebugLog(`[DEBUG] Trying Perplexity model: ${modelToTry}, aborted: ${abortSignal?.aborted}`);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-provider.ts:66',message:'Trying Perplexity model',data:{modelToTry,aborted:abortSignal?.aborted},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        try {
            // #region agent log
            const fetchStart = Date.now();
            console.log(`[DEBUG] Before Perplexity fetch - model: ${modelToTry}, aborted: ${abortSignal?.aborted}`);
            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-provider.ts:70',message:'Before Perplexity fetch',data:{modelToTry,aborted:abortSignal?.aborted},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            let pplxRes: Response;
            // Create a timeout wrapper - if abort signal doesn't work, this will ensure fetch doesn't hang indefinitely
            // sonar-deep-research requires at least 5 minutes, so use 6 minutes to be safe
            // Check both the current model being tried and the selected model (in case of fallback)
            const isDeepResearchModel = modelToTry === 'sonar-deep-research' || selectedModel === 'sonar-deep-research';
            const FETCH_TIMEOUT_MS = isDeepResearchModel 
                ? 6 * 60 * 1000  // 6 minutes for deep research model
                : 4 * 60 * 1000; // 4 minutes for standard models
            const fetchTimeoutController = new AbortController();
            let fetchTimeoutId: NodeJS.Timeout | null = null;
            let combinedAbortController: AbortController | null = null;
            let abortHandler: (() => void) | null = null;
            
            try {
                writeDebugLog(`[DEBUG] Making Perplexity API call to https://api.perplexity.ai/chat/completions`);
                writeDebugLog(`[DEBUG] Model: ${modelToTry}, Has abort signal: ${!!abortSignal}, Aborted: ${abortSignal?.aborted}`);
                
                fetchTimeoutId = setTimeout(() => {
                    writeDebugLog(`[DEBUG] ========== FETCH TIMEOUT WRAPPER TRIGGERED after ${FETCH_TIMEOUT_MS}ms ==========`);
                    fetchTimeoutController.abort();
                }, FETCH_TIMEOUT_MS);
                
                // Combine abort signals - if either triggers, abort the fetch
                combinedAbortController = new AbortController();
                abortHandler = () => {
                    if (fetchTimeoutId) clearTimeout(fetchTimeoutId);
                    combinedAbortController?.abort();
                };
                if (abortSignal) {
                    abortSignal.addEventListener('abort', abortHandler);
                }
                fetchTimeoutController.signal.addEventListener('abort', abortHandler);
                
                // Use Promise.race to ensure fetch doesn't hang indefinitely
                const fetchPromise = fetch('https://api.perplexity.ai/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: modelToTry,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: query },
                        ],
                        temperature: 0.1,
                    }),
                    signal: combinedAbortController.signal,
                });
                
                // Race against a timeout promise - this ensures fetch doesn't hang indefinitely
                let timeoutId: NodeJS.Timeout | null = null;
                const timeoutPromise = new Promise<never>((_, reject) => {
                    timeoutId = setTimeout(() => {
                        writeDebugLog(`[DEBUG] ========== FETCH PROMISE RACE TIMEOUT after ${FETCH_TIMEOUT_MS}ms ==========`);
                        writeDebugLog(`[DEBUG] Model: ${modelToTry}, Timeout triggered - aborting fetch`);
                        combinedAbortController?.abort(); // Also abort the controller
                        reject(new Error(`Fetch timeout after ${FETCH_TIMEOUT_MS}ms`));
                    }, FETCH_TIMEOUT_MS);
                });
                
                try {
                    pplxRes = await Promise.race([fetchPromise, timeoutPromise]);
                    // Clear timeout if fetch completes successfully
                    if (timeoutId) clearTimeout(timeoutId);
                } catch (raceError: any) {
                    // Clear timeout on error
                    if (timeoutId) clearTimeout(timeoutId);
                    throw raceError;
                }
                
                // Cleanup
                if (fetchTimeoutId) clearTimeout(fetchTimeoutId);
                if (abortSignal && abortHandler) {
                    abortSignal.removeEventListener('abort', abortHandler);
                }
                
                const fetchDuration = Date.now() - fetchStart;
                writeDebugLog(`[DEBUG] ========== PERPLEXITY API RESPONSE RECEIVED ==========`);
                writeDebugLog(`[DEBUG] Status: ${pplxRes.status}, StatusText: ${pplxRes.statusText}, Duration: ${fetchDuration}ms`);
            } catch (fetchError: any) {
                // Cleanup on error
                if (fetchTimeoutId) clearTimeout(fetchTimeoutId);
                if (abortSignal && abortHandler) {
                    abortSignal.removeEventListener('abort', abortHandler);
                }
                
                const fetchDuration = Date.now() - fetchStart;
                writeDebugLog(`[DEBUG] ========== PERPLEXITY FETCH ERROR ==========`);
                writeDebugLog(`[DEBUG] Error name: ${fetchError?.name}, Message: ${fetchError?.message}`);
                writeDebugLog(`[DEBUG] Duration before error: ${fetchDuration}ms`);
                writeDebugLog(`[DEBUG] Abort signal aborted: ${abortSignal?.aborted}`);
                writeDebugLog(`[DEBUG] Combined abort signal aborted: ${combinedAbortController?.signal?.aborted || false}`);
                
                // If this is an abort error, throw immediately
                if (fetchError?.name === 'AbortError' || abortSignal?.aborted || combinedAbortController?.signal?.aborted) {
                    writeDebugLog(`[DEBUG] Fetch was aborted - throwing abort error`);
                    throw new Error('Request aborted');
                }
                
                // Re-throw other fetch errors
                throw {
                    category: 'NETWORK_ERROR',
                    message: 'Failed to connect to Perplexity API. Please check your network connection.',
                    originalError: fetchError?.message || String(fetchError),
                    retryable: true
                };
            }
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-provider.ts:88',message:'After Perplexity fetch',data:{modelToTry,status:pplxRes.status,statusText:pplxRes.statusText,fetchDuration:Date.now()-fetchStart},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion

            if (!pplxRes.ok) {
                const errorBody = await pplxRes.text().catch(() => '');
                const errorCategory = pplxRes.status >= 500 ? 'API_ERROR' : pplxRes.status === 401 ? 'AUTH_ERROR' : 'NETWORK_ERROR';
                let errorMessage = `Research service temporarily unavailable. Please try again in a moment.`;
                if (pplxRes.status === 401) {
                    errorMessage = `Perplexity API authentication failed. Please verify your PPLX_API_KEY is valid and has access to the '${modelToTry}' model. Status: ${pplxRes.statusText}`;
                }
                
                // If model not found (404) or unavailable (400), try next model
                if (pplxRes.status === 404 || pplxRes.status === 400) {
                    console.log(`[Research Provider] Model ${modelToTry} not available, trying next model...`);
                    lastError = { 
                        category: errorCategory,
                        message: errorMessage,
                        originalError: `Perplexity API error: ${pplxRes.statusText}`,
                        status: pplxRes.status,
                        errorBody: errorBody.substring(0, 200),
                        retryable: false // Model not found is not retryable
                    };
                    continue;
                }
                
                throw { 
                    category: errorCategory,
                    message: errorMessage,
                    originalError: `Perplexity API error: ${pplxRes.statusText}`,
                    status: pplxRes.status,
                    errorBody: errorBody.substring(0, 200),
                    retryable: pplxRes.status !== 401
                };
            }

            if (abortSignal?.aborted) {
                console.error(`[DEBUG] Abort signal was triggered after fetch completed`);
                throw new Error('Request aborted');
            }

            console.log(`[DEBUG] Parsing Perplexity JSON response...`);
            let pplxJson: any;
            try {
                pplxJson = await pplxRes.json();
                console.log(`[DEBUG] JSON parsed successfully, choices count: ${pplxJson.choices?.length || 0}`);
            } catch (jsonError: any) {
                console.error(`[DEBUG] ========== JSON PARSE ERROR ==========`);
                console.error(`[DEBUG] Error: ${jsonError?.message}`);
                const textResponse = await pplxRes.text().catch(() => 'Unable to read response');
                console.error(`[DEBUG] Response text (first 500 chars): ${textResponse.substring(0, 500)}`);
                throw {
                    category: 'API_ERROR',
                    message: 'Invalid response format from Perplexity API',
                    originalError: jsonError?.message || 'Failed to parse JSON',
                    retryable: false
                };
            }
            
            const content = pplxJson.choices[0]?.message?.content || '';
            writeDebugLog(`[DEBUG] Extracted content length: ${content.length} characters`);
            
            // Extract sources from citations
            const sources: string[] = [];
            const citationRegex = /\[(\d+)\]/g;
            const matches = content.match(citationRegex);
            if (matches) {
                sources.push(...matches.map((_match: string, i: number) => `Source ${i + 1}`));
            }

            // Log which model was used (for debugging)
            if (modelToTry !== selectedModel) {
                console.log(`[Research Provider] Using ${modelToTry} model (${selectedModel} unavailable)`);
            } else {
                console.log(`[Research Provider] Using ${modelToTry} model`);
            }

            return { content, sources };
        } catch (error: any) {
            console.error(`[DEBUG] ========== PERPLEXITY QUERY ERROR (model: ${modelToTry}) ==========`);
            console.error(`[DEBUG] Error type: ${error?.name || typeof error}`);
            console.error(`[DEBUG] Error message: ${error?.message || String(error)}`);
            console.error(`[DEBUG] Error category: ${error?.category || 'N/A'}`);
            console.error(`[DEBUG] Abort signal aborted: ${abortSignal?.aborted}`);
            
            // If this is an abort error, throw immediately
            if (error?.name === 'AbortError' || abortSignal?.aborted) {
                console.error(`[DEBUG] Abort detected - throwing immediately`);
                throw new Error('Request aborted');
            }
            
            // If we have an error object with category, it's already formatted
            if (error && typeof error === 'object' && 'category' in error) {
                console.log(`[DEBUG] Error has category, will try next model if available`);
                lastError = error;
                continue;
            }
            
            // For other errors, try next model
            console.log(`[DEBUG] Generic error, will try next model if available`);
            lastError = error;
            continue;
        }
    }

    // If all models failed, throw the last error
    throw lastError || {
        category: 'API_ERROR',
        message: 'Perplexity research models are not available. Please check your API access.',
        originalError: 'All Perplexity models failed',
        retryable: false
    };
}

/**
 * Execute a research query using OpenAI with model fallback
 */
async function executeOpenAIQuery(
    query: string,
    systemPrompt: string,
    abortSignal?: AbortSignal
): Promise<ResearchQueryResult> {
    if (abortSignal?.aborted) {
        throw new Error('Request aborted');
    }

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    // Try o3-deep-research first, fallback to gpt-4o
    const models = ['o3-deep-research', 'gpt-4o'];
    let lastError: any = null;

    for (const model of models) {
        try {
            console.log(`[DEBUG] Making OpenAI API call - model: ${model}, Has abort signal: ${!!abortSignal}, Aborted: ${abortSignal?.aborted}`);
            const openaiStart = Date.now();
            const completion = await openai.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: query },
                ],
                temperature: 0.1,
            }, {
                signal: abortSignal,
            });
            const openaiDuration = Date.now() - openaiStart;
            console.log(`[DEBUG] ========== OPENAI API RESPONSE RECEIVED ==========`);
            console.log(`[DEBUG] Model: ${model}, Duration: ${openaiDuration}ms, Choices: ${completion.choices?.length || 0}`);

            if (abortSignal?.aborted) {
                console.error(`[DEBUG] Abort signal was triggered after OpenAI call completed`);
                throw new Error('Request aborted');
            }

            const content = completion.choices[0]?.message?.content || '';
            console.log(`[DEBUG] Extracted content length: ${content.length} characters`);
            
            // Extract sources from markdown links or citations
            const sources: string[] = [];
            
            // Extract markdown links [text](url)
            const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
            const linkMatches = Array.from(content.matchAll(linkRegex));
            for (const match of linkMatches) {
                sources.push(match[2]); // URL
            }
            
            // Extract citation markers [1], [2], etc. if no links found
            if (sources.length === 0) {
                const citationRegex = /\[(\d+)\]/g;
                const citationMatches = content.match(citationRegex);
                if (citationMatches) {
                    sources.push(...citationMatches.map((_, i) => `Source ${i + 1}`));
                }
            }

            // Log which model was used (for debugging)
            if (model === 'o3-deep-research') {
                console.log('[Research Provider] Using o3-deep-research model');
            } else {
                console.log('[Research Provider] Using gpt-4o model (o3-deep-research unavailable)');
            }

            return { content, sources };
        } catch (error: any) {
            console.error(`[DEBUG] ========== OPENAI QUERY ERROR (model: ${model}) ==========`);
            console.error(`[DEBUG] Error type: ${error?.name || typeof error}`);
            console.error(`[DEBUG] Error message: ${error?.message || String(error)}`);
            console.error(`[DEBUG] Error status: ${error?.status || 'N/A'}`);
            console.error(`[DEBUG] Error code: ${error?.code || 'N/A'}`);
            console.error(`[DEBUG] Abort signal aborted: ${abortSignal?.aborted}`);
            
            // If model not found (404) or unavailable, try next model
            if (error?.status === 404 || error?.code === 'model_not_found' || error?.message?.includes('model')) {
                console.log(`[DEBUG] Model ${model} not available, trying next model...`);
                lastError = error;
                continue;
            }
            
            // For other errors (abort, network, etc.), throw immediately
            if (error?.name === 'AbortError' || abortSignal?.aborted) {
                console.error(`[DEBUG] Abort detected - throwing immediately`);
                throw new Error('Request aborted');
            }
            
            // Re-throw non-model errors
            console.error(`[DEBUG] Re-throwing error with category`);
            throw {
                category: error?.status >= 500 ? 'API_ERROR' : 'NETWORK_ERROR',
                message: 'OpenAI API error. Please try again in a moment.',
                originalError: error?.message || String(error),
                retryable: error?.status !== 401
            };
        }
    }

    // If all models failed, throw the last error
    throw {
        category: 'API_ERROR',
        message: 'OpenAI research models are not available. Please check your API access.',
        originalError: lastError?.message || 'All OpenAI models failed',
        retryable: false
    };
}

/**
 * Get the optimal model for a given query type
 * Simple factual queries use faster/cheaper models, complex analytical queries use deep research models
 */
function getOptimalModel(queryName: string): 'sonar' | 'sonar-pro' | 'sonar-deep-research' {
    const simpleQueries = ['governance', 'isps_risk', 'identity_location', 'capacity_operations'];
    const complexQueries = ['strategic_intelligence'];
    
    if (simpleQueries.includes(queryName)) {
        return 'sonar-pro'; // Fast and cost-effective for factual queries
    }
    if (complexQueries.includes(queryName)) {
        return 'sonar-deep-research'; // Best for complex analysis
    }
    return 'sonar-pro'; // Default fallback
}

/**
 * Execute a research query using the configured provider
 * 
 * @param query - The research query to execute
 * @param queryName - Name/identifier for the query (for logging/debugging)
 * @param abortSignal - Optional AbortSignal to cancel the request
 * @param systemPrompt - Optional custom system prompt (defaults to maritime research assistant)
 * @param model - Optional model override (for Perplexity: 'sonar', 'sonar-pro', 'sonar-deep-research')
 *                If not provided, will automatically select optimal model based on queryName
 * @returns Promise with content and sources
 */
export async function executeResearchQuery(
    query: string,
    queryName: string,
    abortSignal?: AbortSignal,
    systemPrompt?: string,
    model?: 'sonar' | 'sonar-pro' | 'sonar-deep-research'
): Promise<ResearchQueryResult> {
    console.log(`[DEBUG] executeResearchQuery entry - queryName: ${queryName}, aborted: ${abortSignal?.aborted}, hasAbortSignal: ${!!abortSignal}`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-provider.ts:293',message:'executeResearchQuery entry',data:{queryName,aborted:abortSignal?.aborted,hasAbortSignal:!!abortSignal},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    const provider = getResearchProvider();
    console.log(`[DEBUG] Provider: ${provider}`);
    validateApiKeys(provider);

    // Default system prompt if not provided
    const defaultSystemPrompt = 'You are a maritime research assistant. Provide accurate, cited information.';
    const finalSystemPrompt = systemPrompt || defaultSystemPrompt;

    // Use provided model or select optimal model based on query type
    const selectedModel = model || (provider === 'perplexity' ? getOptimalModel(queryName) : undefined);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-provider.ts:308',message:'Before provider call',data:{queryName,provider,selectedModel,aborted:abortSignal?.aborted},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    writeDebugLog(`[DEBUG] Before provider call - provider: ${provider}, selectedModel: ${selectedModel}, aborted: ${abortSignal?.aborted}`);

    try {
        let result;
        if (provider === 'perplexity') {
            writeDebugLog(`[DEBUG] Calling executePerplexityQuery...`);
            result = await executePerplexityQuery(query, finalSystemPrompt, abortSignal, selectedModel);
        } else {
            writeDebugLog(`[DEBUG] Calling executeOpenAIQuery...`);
            // Model parameter only applies to Perplexity
            result = await executeOpenAIQuery(query, finalSystemPrompt, abortSignal);
        }
        writeDebugLog(`[DEBUG] executeResearchQuery success - result length: ${result.content?.length || 0}`);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-provider.ts:316',message:'executeResearchQuery success',data:{queryName,provider,resultLength:result.content?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        return result;
    } catch (err: any) {
        writeDebugLog(`[DEBUG] executeResearchQuery ERROR: ${err?.message || String(err)}, aborted: ${abortSignal?.aborted}`);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-provider.ts:320',message:'executeResearchQuery error',data:{queryName,provider,error:err?.message||String(err),aborted:abortSignal?.aborted},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        throw err;
    }
}
