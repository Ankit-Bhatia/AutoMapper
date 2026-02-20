import { useMemo, useState } from 'react';
import { api, apiBase } from './api/client';
import type {
  Entity,
  EntityMapping,
  Field,
  FieldMapping,
  Project,
  ProjectPayload,
  ValidationReport,
} from './types';

type Tab = 'setup' | 'review' | 'export';

const TRANSFORMS = ['direct', 'concat', 'formatDate', 'lookup', 'static', 'regex', 'split', 'trim'];

export default function App() {
  const [tab, setTab] = useState<Tab>('setup');
  const [projectName, setProjectName] = useState('SAP to Salesforce Demo');
  const [project, setProject] = useState<Project | null>(null);
  const [sourceEntities, setSourceEntities] = useState<Entity[]>([]);
  const [targetEntities, setTargetEntities] = useState<Entity[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [entityMappings, setEntityMappings] = useState<EntityMapping[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [selectedSapFile, setSelectedSapFile] = useState<File | null>(null);
  const [sfObjects, setSfObjects] = useState('Account,Contact,Sales_Area__c');
  const [status, setStatus] = useState('Ready');

  const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const entityById = useMemo(
    () => new Map([...sourceEntities, ...targetEntities].map((e) => [e.id, e])),
    [sourceEntities, targetEntities],
  );

  async function createProject() {
    const data = await api<{ project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: projectName }),
    });
    setProject(data.project);
    setStatus(`Project created: ${data.project.name}`);
  }

  async function uploadSapSchema() {
    if (!project || !selectedSapFile) return;
    const form = new FormData();
    form.set('file', selectedSapFile);

    const response = await fetch(`${apiBase()}/api/projects/${project.id}/source-schema`, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error || 'Failed uploading schema');
    }

    setStatus('SAP schema ingested');
    await refreshProject();
  }

  async function loadSalesforceSchema() {
    if (!project) return;
    const objects = sfObjects
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const result = await api<{ mode: string }>(`/api/projects/${project.id}/target-schema/salesforce`, {
      method: 'POST',
      body: JSON.stringify({ objects }),
    });

    setStatus(`Salesforce schema loaded (${result.mode})`);
    await refreshProject();
  }

  async function generateSuggestions() {
    if (!project) return;
    const result = await api<{
      entityMappings: EntityMapping[];
      fieldMappings: FieldMapping[];
      validation: ValidationReport;
      mode: string;
    }>(`/api/projects/${project.id}/suggest-mappings`, { method: 'POST', body: '{}' });

    setEntityMappings(result.entityMappings);
    setFieldMappings(result.fieldMappings);
    setValidation(result.validation);
    setStatus(`Mapping suggestions generated (${result.mode})`);
    setTab('review');
  }

  async function refreshProject() {
    if (!project) return;
    const data = await api<ProjectPayload>(`/api/projects/${project.id}`);
    setProject(data.project);
    setSourceEntities(data.sourceEntities);
    setTargetEntities(data.targetEntities);
    setFields(data.fields);
    setEntityMappings(data.entityMappings);
    setFieldMappings(data.fieldMappings);
  }

  async function patchFieldMapping(id: string, patch: Partial<FieldMapping>) {
    const result = await api<{ fieldMapping: FieldMapping }>(`/api/field-mappings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setFieldMappings((prev) => prev.map((fm) => (fm.id === id ? result.fieldMapping : fm)));
  }

  async function editTransformConfig(mapping: FieldMapping) {
    const current = JSON.stringify(mapping.transform.config);
    const updated = window.prompt('Enter transform config JSON', current);
    if (updated === null) return;
    try {
      const parsed = JSON.parse(updated);
      await patchFieldMapping(mapping.id, {
        transform: { ...mapping.transform, config: parsed },
        status: 'modified',
      });
    } catch {
      window.alert('Invalid JSON config.');
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Auto Mapper - Phase 1 MVP</h1>
        <p>{status}</p>
      </header>

      <nav className="tabs">
        <button className={tab === 'setup' ? 'active' : ''} onClick={() => setTab('setup')}>Project Setup</button>
        <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>Mapping Review</button>
        <button className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}>Export</button>
      </nav>

      {tab === 'setup' && (
        <section className="card">
          <h2>Create Project</h2>
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          <button onClick={createProject}>Create</button>

          <h3>Upload SAP Schema (JSON/XML/CSV)</h3>
          <input type="file" onChange={(e) => setSelectedSapFile(e.target.files?.[0] ?? null)} />
          <button disabled={!project || !selectedSapFile} onClick={uploadSapSchema}>Upload SAP Schema</button>

          <h3>Connect Salesforce + Select Objects</h3>
          <input
            value={sfObjects}
            onChange={(e) => setSfObjects(e.target.value)}
            placeholder="Account,Contact,Sales_Area__c"
          />
          <button disabled={!project} onClick={loadSalesforceSchema}>Load Salesforce Metadata</button>

          <div className="actions">
            <button disabled={!project} onClick={generateSuggestions}>Generate Mapping Suggestions</button>
            <button disabled={!project} onClick={refreshProject}>Refresh</button>
          </div>
        </section>
      )}

      {tab === 'review' && (
        <section className="card">
          <h2>Entity Mapping Suggestions</h2>
          <table>
            <thead>
              <tr>
                <th>Source Entity</th>
                <th>Target Entity</th>
                <th>Confidence</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {entityMappings.map((em) => (
                <tr key={em.id}>
                  <td>{entityById.get(em.sourceEntityId)?.name}</td>
                  <td>{entityById.get(em.targetEntityId)?.name}</td>
                  <td>{em.confidence.toFixed(2)}</td>
                  <td>{em.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Field Mapping Suggestions</h2>
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Target</th>
                <th>Transform</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {fieldMappings.map((fm) => {
                const source = fieldById.get(fm.sourceFieldId);
                const target = fieldById.get(fm.targetFieldId);
                return (
                  <tr key={fm.id}>
                    <td>{source?.name}</td>
                    <td>{target?.name}</td>
                    <td>
                      <select
                        value={fm.transform.type}
                        onChange={(e) =>
                          patchFieldMapping(fm.id, {
                            transform: { ...fm.transform, type: e.target.value },
                            status: 'modified',
                          })
                        }
                      >
                        {TRANSFORMS.map((t) => (
                          <option value={t} key={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td>{fm.confidence.toFixed(2)}</td>
                    <td>{fm.status}</td>
                    <td>
                      <button onClick={() => patchFieldMapping(fm.id, { status: 'accepted' })}>Accept</button>
                      <button onClick={() => patchFieldMapping(fm.id, { status: 'rejected' })}>Reject</button>
                      <button onClick={() => editTransformConfig(fm)}>Edit Config</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'export' && (
        <section className="card">
          <h2>Export Mapping Spec</h2>
          {project && (
            <div className="actions">
              <a href={`${apiBase()}/api/projects/${project.id}/export?format=json`} target="_blank">Download JSON</a>
              <a href={`${apiBase()}/api/projects/${project.id}/export?format=csv`} target="_blank">Download CSV</a>
            </div>
          )}

          <h3>Validation Warnings</h3>
          {validation ? (
            <>
              <p>Total: {validation.summary.totalWarnings}</p>
              <ul>
                {validation.warnings.map((w, idx) => (
                  <li key={idx}>{w.type}: {w.message}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>Generate mappings to see validation report.</p>
          )}
        </section>
      )}
    </div>
  );
}
