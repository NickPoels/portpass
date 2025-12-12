import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import OpenAI from 'openai';

// Force node runtime for network calls and streaming
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    // Validate environment variables early
    if (!process.env.OPENAI_API_KEY) {
        return new Response(JSON.stringify({ 
            error: 'OPENAI_API_KEY not configured',
            category: 'API_ERROR',
            message: 'Research service is not properly configured. Please contact support.',
            retryable: false
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    if (!process.env.PPLX_API_KEY) {
        return new Response(JSON.stringify({ 
            error: 'PPLX_API_KEY not configured',
            category: 'API_ERROR',
            message: 'Research service is not properly configured. Please contact support.',
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
    const stream = new ReadableStream({
        async start(controller) {
            const sendEvent = (event: string, data: unknown) => {
                controller.enqueue(
                    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                );
            };

            // Check for abort signal
            const abortSignal = request.signal;
            
            // Helper function to execute Perplexity query
            const executePerplexityQuery = async (query: string, queryName: string): Promise<{ content: string; sources: string[] }> => {
                if (abortSignal.aborted) {
                    throw new Error('Request aborted');
                }

                const pplxRes = await fetch('https://api.perplexity.ai/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.PPLX_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'sonar-deep-research',
                        messages: [
                            { role: 'system', content: 'You are a maritime and port governance research assistant. Always cite your sources.' },
                            { role: 'user', content: query },
                        ],
                        temperature: 0.1,
                    }),
                    signal: abortSignal,
                });

                if (!pplxRes.ok) {
                    const errorCategory = pplxRes.status >= 500 ? 'API_ERROR' : 'NETWORK_ERROR';
                    throw { 
                        category: errorCategory,
                        message: `Research service temporarily unavailable. Please try again in a moment.`,
                        originalError: `Perplexity API error: ${pplxRes.statusText}`,
                        retryable: true
                    };
                }

                if (abortSignal.aborted) {
                    throw new Error('Request aborted');
                }

                const pplxJson = await pplxRes.json();
                const content = pplxJson.choices[0]?.message?.content || '';
                
                // Extract sources from citations
                const sources: string[] = [];
                const citationRegex = /\[(\d+)\]/g;
                const matches = content.match(citationRegex);
                if (matches) {
                    sources.push(...matches.map((_, i) => `Source ${i + 1}`));
                }

                return { content, sources };
            };

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
                sendEvent('status', { message: 'Initializing port research...', step: 'init', progress: 0 });
                
                if (abortSignal.aborted) {
                    throw new Error('Request aborted');
                }

                // --- STEP 2: MULTI-QUERY RESEARCH ---
                const researchQueries: Array<{ query: string; result: string; sources: string[] }> = [];
                
                // Query 1: Governance
                sendEvent('status', { message: 'Researching governance structure...', step: 'query_1', progress: 15 });
                try {
                    const query1 = `Who is the port authority for ${port.name} in ${port.country}? What customs authority oversees this port? What is the governance structure and decision-making process?`;
                    const result1 = await executePerplexityQuery(query1, 'governance');
                    researchQueries.push({ query: query1, result: result1.content, sources: result1.sources });
                    sendEvent('status', { message: 'Analyzing governance data...', step: 'query_1_analysis', progress: 20 });
                } catch (e) {
                    sendEvent('status', { message: 'Warning: Governance query failed, continuing...', step: 'query_1', progress: 20 });
                }

                // Query 2: Identity Systems
                sendEvent('status', { message: 'Researching identity systems...', step: 'query_2', progress: 35 });
                try {
                    const query2 = `What identity or access control systems are used at ${port.name}? Are there systems like AlfaPass, CargoCard, or local badge systems? What is the adoption rate of port-wide identity systems?`;
                    const result2 = await executePerplexityQuery(query2, 'identity_systems');
                    researchQueries.push({ query: query2, result: result2.content, sources: result2.sources });
                    sendEvent('status', { message: 'Analyzing identity systems...', step: 'query_2_analysis', progress: 40 });
                } catch (e) {
                    sendEvent('status', { message: 'Warning: Identity systems query failed, continuing...', step: 'query_2', progress: 40 });
                }

                // Query 3: ISPS Risk & Enforcement
                sendEvent('status', { message: 'Researching ISPS risk and enforcement...', step: 'query_3', progress: 55 });
                try {
                    const query3 = `What is the ISPS security risk level at ${port.name}? How strong is ISPS enforcement? Have there been security incidents or drug-related crime?`;
                    const result3 = await executePerplexityQuery(query3, 'isps_risk');
                    researchQueries.push({ query: query3, result: result3.content, sources: result3.sources });
                    sendEvent('status', { message: 'Analyzing ISPS data...', step: 'query_3_analysis', progress: 60 });
                } catch (e) {
                    sendEvent('status', { message: 'Warning: ISPS query failed, continuing...', step: 'query_3', progress: 60 });
                }

                // Query 4: System Landscape
                sendEvent('status', { message: 'Researching system landscape...', step: 'query_4', progress: 75 });
                try {
                    const query4 = `What Terminal Operating Systems (TOS) and Access Control Systems (ACS) are commonly used at terminals in ${port.name}? What are the dominant systems?`;
                    const result4 = await executePerplexityQuery(query4, 'system_landscape');
                    researchQueries.push({ query: query4, result: result4.content, sources: result4.sources });
                    sendEvent('status', { message: 'Analyzing system landscape...', step: 'query_4_analysis', progress: 80 });
                } catch (e) {
                    sendEvent('status', { message: 'Warning: System landscape query failed, continuing...', step: 'query_4', progress: 80 });
                }

                // Query 5: Strategic Intelligence
                sendEvent('status', { message: 'Researching strategic intelligence...', step: 'query_5', progress: 85 });
                try {
                    const query5 = `What are the network effects and cluster dynamics for ${port.name}? How does it coordinate with other ports in the ${port.cluster.name} cluster? What are expansion opportunities?`;
                    const result5 = await executePerplexityQuery(query5, 'strategic_intelligence');
                    researchQueries.push({ query: query5, result: result5.content, sources: result5.sources });
                    sendEvent('status', { message: 'Analyzing strategic data...', step: 'query_5_analysis', progress: 90 });
                } catch (e) {
                    sendEvent('status', { message: 'Warning: Strategic intelligence query failed, continuing...', step: 'query_5', progress: 90 });
                }

                // Query 6: Verification
                sendEvent('status', { message: 'Verifying findings...', step: 'query_6', progress: 92 });
                try {
                    const allFindings = researchQueries.map(q => q.result).join('\n\n');
                    const query6 = `Verify the following information about ${port.name}:\n\n${allFindings}\n\nPlease confirm accuracy and identify any discrepancies.`;
                    const result6 = await executePerplexityQuery(query6, 'verification');
                    researchQueries.push({ query: query6, result: result6.content, sources: result6.sources });
                } catch (e) {
                    sendEvent('status', { message: 'Warning: Verification query failed, continuing...', step: 'query_6', progress: 93 });
                }

                // Combine all research results
                const researchText = researchQueries.map(q => q.result).join('\n\n---\n\n');

                // --- STEP 3: EXTRACT STRUCTURED DATA ---
                sendEvent('status', { message: 'Extracting structured data...', step: 'extract', progress: 93 });
                
                const extractResearchText = researchText.length > 8000 ? researchText.substring(0, 8000) + '\n\n[... truncated for token limits ...]' : researchText;
                
                const extractPrompt = `
Extract structured data from the research findings below. Return ONLY the data found, use null if not found.

RESEARCH FINDINGS:
${extractResearchText}

CURRENT PORT DATA:
- Name: ${port.name}
- Country: ${port.country}
- Cluster: ${port.cluster.name}
- Port Authority: ${port.portAuthority || 'unknown'}
- Customs Authority: ${port.customsAuthority || 'unknown'}
- Identity System: ${port.portWideIdentitySystem || 'unknown'}
- ISPS Risk: ${port.portLevelISPSRisk || 'unknown'}
- Enforcement: ${port.ispsEnforcementStrength || 'unknown'}

Return JSON:
{
  "port_authority": "string | null",
  "customs_authority": "string | null",
  "port_wide_identity_system": "string | null",
  "identity_competitors": ["string"] | null,
  "identity_adoption_rate": "string | null",
  "port_level_isps_risk": "Low | Medium | High | Very High | null",
  "isps_enforcement_strength": "Weak | Moderate | Strong | Very Strong | null",
  "dominant_tos_systems": ["string"] | null,
  "dominant_acs_systems": ["string"] | null
}
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

                // --- STEP 4: CALCULATE CONFIDENCE SCORES ---
                sendEvent('status', { message: 'Calculating confidence scores...', step: 'confidence', progress: 94 });
                
                const fieldConfidences: Record<string, number> = {};
                const allSources = researchQueries.flatMap(q => q.sources);
                
                if (extractedData.port_authority) {
                    fieldConfidences.portAuthority = calculateConfidence(
                        researchQueries.find(q => q.query.includes('port authority') || q.query.includes('governance'))?.result || '',
                        allSources
                    );
                }
                if (extractedData.customs_authority) {
                    fieldConfidences.customsAuthority = calculateConfidence(
                        researchQueries.find(q => q.query.includes('customs'))?.result || '',
                        allSources
                    );
                }
                if (extractedData.port_wide_identity_system) {
                    fieldConfidences.portWideIdentitySystem = calculateConfidence(
                        researchQueries.find(q => q.query.includes('identity') || q.query.includes('AlfaPass') || q.query.includes('CargoCard'))?.result || '',
                        allSources
                    );
                }
                if (extractedData.identity_competitors) {
                    fieldConfidences.identityCompetitors = calculateConfidence(
                        researchQueries.find(q => q.query.includes('identity') || q.query.includes('competitor'))?.result || '',
                        allSources
                    );
                }
                if (extractedData.identity_adoption_rate) {
                    fieldConfidences.identityAdoptionRate = calculateConfidence(
                        researchQueries.find(q => q.query.includes('adoption') || q.query.includes('identity'))?.result || '',
                        allSources
                    );
                }
                if (extractedData.port_level_isps_risk) {
                    fieldConfidences.portLevelISPSRisk = calculateConfidence(
                        researchQueries.find(q => q.query.includes('ISPS') || q.query.includes('risk'))?.result || '',
                        allSources
                    );
                }
                if (extractedData.isps_enforcement_strength) {
                    fieldConfidences.ispsEnforcementStrength = calculateConfidence(
                        researchQueries.find(q => q.query.includes('enforcement') || q.query.includes('ISPS'))?.result || '',
                        allSources
                    );
                }
                if (extractedData.dominant_tos_systems) {
                    fieldConfidences.dominantTOSSystems = calculateConfidence(
                        researchQueries.find(q => q.query.includes('TOS') || q.query.includes('Terminal Operating'))?.result || '',
                        allSources
                    );
                }
                if (extractedData.dominant_acs_systems) {
                    fieldConfidences.dominantACSSystems = calculateConfidence(
                        researchQueries.find(q => q.query.includes('ACS') || q.query.includes('Access Control'))?.result || '',
                        allSources
                    );
                }

                // --- STEP 5: LLM FIELD-BY-FIELD ANALYSIS ---
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
                }

                const fieldProposals: FieldProposal[] = [];
                const fieldsToAnalyze = [
                    { key: 'portAuthority', label: 'Port Authority', extracted: extractedData.port_authority, current: port.portAuthority },
                    { key: 'customsAuthority', label: 'Customs Authority', extracted: extractedData.customs_authority, current: port.customsAuthority },
                    { key: 'portWideIdentitySystem', label: 'Port-Wide Identity System', extracted: extractedData.port_wide_identity_system, current: port.portWideIdentitySystem },
                    { key: 'identityCompetitors', label: 'Identity Competitors', extracted: extractedData.identity_competitors, current: port.identityCompetitors ? JSON.parse(port.identityCompetitors) : null },
                    { key: 'identityAdoptionRate', label: 'Identity Adoption Rate', extracted: extractedData.identity_adoption_rate, current: port.identityAdoptionRate },
                    { key: 'portLevelISPSRisk', label: 'Port-Level ISPS Risk', extracted: extractedData.port_level_isps_risk, current: port.portLevelISPSRisk },
                    { key: 'ispsEnforcementStrength', label: 'ISPS Enforcement Strength', extracted: extractedData.isps_enforcement_strength, current: port.ispsEnforcementStrength },
                    { key: 'dominantTOSSystems', label: 'Dominant TOS Systems', extracted: extractedData.dominant_tos_systems, current: port.dominantTOSSystems ? JSON.parse(port.dominantTOSSystems) : null },
                    { key: 'dominantACSSystems', label: 'Dominant ACS Systems', extracted: extractedData.dominant_acs_systems, current: port.dominantACSSystems ? JSON.parse(port.dominantACSSystems) : null },
                ];

                const fieldsWithData = fieldsToAnalyze.filter(f => f.extracted);
                
                if (fieldsWithData.length > 0) {
                    const getRelevantResearch = (fieldKey: string): string => {
                        if (fieldKey === 'portAuthority' || fieldKey === 'customsAuthority') {
                            return researchQueries.find(q => q.query.includes('governance') || q.query.includes('authority'))?.result || '';
                        } else if (fieldKey.includes('identity')) {
                            return researchQueries.find(q => q.query.includes('identity'))?.result || '';
                        } else if (fieldKey.includes('ISPS') || fieldKey.includes('isps')) {
                            return researchQueries.find(q => q.query.includes('ISPS') || q.query.includes('security'))?.result || '';
                        } else if (fieldKey.includes('TOS') || fieldKey.includes('ACS')) {
                            return researchQueries.find(q => q.query.includes('system') || q.query.includes('TOS') || q.query.includes('ACS'))?.result || '';
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
                        const batchAnalysisRes = await openai.chat.completions.create({
                            model: 'gpt-4o',
                            messages: [{ role: 'user', content: batchAnalysisPrompt }],
                            response_format: { type: 'json_object' },
                            temperature: 0.2,
                        });

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
                            
                            fieldProposals.push({
                                field: fieldInfo.key,
                                currentValue: fieldInfo.current,
                                proposedValue: fieldInfo.extracted,
                                confidence: fieldConfidences[fieldInfo.key] || 0.5,
                                shouldUpdate,
                                reasoning: analysis.reasoning || 'No specific reasoning provided',
                                sources: allSources,
                                updatePriority: analysis.updatePriority || (['portAuthority', 'portWideIdentitySystem'].includes(fieldInfo.key) ? 'high' : 'medium')
                            });
                        }
                    } catch (e) {
                        // Fallback: use simple comparison
                        for (const fieldInfo of fieldsWithData) {
                            const shouldUpdate = fieldInfo.current !== fieldInfo.extracted && 
                                               (fieldConfidences[fieldInfo.key] || 0.5) >= 0.5;
                            fieldProposals.push({
                                field: fieldInfo.key,
                                currentValue: fieldInfo.current,
                                proposedValue: fieldInfo.extracted,
                                confidence: fieldConfidences[fieldInfo.key] || 0.5,
                                shouldUpdate,
                                reasoning: shouldUpdate ? 'Proposed value differs from current and has sufficient confidence' : 'Insufficient confidence or no change needed',
                                sources: allSources,
                                updatePriority: ['portAuthority', 'portWideIdentitySystem'].includes(fieldInfo.key) ? 'high' : 'medium'
                            });
                        }
                    }
                }

                // Generate research summary
                const summaryResearchText = researchText.length > 4000 ? researchText.substring(0, 4000) + '\n[... truncated ...]' : researchText;
                const summaryPrompt = `Summarize the key findings from this port research in 2-3 sentences:\n\n${summaryResearchText}`;
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

                // Validate extractedData fields
                const validISPSLevels = ['Low', 'Medium', 'High', 'Very High'];
                if (extractedData.port_level_isps_risk && !validISPSLevels.includes(extractedData.port_level_isps_risk)) {
                    throw {
                        category: 'VALIDATION_ERROR',
                        message: 'Received unexpected data format. Please try again.',
                        originalError: `Invalid ISPS level: ${extractedData.port_level_isps_risk}`,
                        retryable: false
                    };
                }
                const validEnforcementLevels = ['Weak', 'Moderate', 'Strong', 'Very Strong'];
                if (extractedData.isps_enforcement_strength && !validEnforcementLevels.includes(extractedData.isps_enforcement_strength)) {
                    throw {
                        category: 'VALIDATION_ERROR',
                        message: 'Received unexpected data format. Please try again.',
                        originalError: `Invalid enforcement strength: ${extractedData.isps_enforcement_strength}`,
                        retryable: false
                    };
                }
                if (extractedData.identity_competitors && !Array.isArray(extractedData.identity_competitors)) {
                    throw {
                        category: 'VALIDATION_ERROR',
                        message: 'Received unexpected data format. Please try again.',
                        originalError: 'Invalid identity_competitors: must be an array',
                        retryable: false
                    };
                }
                if (extractedData.dominant_tos_systems && !Array.isArray(extractedData.dominant_tos_systems)) {
                    throw {
                        category: 'VALIDATION_ERROR',
                        message: 'Received unexpected data format. Please try again.',
                        originalError: 'Invalid dominant_tos_systems: must be an array',
                        retryable: false
                    };
                }
                if (extractedData.dominant_acs_systems && !Array.isArray(extractedData.dominant_acs_systems)) {
                    throw {
                        category: 'VALIDATION_ERROR',
                        message: 'Received unexpected data format. Please try again.',
                        originalError: 'Invalid dominant_acs_systems: must be an array',
                        retryable: false
                    };
                }
                
                if (abortSignal.aborted) {
                    throw new Error('Request aborted');
                }

                // --- STEP 6: GENERATE STRATEGIC NOTES ---
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
                    const notesRes = await openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [{ role: 'user', content: notesPrompt }],
                        response_format: { type: 'json_object' },
                        temperature: 0.4,
                    });
                    const notesData = JSON.parse(notesRes.choices[0].message.content || '{}');
                    notesProposal = {
                        currentNotes: port.strategicNotes || '',
                        newFindings: notesData.newFindings || '',
                        combinedNotes: notesData.combinedNotes || port.strategicNotes || ''
                    };
                } catch (e) {
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
                sendEvent('status', { message: 'Preparing changes for review...', step: 'prepare', progress: 99 });

                interface PortUpdateData {
                    lastDeepResearchAt: Date;
                    lastDeepResearchSummary: string;
                    portAuthority?: string;
                    customsAuthority?: string;
                    portWideIdentitySystem?: string;
                    identityCompetitors?: string;
                    identityAdoptionRate?: string;
                    portLevelISPSRisk?: string;
                    ispsEnforcementStrength?: string;
                    dominantTOSSystems?: string;
                    dominantACSSystems?: string;
                    strategicNotes?: string;
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
                    else if (proposal.field === 'dominantTOSSystems' && Array.isArray(proposal.proposedValue)) {
                        dataToUpdate.dominantTOSSystems = JSON.stringify(proposal.proposedValue);
                    }
                    else if (proposal.field === 'dominantACSSystems' && Array.isArray(proposal.proposedValue)) {
                        dataToUpdate.dominantACSSystems = JSON.stringify(proposal.proposedValue);
                    }
                    // Format other fields
                    else if (proposal.proposedValue !== null && proposal.proposedValue !== undefined && proposal.proposedValue !== '') {
                        if (proposal.field === 'portAuthority') {
                            dataToUpdate.portAuthority = proposal.proposedValue;
                        } else if (proposal.field === 'customsAuthority') {
                            dataToUpdate.customsAuthority = proposal.proposedValue;
                        } else if (proposal.field === 'portWideIdentitySystem') {
                            dataToUpdate.portWideIdentitySystem = proposal.proposedValue;
                        } else if (proposal.field === 'identityAdoptionRate') {
                            dataToUpdate.identityAdoptionRate = proposal.proposedValue;
                        } else if (proposal.field === 'portLevelISPSRisk') {
                            dataToUpdate.portLevelISPSRisk = proposal.proposedValue;
                        } else if (proposal.field === 'ispsEnforcementStrength') {
                            dataToUpdate.ispsEnforcementStrength = proposal.proposedValue;
                        }
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

                // --- STEP 8: SEND PREVIEW EVENT ---
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
