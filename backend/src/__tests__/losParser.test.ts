import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseUploadedSchema } from '../services/schemaUploadParser.js';

const SYSTEM_ID = 'sys-los-test';
const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/los-riskclam.xml', import.meta.url));
const USER_FIXTURE_PATH = fileURLToPath(new URL('./fixtures/los-riskclam-user.xml', import.meta.url));

describe('LOS XML schema upload parsing', () => {
  it('extracts nested LOS sections as entities and infers LOS datatypes from prefixes', () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf8');
    const parsed = parseUploadedSchema(xml, 'LOS Riskclam.xml', SYSTEM_ID);

    expect(parsed.entities.length).toBeGreaterThanOrEqual(10);

    const entityNames = new Set(parsed.entities.map((e) => e.name));
    expect(entityNames.has('LOAN')).toBe(true);
    expect(entityNames.has('BORROWER')).toBe(true);
    expect(entityNames.has('COLLATERAL')).toBe(true);

    const loan = parsed.entities.find((e) => e.name === 'LOAN');
    expect(loan).toBeDefined();
    const loanFields = parsed.fields.filter((f) => f.entityId === loan!.id);
    expect(loanFields.length).toBeGreaterThanOrEqual(80);

    const borrower = parsed.entities.find((e) => e.name === 'BORROWER');
    expect(borrower).toBeDefined();
    const borrowerFields = parsed.fields.filter((f) => f.entityId === borrower!.id);
    const borrowerFieldNames = new Set(borrowerFields.map((f) => f.name));
    expect(borrowerFieldNames.has('NAME_FIRST')).toBe(true);
    expect(borrowerFieldNames.has('NAME_LAST')).toBe(true);
    expect(borrowerFieldNames.has('SSN')).toBe(true);

    const amountField = parsed.fields.find((f) => f.name === 'AMT_APPROVED_LOAN');
    expect(amountField).toBeDefined();
    expect(amountField!.dataType).toBe('decimal');

    expect(parsed.fields.length).toBeGreaterThanOrEqual(150);
  });

  it('parses LOS XML with XML declaration and surfaces all major sections', () => {
    const xml = readFileSync(USER_FIXTURE_PATH, 'utf8');
    const parsed = parseUploadedSchema(xml, 'LOS Riskclam.xml', SYSTEM_ID);

    expect(parsed.entities.length).toBeGreaterThanOrEqual(8);
    expect(parsed.entities.some((entity) => entity.name === 'LOAN')).toBe(true);
    expect(parsed.entities.some((entity) => entity.name === 'BORROWER')).toBe(true);
    expect(parsed.entities.some((entity) => entity.name === 'DEBTS')).toBe(true);
    expect(parsed.entities.some((entity) => entity.name === 'PRODUCT')).toBe(true);
    expect(parsed.entities.some((entity) => entity.name === 'SIGNER')).toBe(true);

    const loan = parsed.entities.find((entity) => entity.name === 'LOAN');
    expect(loan).toBeDefined();
    const loanFields = parsed.fields.filter((field) => field.entityId === loan!.id);
    expect(loanFields.length).toBeGreaterThanOrEqual(80);

    expect(parsed.fields.length).toBeGreaterThanOrEqual(150);
  });
});
