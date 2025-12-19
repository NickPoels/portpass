-- Add metadata fields to Port table
ALTER TABLE "Port" ADD COLUMN "portAuthority" TEXT;
ALTER TABLE "Port" ADD COLUMN "customsAuthority" TEXT;
ALTER TABLE "Port" ADD COLUMN "portWideIdentitySystem" TEXT;
ALTER TABLE "Port" ADD COLUMN "identityCompetitors" TEXT;
ALTER TABLE "Port" ADD COLUMN "identityAdoptionRate" TEXT;
ALTER TABLE "Port" ADD COLUMN "portLevelISPSRisk" TEXT;
ALTER TABLE "Port" ADD COLUMN "ispsEnforcementStrength" TEXT;
ALTER TABLE "Port" ADD COLUMN "dominantTOSSystems" TEXT;
ALTER TABLE "Port" ADD COLUMN "dominantACSSystems" TEXT;
ALTER TABLE "Port" ADD COLUMN "strategicNotes" TEXT;



