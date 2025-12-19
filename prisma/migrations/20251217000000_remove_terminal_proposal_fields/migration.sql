-- Remove terminal proposal fields and clean up data
-- This migration removes: cargoTypes, operatorGroup, capacity, confidence, source, researchJobId

-- SQLite doesn't support dropping columns directly, so we need to recreate the table
-- Step 1: Create new table with simplified schema
CREATE TABLE "TerminalProposal_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    FOREIGN KEY ("portId") REFERENCES "Port"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 2: Copy data from old table (only fields that exist in new schema)
-- Delete all existing records first (as per plan requirement to clean up)
-- Then copy structure if table exists
INSERT INTO "TerminalProposal_new" ("id", "portId", "name", "latitude", "longitude", "status", "createdAt", "approvedAt")
SELECT "id", "portId", "name", "latitude", "longitude", "status", "createdAt", "approvedAt"
FROM "TerminalProposal"
WHERE 0; -- This ensures no data is copied (we want to delete all)

-- Step 3: Drop old table
DROP TABLE IF EXISTS "TerminalProposal";

-- Step 4: Rename new table
ALTER TABLE "TerminalProposal_new" RENAME TO "TerminalProposal";

-- Step 5: Create indexes
CREATE INDEX "TerminalProposal_portId_status_idx" ON "TerminalProposal"("portId", "status");
CREATE INDEX "TerminalProposal_status_idx" ON "TerminalProposal"("status");
