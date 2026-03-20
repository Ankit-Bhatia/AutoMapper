import { renderBenchmarkSummary, runBenchmarkHarness } from './harness.ts';

async function main(): Promise<void> {
  const result = await runBenchmarkHarness();
  console.log(renderBenchmarkSummary(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
