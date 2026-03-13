-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "System" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "System_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Field" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "dataType" TEXT NOT NULL,
    "length" INTEGER,
    "precision" INTEGER,
    "scale" INTEGER,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "isKey" BOOLEAN NOT NULL DEFAULT false,
    "isExternalId" BOOLEAN NOT NULL DEFAULT false,
    "picklistValues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jxchangeXPath" TEXT,
    "jxchangeXtendElemKey" TEXT,
    "iso20022Name" TEXT,
    "complianceTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "complianceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "viaField" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MappingProject" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceSystemId" TEXT NOT NULL,
    "targetSystemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MappingProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityMapping" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldMapping" (
    "id" TEXT NOT NULL,
    "entityMappingId" TEXT NOT NULL,
    "sourceFieldId" TEXT NOT NULL,
    "targetFieldId" TEXT NOT NULL,
    "transform" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "seedSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalDomain" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalField" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "conceptName" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "complianceTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isDeprecated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldCanonicalMap" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "canonicalFieldId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "mappedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldCanonicalMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DerivedMapping" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sourceSystemId" TEXT NOT NULL,
    "sourceEntityName" TEXT NOT NULL,
    "sourceFieldName" TEXT NOT NULL,
    "targetSystemId" TEXT NOT NULL,
    "targetEntityName" TEXT NOT NULL,
    "targetFieldName" TEXT NOT NULL,
    "canonicalFieldId" TEXT,
    "preferredTransform" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "acceptCount" INTEGER NOT NULL DEFAULT 0,
    "rejectCount" INTEGER NOT NULL DEFAULT 0,
    "lastAcceptedAt" TIMESTAMP(3),
    "lastRejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DerivedMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MappingEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT,
    "fieldMappingId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "sourceSystemId" TEXT NOT NULL,
    "sourceEntityName" TEXT NOT NULL,
    "sourceFieldName" TEXT NOT NULL,
    "targetSystemId" TEXT NOT NULL,
    "targetEntityName" TEXT NOT NULL,
    "targetFieldName" TEXT NOT NULL,
    "transformType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MappingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organisationId_idx" ON "User"("organisationId");

-- CreateIndex
CREATE INDEX "Entity_systemId_idx" ON "Entity"("systemId");

-- CreateIndex
CREATE INDEX "Field_entityId_idx" ON "Field"("entityId");

-- CreateIndex
CREATE INDEX "Relationship_fromEntityId_idx" ON "Relationship"("fromEntityId");

-- CreateIndex
CREATE INDEX "MappingProject_organisationId_idx" ON "MappingProject"("organisationId");

-- CreateIndex
CREATE INDEX "MappingProject_userId_idx" ON "MappingProject"("userId");

-- CreateIndex
CREATE INDEX "EntityMapping_projectId_idx" ON "EntityMapping"("projectId");

-- CreateIndex
CREATE INDEX "FieldMapping_entityMappingId_idx" ON "FieldMapping"("entityMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalDomain_name_key" ON "CanonicalDomain"("name");

-- CreateIndex
CREATE INDEX "CanonicalField_domainId_idx" ON "CanonicalField"("domainId");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalField_domainId_conceptName_key" ON "CanonicalField"("domainId", "conceptName");

-- CreateIndex
CREATE INDEX "FieldCanonicalMap_canonicalFieldId_idx" ON "FieldCanonicalMap"("canonicalFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldCanonicalMap_fieldId_canonicalFieldId_key" ON "FieldCanonicalMap"("fieldId", "canonicalFieldId");

-- CreateIndex
CREATE INDEX "DerivedMapping_organisationId_confidence_idx" ON "DerivedMapping"("organisationId", "confidence");

-- CreateIndex
CREATE UNIQUE INDEX "DerivedMapping_organisationId_sourceSystemId_sourceEntityNa_key" ON "DerivedMapping"("organisationId", "sourceSystemId", "sourceEntityName", "sourceFieldName", "targetSystemId", "targetEntityName", "targetFieldName");

-- CreateIndex
CREATE INDEX "MappingEvent_organisationId_createdAt_idx" ON "MappingEvent"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "MappingEvent_projectId_createdAt_idx" ON "MappingEvent"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Field" ADD CONSTRAINT "Field_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingProject" ADD CONSTRAINT "MappingProject_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingProject" ADD CONSTRAINT "MappingProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingProject" ADD CONSTRAINT "MappingProject_sourceSystemId_fkey" FOREIGN KEY ("sourceSystemId") REFERENCES "System"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingProject" ADD CONSTRAINT "MappingProject_targetSystemId_fkey" FOREIGN KEY ("targetSystemId") REFERENCES "System"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMapping" ADD CONSTRAINT "EntityMapping_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MappingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMapping" ADD CONSTRAINT "EntityMapping_sourceEntityId_fkey" FOREIGN KEY ("sourceEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMapping" ADD CONSTRAINT "EntityMapping_targetEntityId_fkey" FOREIGN KEY ("targetEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldMapping" ADD CONSTRAINT "FieldMapping_entityMappingId_fkey" FOREIGN KEY ("entityMappingId") REFERENCES "EntityMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldMapping" ADD CONSTRAINT "FieldMapping_sourceFieldId_fkey" FOREIGN KEY ("sourceFieldId") REFERENCES "Field"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldMapping" ADD CONSTRAINT "FieldMapping_targetFieldId_fkey" FOREIGN KEY ("targetFieldId") REFERENCES "Field"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalField" ADD CONSTRAINT "CanonicalField_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "CanonicalDomain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldCanonicalMap" ADD CONSTRAINT "FieldCanonicalMap_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "Field"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldCanonicalMap" ADD CONSTRAINT "FieldCanonicalMap_canonicalFieldId_fkey" FOREIGN KEY ("canonicalFieldId") REFERENCES "CanonicalField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DerivedMapping" ADD CONSTRAINT "DerivedMapping_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DerivedMapping" ADD CONSTRAINT "DerivedMapping_canonicalFieldId_fkey" FOREIGN KEY ("canonicalFieldId") REFERENCES "CanonicalField"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingEvent" ADD CONSTRAINT "MappingEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingEvent" ADD CONSTRAINT "MappingEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MappingProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingEvent" ADD CONSTRAINT "MappingEvent_fieldMappingId_fkey" FOREIGN KEY ("fieldMappingId") REFERENCES "FieldMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingEvent" ADD CONSTRAINT "MappingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
