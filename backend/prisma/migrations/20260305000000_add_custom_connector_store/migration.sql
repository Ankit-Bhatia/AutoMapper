-- CreateTable
CREATE TABLE "CustomConnector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "entityNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entities" JSONB NOT NULL,
    "connectionConfig" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomConnector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomConnector_createdAt_idx" ON "CustomConnector"("createdAt");

-- CreateIndex
CREATE INDEX "CustomConnector_createdByUserId_idx" ON "CustomConnector"("createdByUserId");
