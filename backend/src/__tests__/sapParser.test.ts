import { describe, it, expect } from 'vitest';
import { parseSapSchema } from '../services/sapParser.js';

const SYSTEM_ID = 'test-system-id';

// ─── JSON ─────────────────────────────────────────────────────────────────────
const SAP_JSON = JSON.stringify({
  entities: [
    {
      name: 'Customer',
      label: 'Customer Master',
      description: 'SAP Customer Master table',
      fields: [
        { name: 'KUNNR', label: 'Customer Number', dataType: 'string', length: 10, isKey: true, required: true },
        { name: 'NAME1', label: 'Name 1', dataType: 'string', length: 35 },
        { name: 'LAND1', label: 'Country Key', dataType: 'string', length: 3 },
        { name: 'ERDAT', label: 'Created Date', dataType: 'date' },
      ],
    },
    {
      name: 'SalesOrder',
      label: 'Sales Order',
      fields: [
        { name: 'VBELN', label: 'Sales Doc Number', dataType: 'string', isKey: true, required: true },
        { name: 'KUNNR', label: 'Customer Number', dataType: 'string' },
        { name: 'NETWR', label: 'Net Value', dataType: 'decimal', precision: 13, scale: 2 },
      ],
    },
  ],
  relationships: [
    { fromEntity: 'SalesOrder', toEntity: 'Customer', type: 'lookup', viaField: 'KUNNR' },
  ],
});

// ─── OData XML ────────────────────────────────────────────────────────────────
const ODATA_XML = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices>
    <Schema Namespace="NorthwindModel" xmlns="http://schemas.microsoft.com/ado/2009/11/edm">
      <EntityType Name="Product">
        <Key>
          <PropertyRef Name="ProductID"/>
        </Key>
        <Property Name="ProductID" Type="Edm.Int32" Nullable="false"/>
        <Property Name="ProductName" Type="Edm.String" MaxLength="40" Nullable="false"/>
        <Property Name="UnitPrice" Type="Edm.Decimal" Precision="19" Scale="4"/>
        <Property Name="Discontinued" Type="Edm.Boolean" Nullable="false"/>
      </EntityType>
      <EntityType Name="Category">
        <Key>
          <PropertyRef Name="CategoryID"/>
        </Key>
        <Property Name="CategoryID" Type="Edm.Int32" Nullable="false"/>
        <Property Name="CategoryName" Type="Edm.String" MaxLength="15" Nullable="false"/>
      </EntityType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

// ─── CSV ──────────────────────────────────────────────────────────────────────
// Columns must match the parser's expected lowercase names: entity, field, datatype, required, iskey
const SAP_CSV = `entity,field,datatype,required,iskey
BankAccount,BankAccountId,string,true,true
BankAccount,AccountHolder,string,true,false
BankAccount,IBAN,string,false,false
BankAccount,Balance,decimal,false,false`;

describe('parseSapSchema — JSON', () => {
  it('should parse 2 entities', () => {
    const result = parseSapSchema(SAP_JSON, 'sap-schema.json', SYSTEM_ID);
    expect(result.entities).toHaveLength(2);
    expect(result.entities.map((e) => e.name)).toEqual(expect.arrayContaining(['Customer', 'SalesOrder']));
  });

  it('should parse all fields for Customer entity', () => {
    const result = parseSapSchema(SAP_JSON, 'sap-schema.json', SYSTEM_ID);
    const customerEntity = result.entities.find((e) => e.name === 'Customer')!;
    const customerFields = result.fields.filter((f) => f.entityId === customerEntity.id);
    expect(customerFields).toHaveLength(4);
    expect(customerFields.map((f) => f.name)).toEqual(
      expect.arrayContaining(['KUNNR', 'NAME1', 'LAND1', 'ERDAT']),
    );
  });

  it('should mark isKey and required on KUNNR', () => {
    const result = parseSapSchema(SAP_JSON, 'sap-schema.json', SYSTEM_ID);
    const kunnr = result.fields.find((f) => f.name === 'KUNNR' && f.isKey === true);
    expect(kunnr).toBeDefined();
    expect(kunnr?.required).toBe(true);
  });

  it('should parse relationships', () => {
    const result = parseSapSchema(SAP_JSON, 'sap-schema.json', SYSTEM_ID);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].type).toBe('lookup');
    expect(result.relationships[0].viaField).toBe('KUNNR');
  });

  it('should set systemId on all entities', () => {
    const result = parseSapSchema(SAP_JSON, 'sap-schema.json', SYSTEM_ID);
    expect(result.entities.every((e) => e.systemId === SYSTEM_ID)).toBe(true);
  });
});

describe('parseSapSchema — OData XML', () => {
  it('should parse entities from XML', () => {
    const result = parseSapSchema(ODATA_XML, 'odata-metadata.xml', SYSTEM_ID);
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
    const names = result.entities.map((e) => e.name);
    expect(names).toContain('Product');
  });

  it('should assign correct data types from Edm types', () => {
    const result = parseSapSchema(ODATA_XML, 'odata-metadata.xml', SYSTEM_ID);
    const productEntity = result.entities.find((e) => e.name === 'Product')!;
    expect(productEntity).toBeDefined();
    const productIdField = result.fields.find((f) => f.entityId === productEntity.id && f.name === 'ProductID');
    expect(productIdField).toBeDefined();
    expect(['integer', 'number', 'id'].includes(productIdField!.dataType)).toBe(true);
  });
});

describe('parseSapSchema — CSV', () => {
  it('should parse entities from CSV', () => {
    const result = parseSapSchema(SAP_CSV, 'fields.csv', SYSTEM_ID);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('BankAccount');
  });

  it('should parse fields with correct names', () => {
    const result = parseSapSchema(SAP_CSV, 'fields.csv', SYSTEM_ID);
    const fieldNames = result.fields.map((f) => f.name);
    expect(fieldNames).toContain('BankAccountId');
    expect(fieldNames).toContain('IBAN');
    expect(fieldNames).toContain('Balance');
  });

  it('should mark the key field correctly', () => {
    const result = parseSapSchema(SAP_CSV, 'fields.csv', SYSTEM_ID);
    const keyField = result.fields.find((f) => f.name === 'BankAccountId');
    expect(keyField?.isKey).toBe(true);
    expect(keyField?.required).toBe(true);
  });
});
