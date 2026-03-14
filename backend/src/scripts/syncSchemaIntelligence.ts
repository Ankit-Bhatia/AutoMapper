import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SCHEMA_INTELLIGENCE_DIR,
  buildSchemaIntelligenceSyncReport,
} from '../services/schemaIntelligenceSync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DIFF_OUTPUT = path.resolve(__dirname, '../../data/schema-intelligence/schema-intelligence-diff.json');

function parseArgs(argv: string[]) {
  let directory = DEFAULT_SCHEMA_INTELLIGENCE_DIR;
  let output = DEFAULT_DIFF_OUTPUT;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--dir' || arg === '--directory') && argv[index + 1]) {
      directory = path.resolve(argv[index + 1]!);
      index += 1;
      continue;
    }
    if ((arg === '--out' || arg === '--output') && argv[index + 1]) {
      output = path.resolve(argv[index + 1]!);
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: tsx src/scripts/syncSchemaIntelligence.ts [--directory <path>] [--output <path>]');
      process.exit(0);
    }
  }

  return { directory, output };
}

function logSummary(report: Awaited<ReturnType<typeof buildSchemaIntelligenceSyncReport>>, outputPath: string): void {
  console.log('Schema Intelligence Sync Report');
  console.log(`- Source files: ${report.sourceFiles.join(', ')}`);
  console.log(`- Markdown pattern fields: ${report.summary.markdownPatternFields}`);
  console.log(`- Current TS pattern fields: ${report.summary.currentPatternFields}`);
  console.log(`- Added pattern fields: ${report.summary.addedPatternFields}`);
  console.log(`- Removed pattern fields: ${report.summary.removedPatternFields}`);
  console.log(`- Changed pattern fields: ${report.summary.changedPatternFields}`);
  console.log(`- Added one-to-many fields: ${report.summary.addedOneToManyFields}`);
  console.log(`- Removed one-to-many fields: ${report.summary.removedOneToManyFields}`);
  console.log(`- Diff JSON: ${outputPath}`);

  if (report.diff.patterns.added.length > 0) {
    console.log(`- New markdown pattern fields: ${report.diff.patterns.added.map((entry) => entry.xmlField).join(', ')}`);
  }
  if (report.diff.patterns.removed.length > 0) {
    console.log(`- Pattern fields missing from markdown: ${report.diff.patterns.removed.map((entry) => entry.xmlField).join(', ')}`);
  }
  if (report.diff.patterns.changed.length > 0) {
    console.log(`- Changed fields: ${report.diff.patterns.changed.map((entry) => entry.markdown.xmlField).join(', ')}`);
  }
}

async function main(): Promise<void> {
  const { directory, output } = parseArgs(process.argv.slice(2));
  const report = await buildSchemaIntelligenceSyncReport(directory);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  logSummary(report, output);
}

main().catch((error) => {
  console.error('Failed to sync schema intelligence reference data.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
