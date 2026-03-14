import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEMA_INTELLIGENCE_DIR,
  buildCurrentPatternFieldSummaries,
  buildMarkdownPatternFieldSummaries,
  buildSchemaIntelligenceSyncReport,
  diffPatternFieldSummaries,
  extractMarkdownOneToManyFields,
  parseMarkdownTables,
} from '../services/schemaIntelligenceSync.js';

describe('schema intelligence sync utilities', () => {
  it('identifies added, removed, and changed pattern fields', () => {
    const markdown = `
## Amount Mappings
### Direct Matches (High Confidence)
| XML Field | SF API Name | SF Object | Notes |
|---|---|---|---|
| AMT_PAYMENT | FinServ__PaymentAmount__c | Financial Account | Preferred live-account payment field |
| AMT_NEW_FIELD | New_Field__c | Loan | Newly documented field |

## One-to-Many Patterns (Critical — Always Flag)
| XML Field | # SF Targets | Objects | Routing Logic |
|---|---|---|---|
| AMT_PAYMENT | 2 | Financial Account, Loan | Route by lifecycle |
`;

    const markdownTables = parseMarkdownTables(markdown, 'mapping-patterns.md');
    const markdownPatterns = buildMarkdownPatternFieldSummaries(markdownTables);
    const currentPatterns = buildCurrentPatternFieldSummaries({
      amtpayment: [{
        xmlField: 'AMT_PAYMENT',
        sfApiNames: ['Monthly_Payment__c'],
        sfObject: 'Loan',
        confidence: 'MEDIUM',
        notes: 'Older pre-boarding target only',
        isOneToMany: false,
        isFormulaTarget: false,
        isPersonAccountOnly: false,
      }],
      dateremoved: [{
        xmlField: 'DATE_REMOVED',
        sfApiNames: ['Legacy_Date__c'],
        sfObject: 'Loan',
        confidence: 'HIGH',
        notes: 'Legacy field',
        isOneToMany: false,
        isFormulaTarget: false,
        isPersonAccountOnly: false,
      }],
    });

    const diff = diffPatternFieldSummaries(markdownPatterns, currentPatterns);

    expect(diff.added.map((entry) => entry.normalizedField)).toEqual(['amtnewfield']);
    expect(diff.removed.map((entry) => entry.normalizedField)).toEqual(['dateremoved']);
    expect(diff.changed.map((entry) => entry.normalizedField)).toEqual(['amtpayment']);

    const oneToMany = extractMarkdownOneToManyFields(markdownTables);
    expect(oneToMany).toEqual(['amtpayment']);
  });

  it('builds a sync report from the checked-in markdown corpus', async () => {
    const report = await buildSchemaIntelligenceSyncReport(DEFAULT_SCHEMA_INTELLIGENCE_DIR);

    expect(report.sourceFiles).toEqual([
      'mapping-patterns.md',
      'fsc-data-model.md',
      'domain-glossary.md',
    ]);
    expect(report.parsedTables.length).toBeGreaterThan(0);
    expect(report.summary.markdownPatternFields).toBeGreaterThan(0);
    expect(report.diff.constants.personAccountFieldSuffix.markdown).toBe('__pc');
    expect(report.diff.constants.fscNamespacePrefix.markdown).toBe('FinServ__');
    expect(report.diff.oneToManyFields.added).toBeInstanceOf(Array);
  });
});
