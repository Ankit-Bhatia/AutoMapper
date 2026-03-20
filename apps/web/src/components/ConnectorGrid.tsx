import React, { useEffect, useState } from 'react';
import { ConnectorDefinition } from '@contracts';
import { api } from '@core/api-client';

// Static connector catalogue (matches demo-server.mjs + production connectors)
const BUILTIN_CONNECTORS: ConnectorDefinition[] = [
  {
    id: 'jackhenry-silverlake',
    name: 'SilverLake',
    vendor: 'Jack Henry',
    category: 'core-banking',
    description: 'Commercial banking core — CIF, DDA, Loans with full jXchange XPath and ISO 20022 support.',
    logoClass: 'logo-jh-sl',
    entities: ['CIF', 'DDA', 'LoanAccount', 'GLAccount'],
  },
  {
    id: 'jackhenry-coredirector',
    name: 'Core Director',
    vendor: 'Jack Henry',
    category: 'core-banking',
    description: 'Community banking core — numeric AcctType codes, Indv/Bus CustomerType short codes.',
    logoClass: 'logo-jh-cd',
    entities: ['CIF', 'DDA', 'LoanAccount', 'GLAccount'],
  },
  {
    id: 'jackhenry-symitar',
    name: 'Symitar / Episys',
    vendor: 'Jack Henry',
    category: 'credit-union',
    description: 'Credit union core — Member, Share, Loan, Card with PCI-DSS compliance tags.',
    logoClass: 'logo-jh-sym',
    entities: ['Member', 'Share', 'Loan', 'Card'],
  },
  {
    id: 'salesforce',
    name: 'Salesforce CRM',
    vendor: 'Salesforce',
    category: 'crm',
    description: 'Account, Contact, Opportunity objects via Salesforce Metadata API.',
    logoClass: 'logo-sf',
    entities: ['Account', 'Contact', 'Opportunity'],
  },
  {
    id: 'sap',
    name: 'SAP S/4HANA',
    vendor: 'SAP',
    category: 'erp',
    description: 'BusinessPartner and GLAccount entities via OData Metadata and IDOC parsing.',
    logoClass: 'logo-sap',
    entities: ['BusinessPartner', 'GLAccount'],
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  'core-banking': 'Core Banking',
  'credit-union': 'Credit Union',
  crm: 'CRM',
  erp: 'ERP',
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const REDACTED_CONNECTION_KEYS = new Set([
  'bearerToken',
  'clientSecret',
  'password',
  'basicPassword',
  'apiKey',
  'basicUsername',
]);

type AddConnectorTab = 'rest' | 'file';
type RestAuthType = 'none' | 'bearer' | 'basic';

interface CustomConnectorField {
  name: string;
  dataType: string;
}

interface CustomConnectorEntity {
  name: string;
  fields: CustomConnectorField[];
}

interface CustomConnectorPayload {
  name: string;
  vendor: string;
  category: ConnectorDefinition['category'];
  description: string;
  entities: Array<{ name: string; fields: CustomConnectorField[] }>;
  connectionConfig: Record<string, unknown>;
}

interface CustomConnectorResponse {
  id: string;
  deduped?: boolean;
  connector?: {
    id?: string;
    displayName?: string;
    name?: string;
    vendor?: string;
    category?: string;
    description?: string;
    entities?: string[];
  };
}

interface CustomConnectorDeleteResponse {
  ok?: boolean;
  deletedIds?: string[];
  deletedCount?: number;
}

function normalizeCategory(input: string): ConnectorDefinition['category'] {
  if (input === 'core-banking' || input === 'credit-union' || input === 'crm' || input === 'erp') {
    return input;
  }
  if (input === 'banking') return 'core-banking';
  if (input === 'generic') return 'crm';
  return 'crm';
}

function sanitizeConnectionConfig(connectionConfig: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(connectionConfig).filter(([key]) => !REDACTED_CONNECTION_KEYS.has(key)),
  );
}

function normalizeConnectorText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeConnectorNameKey(value: string | undefined): string {
  return normalizeConnectorText(value).replace(/[^a-z0-9]+/g, '');
}

function connectorFamilyKey(connector: ConnectorDefinition): string {
  return JSON.stringify({
    name: normalizeConnectorNameKey(connector.name),
    vendor: normalizeConnectorText(connector.vendor),
    category: normalizeConnectorText(connector.category),
  });
}

function dedupeConnectorDefinitions(connectors: ConnectorDefinition[]): ConnectorDefinition[] {
  const byFamily = new Map<string, ConnectorDefinition>();
  for (const connector of connectors) {
    byFamily.set(connectorFamilyKey(connector), connector);
  }
  return Array.from(byFamily.values())
    .sort((left, right) => left.name.localeCompare(right.name));
}

function inferDataType(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'decimal';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  return 'string';
}

function parseCsvEntities(text: string): CustomConnectorEntity[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0]
    .split(',')
    .map((header) => header.trim())
    .filter(Boolean);
  if (!headers.length) return [];
  return [
    {
      name: 'UploadedEntity',
      fields: headers.map((name) => ({ name, dataType: 'string' })),
    },
  ];
}

