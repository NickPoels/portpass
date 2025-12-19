-- Remove redundant fields from Terminal table
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
    "notes" TEXT,
    "operatorGroup" TEXT,
    "lastDeepResearchAt" DATETIME,
    "lastDeepResearchSummary" TEXT,
    "lastDeepResearchReport" TEXT,
    CONSTRAINT "Terminal_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 2: Copy data from old Terminal table to new table (excluding removed fields)
INSERT INTO "Terminal_new" (
    "id", "name", "portId", "latitude", "longitude", "cargoTypes",
    "capacity", "notes", "operatorGroup",
    "lastDeepResearchAt", "lastDeepResearchSummary", "lastDeepResearchReport"
)
SELECT 
    "id", "name", "portId", "latitude", "longitude", "cargoTypes",
    "capacity", "notes", "operatorGroup",
    "lastDeepResearchAt", "lastDeepResearchSummary", "lastDeepResearchReport"
FROM "Terminal";

-- Step 3: Drop old Terminal table
DROP TABLE "Terminal";

-- Step 4: Rename new Terminal table to original name
ALTER TABLE "Terminal_new" RENAME TO "Terminal";



