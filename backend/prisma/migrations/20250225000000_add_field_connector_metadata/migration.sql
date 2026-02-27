-- Migration: add_field_connector_metadata
-- Adds jXchange XPath, ISO 20022 name, and compliance metadata columns to the Field table.
-- These fields are populated by Jack Henry (SilverLake / Core Director / Symitar) connectors
-- and are used by ComplianceAgent and BankingDomainAgent during orchestration.

ALTER TABLE "Field"
  ADD COLUMN IF NOT EXISTS "jxchangeXPath"        TEXT,
  ADD COLUMN IF NOT EXISTS "jxchangeXtendElemKey" TEXT,
  ADD COLUMN IF NOT EXISTS "iso20022Name"          TEXT,
  ADD COLUMN IF NOT EXISTS "complianceTags"        TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "complianceNote"        TEXT;

-- Create index for compliance tag lookups (e.g. find all PCI_CARD fields quickly)
CREATE INDEX IF NOT EXISTS "Field_complianceTags_idx" ON "Field" USING GIN ("complianceTags");
