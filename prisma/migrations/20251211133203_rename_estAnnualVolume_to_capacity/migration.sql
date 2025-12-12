-- RenameColumn
-- SQLite does not support ALTER TABLE RENAME COLUMN directly in all versions
-- Using table recreation approach for compatibility

-- Step 1: Create new table with renamed column
CREATE TABLE "Terminal_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "portId" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "cargoTypes" TEXT NOT NULL,
    "capacity" TEXT,
    "ispsRiskLevel" TEXT,
    "ispsComplianceReason" TEXT,
    "notes" TEXT,
    "officialName" TEXT,
    "operatorGroup" TEXT,
    "ownership" TEXT,
    "leadership" TEXT,
    "cargoSpecializations" TEXT,
    "infrastructure" TEXT,
    "volumes" TEXT,
    "digitalizationSecurity" TEXT,
    "lastDeepResearchAt" DATETIME,
    "lastDeepResearchSummary" TEXT,
    CONSTRAINT "Terminal_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Step 2: Copy data from old table to new table
INSERT INTO "Terminal_new" (
    "id", "name", "portId", "latitude", "longitude", "cargoTypes",
    "capacity", "ispsRiskLevel", "ispsComplianceReason", "notes",
    "officialName", "operatorGroup", "ownership", "leadership",
    "cargoSpecializations", "infrastructure", "volumes",
    "digitalizationSecurity", "lastDeepResearchAt", "lastDeepResearchSummary"
)
SELECT 
    "id", "name", "portId", "latitude", "longitude", "cargoTypes",
    "estAnnualVolume" as "capacity", "ispsRiskLevel", "ispsComplianceReason", "notes",
    "officialName", "operatorGroup", "ownership", "leadership",
    "cargoSpecializations", "infrastructure", "volumes",
    "digitalizationSecurity", "lastDeepResearchAt", "lastDeepResearchSummary"
FROM "Terminal";

-- Step 3: Drop old table
DROP TABLE "Terminal";

-- Step 4: Rename new table to original name
ALTER TABLE "Terminal_new" RENAME TO "Terminal";
