-- Migration: Terminal to TerminalOperator
-- This migration replaces Terminal and TerminalProposal with TerminalOperator and TerminalOperatorProposal
-- All existing terminal data will be dropped (clean slate)

-- Step 1: Drop Terminal table
DROP TABLE IF EXISTS "Terminal";

-- Step 2: Drop TerminalProposal table
DROP TABLE IF EXISTS "TerminalProposal";

-- Step 3: Create TerminalOperator table
CREATE TABLE "TerminalOperator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "portId" TEXT NOT NULL,
    "capacity" TEXT,
    "cargoTypes" TEXT NOT NULL,
    "operatorType" TEXT NOT NULL,
    "parentCompanies" TEXT,
    "strategicNotes" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "locations" TEXT,
    "lastDeepResearchAt" DATETIME,
    "lastDeepResearchSummary" TEXT,
    "lastDeepResearchReport" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("portId") REFERENCES "Port"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 4: Create TerminalOperatorProposal table
CREATE TABLE "TerminalOperatorProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operatorType" TEXT,
    "parentCompanies" TEXT,
    "capacity" TEXT,
    "cargoTypes" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "locations" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    FOREIGN KEY ("portId") REFERENCES "Port"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 5: Create ParentCompany table
CREATE TABLE "ParentCompany" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL UNIQUE,
    "description" TEXT,
    "website" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Step 6: Create indexes for TerminalOperator
CREATE INDEX "TerminalOperator_portId_idx" ON "TerminalOperator"("portId");
CREATE INDEX "TerminalOperator_operatorType_idx" ON "TerminalOperator"("operatorType");

-- Step 7: Create indexes for TerminalOperatorProposal
CREATE INDEX "TerminalOperatorProposal_portId_status_idx" ON "TerminalOperatorProposal"("portId", "status");
CREATE INDEX "TerminalOperatorProposal_status_idx" ON "TerminalOperatorProposal"("status");

-- Step 8: Update ResearchJob type comment (no schema change, just documentation)
-- The type field will now accept "terminal_operator" instead of "terminal"
-- Existing jobs with type "terminal" can be cleaned up manually if needed
