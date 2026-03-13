import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseWorkbookFieldMappings } from '../services/mappingWorkbookParser.js';

function buildWorkbookBuffer(): Buffer {
  const wb = XLSX.utils.book_new();

  const summary = XLSX.utils.aoa_to_sheet([
    ['Summary'],
    ['this sheet should be ignored'],
  ]);
  XLSX.utils.book_append_sheet(wb, summary, 'Total Fields Counts');

  const mappings = XLSX.utils.aoa_to_sheet([
    ['', 'Salesforce Schema', '', '', '', 'Nanda'],
    ['XML Element', 'Object Name', 'Field Labels', 'API Name', 'Data Type', 'XML '],
    ['<AMT_LOAN>50000</AMT_LOAN>', 'Loan (Loan__c)', 'Loan Amount', 'Amount__c', 'currency', 'AMT_LOAN'],
    ['PHONE_FAX', 'Account', 'Account Fax', 'Fax', 'phone', 'PHONE_FAX'],
    ['Not in the XML File', 'Loan (Loan__c)', 'Skipped', 'ShouldSkip__c', 'string', ''],
  ]);
  XLSX.utils.book_append_sheet(wb, mappings, 'Loans');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseWorkbookFieldMappings', () => {
  it('extracts source and target fields from BOSL-style mapping sheets', () => {
    const parsed = parseWorkbookFieldMappings(buildWorkbookBuffer());

    expect(parsed).toEqual([
      {
        sheetName: 'Loans',
        rowNumber: 3,
        sourceFieldName: 'AMT_LOAN',
        targetEntityHint: 'Loan__c',
        targetFieldName: 'Amount__c',
      },
      {
        sheetName: 'Loans',
        rowNumber: 4,
        sourceFieldName: 'PHONE_FAX',
        targetEntityHint: 'Account',
        targetFieldName: 'Fax',
      },
    ]);
  });
});
