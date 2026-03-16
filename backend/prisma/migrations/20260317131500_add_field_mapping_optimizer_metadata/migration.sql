ALTER TABLE "FieldMapping"
  ADD COLUMN IF NOT EXISTS "optimizerDisplacement" JSONB,
  ADD COLUMN IF NOT EXISTS "lowConfidenceFallback" BOOLEAN NOT NULL DEFAULT false;
