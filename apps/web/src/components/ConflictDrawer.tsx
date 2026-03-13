import { useEffect, useMemo, useState } from 'react';
import type { Entity, Field, FieldMapping, MappingConflict } from '@contracts';
import { api } from '@core/api-client';

interface ConflictDrawerProps {
  projectId: string;
  conflicts: MappingConflict[];
  allMappings: FieldMapping[];
  fields: Field[];
  entities: Entity[];
  open: boolean;
  onClose: () => void;
  onResolved: (updatedConflictCount: number) => void;
}

interface ResolveResponse {
  resolved: boolean;
  unresolvedConflicts: number;
}

export function ConflictDrawer({
  projectId,
  conflicts,
  allMappings,
  fields,
  entities,
  open,
  onClose,
  onResolved,
}: ConflictDrawerProps) {
  const [localConflicts, setLocalConflicts] = useState<MappingConflict[]>(conflicts);
  const [pendingConflictId, setPendingConflictId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocalConflicts(conflicts);
  }, [conflicts]);

  const mappingById = useMemo(
    () => new Map(allMappings.map((mapping) => [mapping.id, mapping])),
    [allMappings],
  );
  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const entityById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities]);

  async function resolveConflict(conflict: MappingConflict, body: { action: 'pick' | 'reject-all'; winnerMappingId?: string }) {
    setPendingConflictId(conflict.id);
    setError(null);
    try {
      const data = await api<ResolveResponse>(
        `/api/projects/${projectId}/conflicts/${conflict.id}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
      setLocalConflicts((prev) => prev.filter((item) => item.id !== conflict.id));
      onResolved(data.unresolvedConflicts);
      if (data.unresolvedConflicts === 0) {
        onClose();
      }
    } catch (resolveError) {
      const message = resolveError instanceof Error ? resolveError.message : 'Failed to resolve conflict';
      setError(message);
    } finally {
      setPendingConflictId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="conflict-drawer-overlay" onClick={onClose}>
      <aside
        className={`conflict-drawer ${open ? 'open' : ''}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Mapping conflicts"
      >
        <div className="conflict-drawer-header">
          <span>⚠ Mapping Conflicts ({localConflicts.length} unresolved)</span>
          <button className="btn btn--ghost btn--xs" onClick={onClose}>✕ Close</button>
        </div>

        {error && <p className="conflict-drawer-error">{error}</p>}

        {localConflicts.length === 0 ? (
          <div className="conflict-drawer-empty">No unresolved conflicts.</div>
        ) : (
          localConflicts.map((conflict) => (
            <section key={conflict.id} className="conflict-item">
              <div className="conflict-target-label">
                Target field
              </div>
              <div className="conflict-target-name">
                {conflict.targetEntityName}.{conflict.targetFieldName}
              </div>

              {conflict.competingMappingIds.map((mappingId) => {
                const mapping = mappingById.get(mappingId);
                const sourceField = mapping ? fieldById.get(mapping.sourceFieldId) : undefined;
                const sourceEntity = sourceField ? entityById.get(sourceField.entityId) : undefined;
                const sourceLabel = sourceEntity && sourceField
                  ? `${sourceEntity.name}.${sourceField.name}`
                  : mappingId;
                const disabled = pendingConflictId === conflict.id;

                return (
                  <div key={mappingId} className="conflict-competing-row">
                    <div className="conflict-competing-main">
                      <div className="conflict-competing-field">{sourceLabel}</div>
                      <div className="conflict-competing-meta">
                        transform: {mapping?.transform.type ?? 'direct'}
                      </div>
                    </div>
                    <button
                      className="btn-pick"
                      onClick={() => resolveConflict(conflict, { action: 'pick', winnerMappingId: mappingId })}
                      disabled={disabled}
                    >
                      Pick
                    </button>
                  </div>
                );
              })}

              <div className="conflict-actions">
                <button
                  className="btn-reject-all"
                  onClick={() => resolveConflict(conflict, { action: 'reject-all' })}
                  disabled={pendingConflictId === conflict.id}
                >
                  Reject All
                </button>
              </div>
            </section>
          ))
        )}
      </aside>
    </div>
  );
}
