# Schema Intelligence Reference Workflow

The markdown files in this directory are the human-editable source material for the Schema Intelligence corpus:

- `mapping-patterns.md`
- `fsc-data-model.md`
- `domain-glossary.md`

The runtime dataset consumed by the backend still lives in:

- `backend/src/agents/schemaIntelligenceData.ts`

## Update Process

1. Edit one or more markdown reference files in this directory.
2. Run the sync report:
   ```bash
   npm run sync:schema-intelligence
   ```
3. Review the stdout summary and the generated diff file:
   - `backend/data/schema-intelligence/schema-intelligence-diff.json`
4. Manually update `backend/src/agents/schemaIntelligenceData.ts` to reflect the approved changes.
5. Re-run `npm run sync:schema-intelligence` and confirm the diff is reduced to the expected deltas.

## Why the sync step is report-only

The TypeScript corpus is intentionally richer than the markdown tables:

- one XML field can expand into multiple enriched targets
- notes are normalized for agent rationale
- flags like `isFormulaTarget` and `isPersonAccountOnly` are explicit runtime metadata

Because of that, the sync script does **not** overwrite `schemaIntelligenceData.ts`. It parses the markdown into structured JSON, compares it with the current compiled dataset, and produces a review artifact for a human to approve.

## Output Contract

`npm run sync:schema-intelligence` must:

- parse markdown tables from all three reference files
- diff the markdown-derived pattern coverage against `schemaIntelligenceData.ts`
- report added / removed / changed pattern fields
- compare the markdown one-to-many table with `ONE_TO_MANY_FIELDS`
- write a machine-readable JSON diff for review