function parseJsonEntities(text: string): CustomConnectorEntity[] {
  const parsed = JSON.parse(text) as unknown;

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const maybeEntities = (parsed as { entities?: unknown }).entities;
    if (Array.isArray(maybeEntities)) {
      return maybeEntities
        .map((entity): CustomConnectorEntity | null => {
          if (!entity || typeof entity !== 'object') return null;
          const typedEntity = entity as { name?: unknown; fields?: unknown };
          if (typeof typedEntity.name !== 'string') return null;
          const fields = Array.isArray(typedEntity.fields)
            ? typedEntity.fields
                .map((field): CustomConnectorField | null => {
                  if (!field || typeof field !== 'object') return null;
                  const typedField = field as { name?: unknown; dataType?: unknown; type?: unknown };
                  if (typeof typedField.name !== 'string') return null;
                  const dataType = typeof typedField.dataType === 'string'
                    ? typedField.dataType
                    : typeof typedField.type === 'string'
                      ? typedField.type
                      : 'string';
                  return { name: typedField.name, dataType };
                })
                .filter((field): field is CustomConnectorField => Boolean(field))
            : [];
          if (!fields.length) return null;
          return { name: typedEntity.name, fields };
        })
        .filter((entity): entity is CustomConnectorEntity => Boolean(entity));
    }
  }

  const row = Array.isArray(parsed)
    ? parsed.find((item) => item && typeof item === 'object')
    : parsed && typeof parsed === 'object'
      ? parsed
      : null;

  if (!row || typeof row !== 'object') return [];

  const fields = Object.entries(row as Record<string, unknown>).map(([name, value]) => ({
    name,
    dataType: inferDataType(value),
  }));

  return fields.length
    ? [{ name: Array.isArray(parsed) ? 'UploadedEntity' : 'UploadedObject', fields }]
    : [];
}

function parseXmlEntities(text: string): CustomConnectorEntity[] {
  if (typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Invalid XML schema file');
  }

  const root = doc.documentElement;
  const entityFieldMap = new Map<string, Set<string>>();

  const normalizeNodeName = (nodeName: string): string => {
    const trimmed = nodeName.trim();
    if (!trimmed) return '';
    const noNamespace = trimmed.includes(':') ? trimmed.split(':').pop() ?? trimmed : trimmed;
    return noNamespace.trim();
  };

  const ensureEntityFields = (name: string): Set<string> => {
    const existing = entityFieldMap.get(name);
    if (existing) return existing;
    const created = new Set<string>();
    entityFieldMap.set(name, created);
    return created;
  };

  const walk = (node: Element) => {
    const entityName = normalizeNodeName(node.nodeName);
    const children = Array.from(node.children);
    if (!entityName || children.length === 0) return;

    const fields = ensureEntityFields(entityName);

    for (const child of children) {
      const childName = normalizeNodeName(child.nodeName);
      if (!childName) continue;
      const grandChildren = Array.from(child.children);

      if (grandChildren.length === 0) {
        fields.add(childName);
      } else {
        walk(child);
      }
    }
  };

  walk(root);

  return Array.from(entityFieldMap.entries())
    .filter(([, fields]) => fields.size > 0)
    .map(([name, fields]) => ({
      name,
      fields: Array.from(fields).map((fieldName) => ({ name: fieldName, dataType: 'string' })),
    }));
}

interface ConnectorGridProps {
  onProceed: (
    sourceId: string,
    targetId: string,
    options?: { projectName?: string; sourceFile?: File | null; targetFile?: File | null },
  ) => void;
  loading?: boolean;
}

interface ConnectorListResponse {
  connectors?: Array<{
    id?: string;
    name?: string;
    displayName?: string;
    vendor?: string;
    category?: string;
    description?: string;
    entities?: unknown;
  }>;
}

