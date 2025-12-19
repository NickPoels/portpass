-- CreateTable
CREATE TABLE "ResearchJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "clusterId" TEXT,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ResearchJob_status_type_idx" ON "ResearchJob"("status", "type");

-- CreateIndex
CREATE INDEX "ResearchJob_clusterId_idx" ON "ResearchJob"("clusterId");
