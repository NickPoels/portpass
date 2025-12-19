-- Remove redundant fields from Port table
-- SQLite does not support ALTER TABLE DROP COLUMN directly
-- Using table recreation approach for compatibility

-- Step 1: Create new Port table without removed fields
CREATE TABLE "Port_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "description" TEXT,
    "portAuthority" TEXT,
    "identityCompetitors" TEXT,
    "identityAdoptionRate" TEXT,
    "portLevelISPSRisk" TEXT,
    "ispsEnforcementStrength" TEXT,
    "strategicNotes" TEXT,
    "lastDeepResearchAt" DATETIME,
    "lastDeepResearchSummary" TEXT,
    "lastDeepResearchReport" TEXT,
    CONSTRAINT "Port_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 2: Copy data from old Port table to new table (excluding removed fields)
INSERT INTO "Port_new" (
    "id", "name", "country", "clusterId", "description",
    "portAuthority", "identityCompetitors", "identityAdoptionRate",
    "portLevelISPSRisk", "ispsEnforcementStrength", "strategicNotes",
    "lastDeepResearchAt", "lastDeepResearchSummary", "lastDeepResearchReport"
)
SELECT 
    "id", "name", "country", "clusterId", "description",
    "portAuthority", "identityCompetitors", "identityAdoptionRate",
    "portLevelISPSRisk", "ispsEnforcementStrength", "strategicNotes",
    "lastDeepResearchAt", "lastDeepResearchSummary", "lastDeepResearchReport"
FROM "Port";

-- Step 3: Drop old Port table
DROP TABLE "Port";

-- Step 4: Rename new Port table to original name
ALTER TABLE "Port_new" RENAME TO "Port";