export function ConnectorGrid({ onProceed, loading = false }: ConnectorGridProps) {
  const standaloneMode = import.meta.env.VITE_STANDALONE === 'true';
  const [connectors, setConnectors] = useState<ConnectorDefinition[]>(BUILTIN_CONNECTORS);
  const [source, setSource] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [sapClientId, setSapClientId] = useState('');
  const [sapClientSecret, setSapClientSecret] = useState('');
  const [sapTokenUrl, setSapTokenUrl] = useState('');
  const [sapOAuthConnected, setSapOAuthConnected] = useState(false);
  const [sapOAuthLoading, setSapOAuthLoading] = useState(false);
  const [sapOAuthError, setSapOAuthError] = useState<string | null>(null);
  const [sapOAuthExpiresIn, setSapOAuthExpiresIn] = useState<number | null>(null);
  const [draggingConnectorId, setDraggingConnectorId] = useState<string | null>(null);
  const [dragOverRole, setDragOverRole] = useState<'source' | 'target' | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addVendor, setAddVendor] = useState('Custom');
  const [addCategory, setAddCategory] = useState<ConnectorDefinition['category']>('crm');
  const [addDescription, setAddDescription] = useState('');
  const [addTab, setAddTab] = useState<AddConnectorTab>('rest');
  const [addRestUrl, setAddRestUrl] = useState('');
  const [addRestAuth, setAddRestAuth] = useState<RestAuthType>('none');
  const [addBearerToken, setAddBearerToken] = useState('');
  const [addBasicUser, setAddBasicUser] = useState('');
  const [addBasicPassword, setAddBasicPassword] = useState('');
  const [addEntityNames, setAddEntityNames] = useState('');
  const [addEntities, setAddEntities] = useState<CustomConnectorEntity[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [selectedCustomConnectorIds, setSelectedCustomConnectorIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    if (standaloneMode) return () => {
      cancelled = true;
    };

    const loadSavedConnectors = async () => {
      try {
        const response = await api<ConnectorListResponse>('/api/connectors');
        if (cancelled) return;
        const remote = Array.isArray(response.connectors) ? response.connectors : [];
        const builtinIds = new Set(BUILTIN_CONNECTORS.map((connector) => connector.id));
        const custom = remote
          .filter((connector) => typeof connector.id === 'string' && !builtinIds.has(connector.id))
          .map((connector) => ({
            id: connector.id as string,
            name: connector.name ?? connector.displayName ?? connector.id ?? 'Custom Connector',
            vendor: connector.vendor ?? 'Custom',
            category: normalizeCategory(connector.category ?? 'crm'),
            description: connector.description ?? 'Custom connector',
            logoClass: 'logo-custom',
            entities: Array.isArray(connector.entities)
              ? (connector.entities.filter((entity): entity is string => typeof entity === 'string').slice(0, 8))
              : [],
          }));
        setConnectors([...BUILTIN_CONNECTORS, ...dedupeConnectorDefinitions(custom)]);
      } catch {
        // Keep builtin connectors if discovery API is temporarily unavailable.
      }
    };

    void loadSavedConnectors();
    return () => {
      cancelled = true;
    };
  }, [standaloneMode]);

  function assignConnectorRole(id: string, role: 'source' | 'target') {
    if (role === 'source') {
      setSource(id);
      setTarget((prev) => (prev === id ? null : prev));
      return;
    }
    setTarget(id);
    setSource((prev) => (prev === id ? null : prev));
  }

  function handleCardClick(id: string) {
    if (source === id) {
      // Deselect source
      setSource(null);
      return;
    }
    if (target === id) {
      // Deselect target
      setTarget(null);
      return;
    }
    if (!source) {
      setSource(id);
      return;
    }
    if (!target) {
      setTarget(id);
      return;
    }
    // Both selected — replace source, clear target
    setSource(id);
    setTarget(null);
  }

  function getCardRole(id: string): 'source' | 'target' | null {
    if (source === id) return 'source';
    if (target === id) return 'target';
    return null;
  }

  const canProceed = !!(source && target) && !loading;
  const sapSelected = source === 'sap' || target === 'sap';
  const canConnectSapOAuth =
    standaloneMode || (!!sapClientId.trim() && !!sapClientSecret.trim() && !!sapTokenUrl.trim());

  function handleProceed() {
    if (canProceed) {
      onProceed(source!, target!, {
        projectName: projectName.trim() || undefined,
        sourceFile,
        targetFile,
      });
    }
  }

  async function handleConnectSapOAuth() {
    if (!canConnectSapOAuth || sapOAuthLoading) return;

    setSapOAuthLoading(true);
    setSapOAuthError(null);

    if (standaloneMode) {
      setSapOAuthConnected(true);
      setSapOAuthExpiresIn(3600);
      setSapOAuthLoading(false);
      return;
    }

    try {
      const response = await api<{ connected?: boolean; expiresIn?: number | null }>(
        '/api/oauth/sap/connect',
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: sapClientId.trim(),
            clientSecret: sapClientSecret,
            tokenUrl: sapTokenUrl.trim(),
          }),
        },
      );

      setSapOAuthConnected(Boolean(response.connected));
      setSapOAuthExpiresIn(typeof response.expiresIn === 'number' ? response.expiresIn : null);
    } catch (error) {
      setSapOAuthConnected(false);
      setSapOAuthExpiresIn(null);
      setSapOAuthError(error instanceof Error ? error.message : 'SAP OAuth connection failed');
    } finally {
      setSapOAuthLoading(false);
    }
  }

  async function handleDisconnectSapOAuth() {
    if (sapOAuthLoading) return;

    setSapOAuthLoading(true);
    setSapOAuthError(null);

    if (!standaloneMode) {
      try {
        await api('/api/oauth/sap/disconnect', { method: 'POST' });
      } catch (error) {
        setSapOAuthError(error instanceof Error ? error.message : 'SAP OAuth disconnect failed');
      }
    }

    setSapOAuthConnected(false);
    setSapOAuthExpiresIn(null);
    setSapOAuthLoading(false);
  }

  function handleDragStart(id: string, e: React.DragEvent<HTMLButtonElement>) {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingConnectorId(id);
  }

  function handleDragEnd() {
    setDraggingConnectorId(null);
    setDragOverRole(null);
  }

  function handleDrop(role: 'source' | 'target', e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || draggingConnectorId;
    if (!id) return;
    assignConnectorRole(id, role);
    setDraggingConnectorId(null);
    setDragOverRole(null);
  }

  function handleDragOver(role: 'source' | 'target', e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverRole !== role) setDragOverRole(role);
  }

  function handleDragLeave() {
    setDragOverRole(null);
  }

  function resetAddConnectorForm() {
    setAddName('');
    setAddVendor('Custom');
    setAddCategory('crm');
    setAddDescription('');
    setAddTab('rest');
    setAddRestUrl('');
    setAddRestAuth('none');
    setAddBearerToken('');
    setAddBasicUser('');
    setAddBasicPassword('');
    setAddEntityNames('');
    setAddEntities([]);
    setAddError(null);
  }

  function isCustomConnector(connectorId: string): boolean {
    return connectorId.startsWith('custom-');
  }

  function applyDeletedConnectorIds(ids: string[]) {
    if (!ids.length) return;
    const deletedIdSet = new Set(ids);
    setConnectors((prev) => prev.filter((connector) => !deletedIdSet.has(connector.id)));
    setSelectedCustomConnectorIds((prev) => {
      const next = new Set([...prev].filter((id) => !deletedIdSet.has(id)));
      return next;
    });
    setSource((prev) => (prev && deletedIdSet.has(prev) ? null : prev));
    setTarget((prev) => (prev && deletedIdSet.has(prev) ? null : prev));
  }

  async function deleteCustomConnector(connectorId: string) {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const response = await api<CustomConnectorDeleteResponse>(`/api/connectors/custom/${connectorId}`, {
        method: 'DELETE',
      });
      applyDeletedConnectorIds(response.deletedIds ?? [connectorId]);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete custom connector');
    } finally {
      setDeleteBusy(false);
    }
  }

  async function bulkDeleteCustomConnectors() {
    if (deleteBusy || selectedCustomConnectorIds.size === 0) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const response = await api<CustomConnectorDeleteResponse>('/api/connectors/custom/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: [...selectedCustomConnectorIds] }),
      });
      applyDeletedConnectorIds(response.deletedIds ?? [...selectedCustomConnectorIds]);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete selected custom connectors');
    } finally {
      setDeleteBusy(false);
    }
  }

  function closeAddConnectorModal() {
    if (addSaving) return;
    setShowAddModal(false);
    resetAddConnectorForm();
  }

  async function handleModalFileUpload(file: File | null) {
    setAddError(null);

    if (!file) {
      setAddEntities([]);
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setAddError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`);
      return;
    }

    try {
      const text = await file.text();
      const lowerName = file.name.toLowerCase();
      let entities: CustomConnectorEntity[] = [];

      if (lowerName.endsWith('.json')) {
        entities = parseJsonEntities(text);
      } else if (lowerName.endsWith('.csv')) {
        entities = parseCsvEntities(text);
      } else if (lowerName.endsWith('.xml')) {
        entities = parseXmlEntities(text);
      } else {
        setAddError('Unsupported file type. Allowed: .csv, .json, .xml');
        return;
      }

      if (!entities.length) {
        setAddError('No schema entities found in the uploaded file.');
        return;
      }

      setAddEntities(entities);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : 'Failed to parse schema file');
    }
  }

  async function saveCustomConnector() {
    if (addSaving) return;

    const trimmedName = addName.trim();
    const fallbackEntities = addEntityNames
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({
        name,
        fields: [{ name: 'id', dataType: 'string' }],
      }));
    const resolvedEntities = addEntities.length ? addEntities : fallbackEntities;

    if (!trimmedName) {
      setAddError('Connector name is required');
      return;
    }
    if (!resolvedEntities.length) {
      setAddError('Add at least one entity before saving');
      return;
    }
    if (addTab === 'rest' && !addRestUrl.trim()) {
      setAddError('REST base URL is required');
      return;
    }

    setAddSaving(true);
    setAddError(null);

    const payload: CustomConnectorPayload = {
      name: trimmedName,
      vendor: addVendor.trim() || 'Custom',
      category: addCategory,
      description: addDescription.trim() || 'Custom connector',
      entities: resolvedEntities.map((entity) => ({
        name: entity.name,
        fields: entity.fields,
      })),
      connectionConfig: addTab === 'rest'
        ? sanitizeConnectionConfig({
            baseUrl: addRestUrl.trim(),
            auth: addRestAuth,
            bearerToken: addBearerToken,
            basicUsername: addBasicUser.trim(),
            basicPassword: addBasicPassword,
          })
        : {},
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    try {
      const result = await api<CustomConnectorResponse>('/api/connectors/custom', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const customId = result.id || result.connector?.id;
      if (!customId) {
        throw new Error('Custom connector response did not include an id');
      }

      const connector: ConnectorDefinition = {
        id: customId,
        name: result.connector?.name ?? result.connector?.displayName ?? trimmedName,
        vendor: result.connector?.vendor ?? (addVendor.trim() || 'Custom'),
        category: normalizeCategory(result.connector?.category ?? addCategory),
        description: result.connector?.description ?? (addDescription.trim() || 'Custom connector'),
        logoClass: 'logo-custom',
        entities:
          (Array.isArray(result.connector?.entities) && result.connector.entities.length
            ? result.connector.entities
            : resolvedEntities.map((entity) => entity.name)).slice(0, 8),
      };

      setDeleteError(null);
      setConnectors((prev) => [...prev.filter((item) => item.id !== connector.id), connector]);
      setShowAddModal(false);
      resetAddConnectorForm();
    } catch (error: unknown) {
      if (
        (error instanceof DOMException && error.name === 'AbortError')
        || (error instanceof Error && /abort/i.test(error.message))
      ) {
        setAddError('Connection timed out after 15s — is the server running?');
      } else {
        setAddError(error instanceof Error ? error.message : 'Failed to save custom connector');
      }
    } finally {
      clearTimeout(timeoutId);
      setAddSaving(false);
    }
  }

  return (
    <div className="connector-grid-page">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Connect Systems</h1>
          <p className="page-subtitle">
            Select a <strong>source</strong> system, then a <strong>target</strong> system. AutoMapper will discover
            their schemas and build a mapping spec.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary connector-add-btn"
          onClick={() => {
            setAddError(null);
            setShowAddModal(true);
          }}
        >
          Add custom connector
        </button>
      </div>

      {connectors.some((connector) => isCustomConnector(connector.id)) && (
        <section className="custom-connector-manager">
          <div className="custom-connector-manager-header">
            <div>
              <h2 className="custom-connector-manager-title">Manage custom connectors</h2>
              <p className="custom-connector-manager-subtitle">
                Delete stale connectors permanently. Bulk delete removes the selected connector families from persistent storage.
              </p>
            </div>
            <div className="custom-connector-manager-actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setSelectedCustomConnectorIds(new Set())}
                disabled={deleteBusy || selectedCustomConnectorIds.size === 0}
              >
                Clear selection
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => { void bulkDeleteCustomConnectors(); }}
                disabled={deleteBusy || selectedCustomConnectorIds.size === 0}
              >
                {deleteBusy ? 'Deleting…' : `Delete selected (${selectedCustomConnectorIds.size})`}
              </button>
            </div>
          </div>

          <div className="custom-connector-list" role="list" aria-label="Custom connectors">
            {connectors
              .filter((connector) => isCustomConnector(connector.id))
              .map((connector) => {
                const checked = selectedCustomConnectorIds.has(connector.id);
                return (
                  <div key={connector.id} className="custom-connector-row" role="listitem">
                    <label className="custom-connector-select">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setSelectedCustomConnectorIds((prev) => {
                            const next = new Set(prev);
                            if (event.target.checked) next.add(connector.id);
                            else next.delete(connector.id);
                            return next;
                          });
                        }}
                        aria-label={`Select custom connector ${connector.name}`}
                      />
                      <span className="custom-connector-name">{connector.name}</span>
                    </label>
                    <div className="custom-connector-meta">
                      <span>{connector.vendor}</span>
                      <span>{CATEGORY_LABELS[connector.category] ?? connector.category}</span>
                      <span>{connector.entities.length} entities</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => { void deleteCustomConnector(connector.id); }}
                      disabled={deleteBusy}
                      aria-label={`Delete ${connector.name}`}
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
          </div>

          {deleteError && (
            <p className="connector-modal-error" role="alert">
              {deleteError}
            </p>
          )}
        </section>
      )}

      {/* Selection legend */}
      <div className="connector-legend">
        <div
          className={`legend-pill legend-pill--source ${source ? 'legend-pill--set' : ''} ${dragOverRole === 'source' ? 'legend-pill--dragover' : ''}`}
          onDrop={(e) => handleDrop('source', e)}
          onDragOver={(e) => handleDragOver('source', e)}
          onDragLeave={handleDragLeave}
          aria-label="Source drop zone"
        >
          <span className="legend-dot legend-dot--source" />
          {source
            ? connectors.find((c) => c.id === source)?.name ?? source
            : 'Select source (click first or drag here)'}
        </div>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 8h10M9 4l4 4-4 4" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div
          className={`legend-pill legend-pill--target ${target ? 'legend-pill--set' : ''} ${dragOverRole === 'target' ? 'legend-pill--dragover' : ''}`}
          onDrop={(e) => handleDrop('target', e)}
          onDragOver={(e) => handleDragOver('target', e)}
          onDragLeave={handleDragLeave}
          aria-label="Target drop zone"
        >
          <span className="legend-dot legend-dot--target" />
          {target
            ? connectors.find((c) => c.id === target)?.name ?? target
            : 'Select target (click second or drag here)'}
        </div>
      </div>

      {/* Connector cards grid */}
      <div className="connector-grid">
        {connectors.map((c) => {
          const role = getCardRole(c.id);
          const protoBadgeClass = ({
            'core-banking': 'badge--sky',
            'credit-union': 'badge--sky',
            crm: 'badge--purple',
            erp: 'badge--green',
            custom: 'badge--amber',
          } as Record<string, string>)[c.category] ?? 'badge--gray';
          return (
            <button
              key={c.id}
              className={`connector-card ${role === 'source' ? 'sel-source is-selected-source' : ''} ${role === 'target' ? 'sel-target is-selected-target' : ''} ${draggingConnectorId === c.id ? 'is-dragging' : ''}`}
              data-category={c.category}
              onClick={() => handleCardClick(c.id)}
              onDragStart={(e) => handleDragStart(c.id, e)}
              onDragEnd={handleDragEnd}
              draggable
              type="button"
            >
              {/* Selection badge */}
              {role && (
                <span className={`connector-role-badge ${role === 'source' ? 'badge-source' : 'badge-target'}`}>
                  {role === 'source' ? 'Source' : 'Target'}
                </span>
              )}

              {/* Logo */}
              <div className={`connector-logo ${c.logoClass}`}>
                {c.vendor === 'Jack Henry' && 'JH'}
                {c.vendor === 'Salesforce' && 'SF'}
                {c.vendor === 'SAP' && 'SAP'}
                {c.vendor !== 'Jack Henry' && c.vendor !== 'Salesforce' && c.vendor !== 'SAP' && 'C'}
              </div>

              {/* Info */}
              <div className="connector-card-body">
                <div className="connector-card-header">
                  <span className="connector-name">{c.name}</span>
                  <span className={`badge ${protoBadgeClass} connector-category`}>
                    {CATEGORY_LABELS[c.category] ?? c.category}
                  </span>
                </div>
                <p className="connector-vendor">{c.vendor}</p>
                <p className="connector-description">{c.description}</p>
                <div className="connector-entities">
                  {c.entities.map((e) => (
                    <span key={e} className="connector-entity-tag">{e}</span>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {showAddModal && (
        <div className="connector-modal-backdrop" role="presentation" onClick={closeAddConnectorModal}>
          <div
            className="connector-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Add custom connector"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="connector-modal-header">
              <h2>Add Custom Connector</h2>
              <button type="button" className="btn btn--ghost" onClick={closeAddConnectorModal} disabled={addSaving}>
                Close
              </button>
            </div>

            <div className="connector-modal-body">
              <div className="connector-modal-grid">
                <label className="connector-upload-field">
                  <span className="form-label">Connector name</span>
                  <input
                    className="form-input"
                    type="text"
                    value={addName}
                    onChange={(event) => setAddName(event.target.value)}
                    placeholder="My Core Banking API"
                  />
                </label>
                <label className="connector-upload-field">
                  <span className="form-label">Vendor</span>
                  <input
                    className="form-input"
                    type="text"
                    value={addVendor}
                    onChange={(event) => setAddVendor(event.target.value)}
                    placeholder="Custom"
                  />
                </label>
                <label className="connector-upload-field">
                  <span className="form-label">Category</span>
                  <select
                    className="form-select"
                    value={addCategory}
                    onChange={(event) => setAddCategory(normalizeCategory(event.target.value))}
                  >
                    <option value="core-banking">Core Banking</option>
                    <option value="credit-union">Credit Union</option>
                    <option value="crm">CRM</option>
                    <option value="erp">ERP</option>
                  </select>
                </label>
                <label className="connector-upload-field connector-upload-field--full">
                  <span className="form-label">Description</span>
                  <input
                    className="form-input"
                    type="text"
                    value={addDescription}
                    onChange={(event) => setAddDescription(event.target.value)}
                    placeholder="Describe what this connector integrates"
                  />
                </label>
                <label className="connector-upload-field connector-upload-field--full">
                  <span className="form-label">Entity names (comma-separated)</span>
                  <input
                    className="form-input"
                    type="text"
                    value={addEntityNames}
                    onChange={(event) => setAddEntityNames(event.target.value)}
                    placeholder="Customer, Account, Transaction"
                  />
                </label>
              </div>

              <div className="connector-modal-tabs custom-modal-tab-bar">
                <button
                  type="button"
                  className={`custom-modal-tab ${addTab === 'rest' ? 'custom-modal-tab--active' : ''}`}
                  onClick={() => setAddTab('rest')}
                >
                  REST endpoint
                </button>
                <button
                  type="button"
                  className={`custom-modal-tab ${addTab === 'file' ? 'custom-modal-tab--active' : ''}`}
                  onClick={() => setAddTab('file')}
                >
                  Upload schema file
                </button>
              </div>

              {addTab === 'rest' ? (
                <div key="rest-tab" className="connector-modal-grid">
                  <label className="connector-upload-field connector-upload-field--full">
                    <span className="form-label">Base URL</span>
                    <input
                      className="form-input"
                      type="url"
                      value={addRestUrl}
                      onChange={(event) => setAddRestUrl(event.target.value)}
                      placeholder="https://api.example.com"
                    />
                  </label>
                  <label className="connector-upload-field">
                    <span className="form-label">Auth mode</span>
                    <select
                      className="form-select"
                      value={addRestAuth}
                      onChange={(event) => setAddRestAuth(event.target.value as RestAuthType)}
                    >
                      <option value="none">No auth</option>
                      <option value="bearer">Bearer token</option>
                      <option value="basic">Basic auth</option>
                    </select>
                  </label>
                  {addRestAuth === 'bearer' && (
                    <label className="connector-upload-field">
                      <span className="form-label">Bearer token (session-only)</span>
                      <input
                        className="form-input"
                        type="password"
                        value={addBearerToken}
                        onChange={(event) => setAddBearerToken(event.target.value)}
                        placeholder="Paste token"
                      />
                    </label>
                  )}
                  {addRestAuth === 'basic' && (
                    <>
                      <label className="connector-upload-field">
                        <span className="form-label">Basic username (session-only)</span>
                        <input
                          className="form-input"
                          type="text"
                          value={addBasicUser}
                          onChange={(event) => setAddBasicUser(event.target.value)}
                          placeholder="username"
                        />
                      </label>
                      <label className="connector-upload-field">
                        <span className="form-label">Basic password (session-only)</span>
                        <input
                          className="form-input"
                          type="password"
                          value={addBasicPassword}
                          onChange={(event) => setAddBasicPassword(event.target.value)}
                          placeholder="password"
                        />
                      </label>
                    </>
                  )}
                </div>
              ) : (
                <div key="file-tab" className="connector-modal-grid">
                  <label className="connector-upload-field connector-upload-field--full">
                    <span className="form-label">Schema file</span>
                    <input
                      className="form-input"
                      type="file"
                      accept=".csv,.json,.xml,text/csv,application/json,application/xml,text/xml"
                      onChange={(event) => void handleModalFileUpload(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <p className="connector-modal-note">
                    Upload a CSV, JSON, or XML schema definition. Files larger than 5 MB are rejected.
                  </p>
                </div>
              )}

              {addEntities.length > 0 && (
                <div className="connector-modal-entities">
                  <span className="form-label">Parsed entities</span>
                  <div className="connector-entities">
                    {addEntities.map((entity) => (
                      <span key={entity.name} className="connector-entity-tag">{entity.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {addError && (
                <p className="connector-modal-error" role="alert">
                  {addError}
                </p>
              )}
            </div>

            <div className="connector-modal-actions">
              <button type="button" className="btn btn--ghost" onClick={closeAddConnectorModal} disabled={addSaving}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={saveCustomConnector} disabled={addSaving}>
                {addSaving ? 'Saving…' : 'Save connector'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project name + proceed */}
      {source && target && (
        <div className="connector-proceed-bar">
          <div className="connector-proceed-inner">
            <div className="connector-proceed-left">
              <label className="form-label" htmlFor="project-name">
                Project name <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="project-name"
                className="form-input connector-name-input"
                type="text"
                placeholder={`${connectors.find((c) => c.id === source)?.name} → ${connectors.find((c) => c.id === target)?.name}`}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
              <div className="connector-upload-row">
                <label className="connector-upload-field">
                  <span className="form-label">Source schema file (optional)</span>
                  <input
                    className="form-input"
                    type="file"
                    accept=".csv,.json,.xml,text/csv,application/json,application/xml,text/xml"
                    onChange={(e) => setSourceFile(e.target.files?.[0] ?? null)}
                  />
                  <span className="connector-upload-hint">{sourceFile ? sourceFile.name : 'Upload .csv, .json, or .xml'}</span>
                </label>
                <label className="connector-upload-field">
                  <span className="form-label">Target schema file (optional)</span>
                  <input
                    className="form-input"
                    type="file"
                    accept=".csv,.json,.xml,text/csv,application/json,application/xml,text/xml"
                    onChange={(e) => setTargetFile(e.target.files?.[0] ?? null)}
                  />
                  <span className="connector-upload-hint">{targetFile ? targetFile.name : 'Upload .csv, .json, or .xml'}</span>
                </label>
              </div>

              {sapSelected && (
                <div className="connector-oauth-box">
                  <div className="connector-oauth-header">
                    <span className="connector-oauth-title">SAP OAuth (Client Credentials)</span>
                    <span className={`connector-oauth-badge ${sapOAuthConnected ? 'connected' : sapOAuthError ? 'error' : 'idle'}`}>
                      {sapOAuthConnected ? 'SAP OAuth Connected' : sapOAuthError ? 'Connection failed' : 'Not connected'}
                    </span>
                  </div>

                  <div className="connector-oauth-grid">
                    <label className="connector-upload-field">
                      <span className="form-label">SAP Client ID</span>
                      <input
                        className="form-input"
                        type="text"
                        value={sapClientId}
                        onChange={(event) => {
                          setSapClientId(event.target.value);
                          setSapOAuthConnected(false);
                        }}
                        placeholder="SAP OAuth client id"
                      />
                    </label>

                    <label className="connector-upload-field">
                      <span className="form-label">SAP Client Secret</span>
                      <input
                        className="form-input"
                        type="password"
                        value={sapClientSecret}
                        onChange={(event) => {
                          setSapClientSecret(event.target.value);
                          setSapOAuthConnected(false);
                        }}
                        placeholder="SAP OAuth client secret"
                      />
                    </label>

                    <label className="connector-upload-field connector-upload-field--full">
                      <span className="form-label">SAP Token URL</span>
                      <input
                        className="form-input"
                        type="url"
                        value={sapTokenUrl}
                        onChange={(event) => {
                          setSapTokenUrl(event.target.value);
                          setSapOAuthConnected(false);
                        }}
                        placeholder="https://<subaccount>.authentication.<region>.hana.ondemand.com/oauth/token"
                      />
                    </label>
                  </div>

                  <div className="connector-oauth-actions">
                    {!sapOAuthConnected ? (
                      <button
                        type="button"
                        className="btn btn--secondary"
                        disabled={!canConnectSapOAuth || sapOAuthLoading}
                        onClick={handleConnectSapOAuth}
                      >
                        {sapOAuthLoading ? (
                          <>
                            <span className="btn-spinner" />
                            Connecting…
                          </>
                        ) : (
                          'Connect to SAP'
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={sapOAuthLoading}
                        onClick={handleDisconnectSapOAuth}
                      >
                        Disconnect
                      </button>
                    )}

                    {sapOAuthExpiresIn !== null && sapOAuthConnected && (
                      <span className="connector-oauth-meta">Token expires in {sapOAuthExpiresIn}s</span>
                    )}
                  </div>

                  {sapOAuthError && <p className="connector-oauth-error">{sapOAuthError}</p>}
                </div>
              )}
            </div>
            <button
              className="btn btn--primary btn--lg"
              onClick={handleProceed}
              disabled={!canProceed}
            >
              {loading ? (
                <>
                  <span className="btn-spinner" />
                  Creating project…
                </>
              ) : (
                <>
                  Discover schemas
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </div>
          <p className="connector-proceed-note">
            AutoMapper will ingest both schemas and prepare them for the 8-agent orchestration pipeline. Uploaded files
            take priority for their selected side.
          </p>
        </div>
      )}
    </div>
  );
}
