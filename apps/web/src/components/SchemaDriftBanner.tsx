import { useState } from 'react';
import type { SchemaDriftEvent } from '@contracts';

interface SchemaDriftBannerProps {
  drift: SchemaDriftEvent;
  onDismiss: () => void;
}

export function SchemaDriftBanner({ drift, onDismiss }: SchemaDriftBannerProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="schema-drift-banner" aria-live="polite">
      <div className="schema-drift-banner-header">
        <div>
          <p className="schema-drift-banner-eyebrow">Schema drift warning</p>
          <h3>{drift.warnings.length} warning{drift.warnings.length === 1 ? '' : 's'} detected since the last export</h3>
        </div>
        <div className="schema-drift-banner-actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>

      {expanded && (
        <div className="schema-drift-banner-list" role="list" aria-label="Schema drift warnings">
          {drift.warnings.map((item) => (
            <article key={`${item.scope}-${item.fieldId}-${item.changeType}`} className="schema-drift-banner-item" role="listitem">
              <strong>{item.fieldName}</strong>
              <span>{item.entityName}</span>
              <span>{item.changeType.replace('_', ' ')}</span>
              <span>{item.previousType ?? 'missing'} → {item.currentType ?? 'missing'}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
