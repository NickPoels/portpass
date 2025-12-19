export type CargoType =
    | "Container"
    | "RoRo"
    | "Dry Bulk"
    | "Liquid Bulk"
    | "Break Bulk"
    | "Multipurpose"
    | "Passenger/Ferry";

export type ClusterId =
    | "ANTWERP_ROTTERDAM_NSP"
    | "SPANISH_TRIAD"
    | "ITALIAN_LIGURIAN"
    | "PORTUGAL_ENERGY"
    | "HAROPA"
    | "GERMANY_NORTH"
    | "GREECE"
    | "EASTERN_SECURITY"
    | "UK_EAST_CONTAINER"
    | "UK_HUMBER_ENERGY"
    | "UK_SOLENT_ROPAX"
    | "UK_IRISH_SEA"
    | "NORDIC_SCANDI_TURNTABLE"
    | "NORDIC_GULF_FINLAND"
    | "NORDIC_NORWAY_ENERGY";

export type PriorityTier = 1 | 2 | 3;

export type ISPSRiskLevel = "Low" | "Medium" | "High" | "Very High";

export type ISPSEnforcementStrength = "Weak" | "Moderate" | "Strong" | "Very Strong";

export type OperatorType = "commercial" | "captive";

export interface TerminalLocation {
    name: string;
    latitude: number;
    longitude: number;
}

export interface Cluster {
    id: ClusterId;
    name: string;
    description: string;
    priorityTier: PriorityTier;
    countries: string[];

    // Strategic & Metadata Fields
    strategicNotes?: string | null;
}

export interface Port {
    id: string;
    name: string;
    country: string;
    clusterId: ClusterId;
    description?: string;

    // Governance Fields
    portAuthority?: string | null;

    // Identity System Fields
    identityCompetitors?: string[]; // Array of competitor names
    identityAdoptionRate?: string | null; // "High", "Medium", "Low", "None", or percentage

    // ISPS Risk Fields
    portLevelISPSRisk?: ISPSRiskLevel | null;
    ispsEnforcementStrength?: ISPSEnforcementStrength | null;

    // Strategic Notes
    strategicNotes?: string | null;

    // Deep Research Fields
    lastDeepResearchAt?: string | null; // ISO string format
    lastDeepResearchSummary?: string | null;
    lastDeepResearchReport?: string | null;
}

export interface TerminalOperator {
    id: string;
    name: string;
    portId: string;
    capacity: string | null;
    cargoTypes: CargoType[];
    operatorType: OperatorType;
    parentCompanies: string[] | null; // Array of parent company names
    strategicNotes: string | null;
    latitude: number | null; // Primary location for map centering
    longitude: number | null;
    locations: TerminalLocation[] | null; // Multiple terminal locations for visualization
    lastDeepResearchAt: string | null; // ISO string format
    lastDeepResearchSummary: string | null;
    lastDeepResearchReport: string | null;
}

export interface TerminalOperatorProposal {
    id: string;
    portId: string;
    name: string;
    operatorType: OperatorType | null;
    parentCompanies: string[] | null;
    capacity: string | null;
    cargoTypes: CargoType[] | null;
    latitude: number | null;
    longitude: number | null;
    locations: TerminalLocation[] | null;
    status: "pending" | "approved" | "rejected";
    createdAt: string;  // ISO string
    approvedAt?: string | null;  // ISO string
}

export interface ParentCompany {
    id: string;
    name: string;
    description: string | null;
    website: string | null;
}
