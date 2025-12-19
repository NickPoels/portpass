/**
 * Terminal operator query configuration for multi-query operator discovery
 * Defines queries for discovering terminal operators (commercial and captive) at ports
 */

export type OperatorCategory = 'commercial_operators' | 'captive_operators' | 'port_authority';
export type QueryPriority = 'high' | 'medium' | 'low';
export type PerplexityModel = 'sonar' | 'sonar-pro' | 'sonar-deep-research';

export interface OperatorQueryConfig {
    category: OperatorCategory;
    query: string;
    priority: QueryPriority;
    systemPrompt?: string;
    model?: PerplexityModel;
}

/**
 * Generate terminal operator discovery queries for a given port
 */
export function generateOperatorQueries(portName: string, country: string): OperatorQueryConfig[] {
    const queries: OperatorQueryConfig[] = [
        {
            category: 'commercial_operators',
            priority: 'high',
            model: 'sonar',
            query: `Find all commercial terminal operators active in ${portName}, ${country}. For each operator, identify:
- Exact operator name (e.g., "PSA Singapore", "DP World Rotterdam", "APM Terminals")
- Parent company or international network (e.g., "PSA International", "DP World", "Maersk")
- Terminal locations operated by this operator (terminal names, latitude/longitude coordinates if available)
- Cargo types handled (container, dry bulk, liquid bulk, roro, multipurpose, etc.)
- Capacity information (TEU, tonnage, etc.) if available
- Whether operator has multiple terminal locations at this port

Focus on major commercial terminal operators like PSA, DP World, APM Terminals, MSC, COSCO, Hutchison Ports, and other international terminal operators.`,
            systemPrompt: 'You are a maritime and port research assistant. Always cite your sources. Focus on identifying terminal operators (companies that operate terminals), not just individual terminals. Provide accurate operator names, parent companies, and locations.'
        },
        {
            category: 'captive_operators',
            priority: 'high',
            model: 'sonar',
            query: `Find all companies with captive terminals (terminals operated by companies for their own cargo) in ${portName}, ${country}. For each company, identify:
- Company name operating the captive terminal (e.g., "BASF", "Arcelor Mittal", "Shell", "ExxonMobil")
- Terminal name(s) or facility name(s) operated by this company
- Terminal locations (latitude/longitude coordinates if available)
- Cargo types handled (typically related to the company's business: chemicals, steel, oil, etc.)
- Capacity information if available
- Whether the company has multiple terminal locations at this port

Focus on major industrial companies that operate their own terminals for handling their cargo, such as chemical companies, steel manufacturers, oil companies, and other industrial operators.`,
            systemPrompt: 'You are a maritime and port research assistant. Always cite your sources. Focus on identifying companies that operate terminals for their own cargo (captive terminals), not commercial third-party operators. Provide accurate company names and terminal locations.'
        },
        {
            category: 'port_authority',
            priority: 'high',
            model: 'sonar-pro',
            query: `Search the official port authority website or terminal directory for ${portName}, ${country}. Find:
- Complete list of all terminal operators (both commercial and captive/industrial)
- Official operator names and any parent company relationships
- Terminal locations and facilities operated by each operator
- Cargo types and capacity information
- Any official terminal operator directory or concession information

Prioritize official port authority sources, terminal operator websites, and official port directories. This should provide the most authoritative and comprehensive list of operators.`,
            systemPrompt: 'You are a maritime and port research assistant. Always cite your sources with URLs when available. Prioritize official port authority sources and terminal operator websites. Focus on identifying terminal operators (companies), not just listing terminal names. Provide accurate operator names, parent companies, and locations from official directories.'
        }
    ];

    return queries;
}
