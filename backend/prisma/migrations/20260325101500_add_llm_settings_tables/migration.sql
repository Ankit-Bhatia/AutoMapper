CREATE TABLE "LLMUserConfig" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'default',
  "provider" TEXT,
  "encryptedApiKey" TEXT,
  "apiKeyHint" TEXT,
  "baseUrl" TEXT,
  "model" TEXT,
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LLMUserConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LLMUsageEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "requestId" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT,
  "tokensUsed" INTEGER,
  "durationMs" INTEGER NOT NULL,
  "success" BOOLEAN NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LLMUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LLMUserConfig_userId_key" ON "LLMUserConfig"("userId");
CREATE INDEX "LLMUserConfig_userId_idx" ON "LLMUserConfig"("userId");
CREATE INDEX "LLMUsageEvent_userId_createdAt_idx" ON "LLMUsageEvent"("userId", "createdAt");
