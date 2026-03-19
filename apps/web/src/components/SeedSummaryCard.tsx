import type { SeedSummary } from '@contracts';

interface SeedSummaryCardProps {
  summary: SeedSummary;
  onContinue: () => void;
}

export function SeedSummaryCard({ summary, onContinue }: SeedSummaryCardProps) {
  return (
    <div className="seed-summary-card">
      <div className="page-header seed-summary-header">
        <div>
          <h1 className="page-title">Schema Discovery Results</h1>
          <p className="page-subtitle">
            AutoMapper parsed both schemas and seeded the first pass of mapping suggestions.
          </p>
        </div>
      </div>

      <div className="seed-summary-row seed-summary-row--derived">
        <span className="seed-summary-icon">✓</span>
        <div>
          <div className="seed-summary-count">{summary.fromDerived} mappings pre-confirmed</div>
          <div className="seed-summary-note">from previous migration history</div>
        </div>
      </div>

      <div className="seed-summary-row seed-summary-row--canonical">
        <span className="seed-summary-icon">✓</span>
        <div className="seed-summary-count">{summary.fromCanonical} mapped via canonical layer</div>
      </div>

      <div className="seed-summary-row seed-summary-row--agent">
        <span className="seed-summary-icon">◎</span>
        <div className="seed-summary-count">{summary.fromAgent} need AI review</div>
      </div>

      <div className="seed-summary-footer">
        <div className="seed-summary-total">{summary.total} total seeded mappings</div>
        <button type="button" className="btn btn--primary" onClick={onContinue}>Continue</button>
      </div>
    </div>
  );
}
