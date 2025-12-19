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

export interface Terminal {
    id: string;
    name: string;
    portId: string;
    // properties derived from port are removed from here
    latitude: number;
    longitude: number;
    cargoTypes: string[];
    capacity: string;
    notes?: string;

    // Deep Research Fields
    operatorGroup?: string | null;
    lastDeepResearchAt?: string | null; // ISO string format
    lastDeepResearchSummary?: string | null;
    lastDeepResearchReport?: string | null;
}

export interface TerminalProposal {
    id: string;
    portId: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
    address?: string | null;  // Address/location description
    status: "pending" | "approved" | "rejected";
    createdAt: string;  // ISO string
    approvedAt?: string | null;  // ISO string
}
