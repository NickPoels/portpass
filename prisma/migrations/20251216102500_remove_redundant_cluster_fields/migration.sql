-- Remove redundant fields from Cluster table
-- SQLite does not support ALTER TABLE DROP COLUMN directly
-- Using table recreation approach for compatibility

-- Step 1: Create new Cluster table without removed fields
CREATE TABLE "Cluster_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "countries" TEXT NOT NULL,
    "priorityTier" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "strategicNotes" TEXT
);

-- Step 2: Copy data from old Cluster table to new table (excluding removed fields)
INSERT INTO "Cluster_new" (
    "id", "name", "countries", "priorityTier", "description", "strategicNotes"
)
SELECT 
    "id", "name", "countries", "priorityTier", "description", "strategicNotes"
FROM "Cluster";

-- Step 3: Drop old Cluster table
DROP TABLE "Cluster";

-- Step 4: Rename new Cluster table to original name
ALTER TABLE "Cluster_new" RENAME TO "Cluster";



