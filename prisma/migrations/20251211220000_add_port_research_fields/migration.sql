-- Add deep research tracking fields to Port table
ALTER TABLE "Port" ADD COLUMN "lastDeepResearchAt" DATETIME;
ALTER TABLE "Port" ADD COLUMN "lastDeepResearchSummary" TEXT;
ALTER TABLE "Port" ADD COLUMN "lastDeepResearchReport" TEXT;
