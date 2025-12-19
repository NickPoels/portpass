/**
 * Terminal query configuration for multi-query terminal discovery
 * Defines queries for different terminal types with optimized model selection
 */

export type TerminalCategory = 'container' | 'roro' | 'liquid_bulk' | 'dry_bulk' | 'multipurpose' | 'port_authority';
export type QueryPriority = 'high' | 'medium' | 'low';
export type PerplexityModel = 'sonar' | 'sonar-pro' | 'sonar-deep-research';

export interface TerminalQueryConfig {
    category: TerminalCategory;
    query: string;
    priority: QueryPriority;
    systemPrompt?: string;
    model?: PerplexityModel; // Perplexity model override
}

/**
 * Generate terminal discovery queries for a given port
 */
export function generateTerminalQueries(portName: string, country: string): TerminalQueryConfig[] {
    const queries: TerminalQueryConfig[] = [
        {
            category: 'container',
            priority: 'high',
            model: 'sonar',
            query: `List all container terminals in ${portName}, ${country}. Include: exact terminal name, operator/company name, capacity (TEU if available), berth numbers, and exact location coordinates (latitude and longitude in decimal degrees). Focus on deepsea container terminals operated by major operators like PSA, DP World, APM Terminals, MSC, COSCO, and others. Be comprehensive and include all container terminals.`,
            systemPrompt: 'You are a maritime and port research assistant. Always cite your sources. Provide accurate terminal names and locations.'
        },
        {
            category: 'roro',
            priority: 'medium',
            model: 'sonar',
            query: `List all RoRo (roll-on/roll-off) terminals and vehicle terminals in ${portName}, ${country}. Include: exact terminal name, operator/company name, location coordinates (latitude and longitude), and any capacity information. Include terminals handling vehicles, heavy equipment, and RoRo cargo.`,
            systemPrompt: 'You are a maritime and port research assistant. Always cite your sources. Provide accurate terminal names and locations.'
        },
        {
            category: 'liquid_bulk',
            priority: 'medium',
            model: 'sonar',
            query: `List all liquid bulk terminals in ${portName}, ${country}. Include: exact terminal name, operator/company name, location coordinates (latitude and longitude), and types of liquid cargo handled (oil, chemicals, LNG, petroleum products, etc.). Include storage terminals for liquid bulk commodities.`,
            systemPrompt: 'You are a maritime and port research assistant. Always cite your sources. Provide accurate terminal names and locations.'
        },
        {
            category: 'dry_bulk',
            priority: 'medium',
            model: 'sonar',
            query: `List all dry bulk terminals in ${portName}, ${country}. Include: exact terminal name, operator/company name, location coordinates (latitude and longitude), and types of dry bulk cargo handled (coal, grain, ore, minerals, fertilizers, etc.). Include terminals handling dry bulk commodities.`,
            systemPrompt: 'You are a maritime and port research assistant. Always cite your sources. Provide accurate terminal names and locations.'
        },
        {
            category: 'multipurpose',
            priority: 'low',
            model: 'sonar',
            query: `List all multipurpose and breakbulk terminals in ${portName}, ${country}. Include: exact terminal name, operator/company name, location coordinates (latitude and longitude), and types of cargo handled (project cargo, steel, wood, general cargo, breakbulk, etc.). Include terminals handling conventional and specialized cargo.`,
            systemPrompt: 'You are a maritime and port research assistant. Always cite your sources. Provide accurate terminal names and locations.'
        },
        {
            category: 'port_authority',
            priority: 'high',
            model: 'sonar-pro',
            query: `Search the official port authority website or terminal directory for ${portName}, ${country}. Find the complete list of terminals, concessions, and facilities. Include terminal names, operators, locations (latitude and longitude if available), berth/quay numbers, and any official terminal directory information. Prioritize official port authority sources and terminal operator websites.`,
            systemPrompt: 'You are a maritime and port research assistant. Always cite your sources with URLs when available. Prioritize official port authority sources and terminal operator websites. Provide accurate terminal names and locations from official directories.'
        }
    ];

    return queries;
}

