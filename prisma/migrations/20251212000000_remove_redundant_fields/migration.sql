-- Remove redundant fields from Terminal and Port tables
-- SQLite does not support ALTER TABLE DROP COLUMN directly
-- Using table recreation approach for compatibility

-- Step 1: Create new Terminal table without removed fields
CREATE TABLE "Terminal_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "portId" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "cargoTypes" TEXT NOT NULL,
    "capacity" TEXT,
    "ispsRiskLevel" TEXT,
    "notes" TEXT,
    "operatorGroup" TEXT,
    "ownership" TEXT,
    "lastDeepResearchAt" DATETIME,
    "lastDeepResearchSummary" TEXT,
    CONSTRAINT "Terminal_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 2: Copy data from old Terminal table to new table (excluding removed fields)
INSERT INTO "Terminal_new" (
    "id", "name", "portId", "latitude", "longitude", "cargoTypes",
    "capacity", "ispsRiskLevel", "notes",
    "operatorGroup", "ownership", "lastDeepResearchAt", "lastDeepResearchSummary"
)
SELECT 
    "id", "name", "portId", "latitude", "longitude", "cargoTypes",
    "capacity", "ispsRiskLevel", "notes",
    "operatorGroup", "ownership", "lastDeepResearchAt", "lastDeepResearchSummary"
FROM "Terminal";

-- Step 3: Drop old Terminal table
DROP TABLE "Terminal";

-- Step 4: Rename new Terminal table to original name
ALTER TABLE "Terminal_new" RENAME TO "Terminal";

-- Step 5: Create new Port table without latitude/longitude
CREATE TABLE "Port_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "description" TEXT,
    CONSTRAINT "Port_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 6: Copy data from old Port table to new table (excluding latitude/longitude)
INSERT INTO "Port_new" (
    "id", "name", "country", "clusterId", "description"
)
SELECT 
    "id", "name", "country", "clusterId", "description"
FROM "Port";

-- Step 7: Drop old Port table
DROP TABLE "Port";

-- Step 8: Rename new Port table to original name
ALTER TABLE "Port_new" RENAME TO "Port";
