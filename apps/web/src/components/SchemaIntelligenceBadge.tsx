import type { SchemaIntelligenceTone } from './schemaIntelligence';

interface SchemaIntelligenceBadgeProps {
  label: string;
  tone: SchemaIntelligenceTone;
  title?: string;
}

function badgeClassForTone(tone: SchemaIntelligenceTone): string {
  switch (tone) {
    case 'success':
      return 'badge--green';
    case 'warning':
      return 'badge--amber';
    case 'danger':
      return 'badge--red';
    case 'info':
      return 'badge--sky';
    default:
      return 'badge--gray';
  }
}

export function SchemaIntelligenceBadge({
  label,
  tone,
  title,
}: SchemaIntelligenceBadgeProps) {
  return (
    <span
      className={`badge ${badgeClassForTone(tone)} schema-intelligence-badge`}
      title={title}
    >
      {label}
    </span>
  );
}
