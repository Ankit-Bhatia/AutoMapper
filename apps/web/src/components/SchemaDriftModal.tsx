import type { SchemaDriftEvent } from '@contracts';

interface SchemaDriftModalProps {
  drift: SchemaDriftEvent;
  onCancel: () => void;
  onProceed: () => void;
}

export function SchemaDriftModal({ drift, onCancel, onProceed }: SchemaDriftModalProps) {
  return (
    <div className="schema-drift-modal-backdrop" role="presentation">
      <section
        className="schema-drift-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schema-drift-title"
      >
        <p className="schema-drift-eyebrow">Schema drift detected</p>
        <h2 id="schema-drift-title">Stored mappings no longer match the latest schema</h2>
        <p className="schema-drift-copy">
          Required fields or types changed since the last approved export. Review these blockers before trusting the current mapping set.
        </p>

        <div className="schema-drift-summary">
          <span>{drift.blockers.length} blockers</span>
          <span>{drift.warnings.length} warnings</span>
          <span>{drift.additions.length} additions</span>
        </div>

        <div className="schema-drift-list" role="list" aria-label="Schema drift blockers">
          {drift.blockers.map((item) => (
            <article key={`${item.scope}-${item.fieldId}-${item.changeType}`} className="schema-drift-item" role="listitem">
              <div className="schema-drift-item-header">
                <strong>{item.fieldName}</strong>
                <span className="schema-drift-badge">{item.scope}</span>
              </div>
              <div className="schema-drift-item-meta">{item.entityName}</div>
              <div className="schema-drift-item-change">
                <span>{item.changeType.replace('_', ' ')}</span>
                <span>{item.previousType ?? 'missing'} → {item.currentType ?? 'missing'}</span>
              </div>
            </article>
          ))}
        </div>

        <div className="schema-drift-actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={onProceed}>
            Proceed anyway
          </button>
        </div>
      </section>
    </div>
  );
}
