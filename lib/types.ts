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
    | "EASTERN_SECURITY";

export type PriorityTier = 1 | 2 | 3;

export type ISPSRiskLevel = "Low" | "Medium" | "High" | "Very High";

export interface Cluster {
    id: ClusterId;
    name: string;
    description: string;
    priorityTier: PriorityTier;
    countries: string[];
}

export interface Port {
    id: string;
    name: string;
    country: string;
    clusterId: ClusterId;
    latitude: number;
    longitude: number;
    description?: string;
}

export interface Terminal {
    id: string;
    name: string;
    portId: string;
    // properties derived from port are removed from here
    latitude: number;
    longitude: number;
    cargoTypes: string[];
    estAnnualVolume: string;
    ispsRiskLevel: ISPSRiskLevel;
    ispsComplianceReason?: string;
    notes?: string;

    // Deep Research Fields
    officialName?: string | null;
    operatorGroup?: string | null;
    ownership?: string | null;
    leadership?: string | null; // Stored as JSON string
    cargoSpecializations?: string | null; // Stored as JSON string
    infrastructure?: string | null;
    volumes?: string | null;
    digitalizationSecurity?: string | null;
    lastDeepResearchAt?: Date | string | null;
    lastDeepResearchSummary?: string | null;
}
