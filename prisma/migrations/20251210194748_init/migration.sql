-- CreateTable
CREATE TABLE "Cluster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "countries" TEXT NOT NULL,
    "priorityTier" INTEGER NOT NULL,
    "description" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Port" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "description" TEXT,
    CONSTRAINT "Port_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "portId" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "cargoTypes" TEXT NOT NULL,
    "estAnnualVolume" TEXT,
    "ispsRiskLevel" TEXT,
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
