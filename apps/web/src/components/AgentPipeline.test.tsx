import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPipeline } from './AgentPipeline';

const { apiMock, TestEventSource, setEventSourceMode } = vi.hoisted(() => {
  let mode: 'agent_events' | 'step_agent_alias' | 'validation_heartbeats' | 'orchestrate_only_close' = 'agent_events';

  function setEventSourceMode(next: 'agent_events' | 'step_agent_alias' | 'validation_heartbeats' | 'orchestrate_only_close') {
    mode = next;
  }

  const apiMock = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path.startsWith('/api/projects/')) {
      return {
        entityMappings: [
          {
            id: 'em-1',
            projectId: 'p1',
            sourceEntityId: 's1',
            targetEntityId: 't1',
            confidence: 0.9,
            rationale: 'test',
          },
        ],
        fieldMappings: [
          {
            id: 'fm-1',
            entityMappingId: 'em-1',
            sourceFieldId: 'sf-1',
            targetFieldId: 'tf-1',
            transform: { type: 'direct', config: {} },
            confidence: 0.9,
            rationale: 'test',
            status: 'accepted',
          },
        ],
      };
    }
    return {};
  });

  class TestEventSource {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    readyState = 1;
    private timers: ReturnType<typeof setTimeout>[] = [];
    private closed = false;

    constructor(_url: string) {
      const events = mode === 'agent_events'
        ? [
            { delay: 0, payload: { event: 'agent_start', agent: 'SchemaDiscoveryAgent' } },
            { delay: 5, payload: { event: 'agent_complete', agent: 'SchemaDiscoveryAgent', output: 'Schema complete' } },
            { delay: 10, payload: { event: 'agent_start', agent: 'ComplianceAgent' } },
            { delay: 15, payload: { event: 'agent_complete', agent: 'ComplianceAgent', output: 'Compliance complete' } },
            { delay: 16, payload: { event: 'step', agentName: 'ComplianceAgent', action: 'compliance_issue', detail: 'Post-scan note' } },
            { delay: 20, payload: { event: 'agent_start', agent: 'BankingDomainAgent' } },
            { delay: 25, payload: { event: 'agent_complete', agent: 'BankingDomainAgent', output: 'Banking complete' } },
            { delay: 30, payload: { event: 'agent_start', agent: 'CRMDomainAgent' } },
            { delay: 35, payload: { event: 'agent_complete', agent: 'CRMDomainAgent', output: 'CRM complete' } },
            { delay: 40, payload: { event: 'agent_start', agent: 'MappingProposalAgent' } },
            { delay: 45, payload: { event: 'agent_complete', agent: 'MappingProposalAgent', output: 'Proposal complete' } },
            { delay: 50, payload: { event: 'agent_start', agent: 'MappingRationaleAgent' } },
            { delay: 55, payload: { event: 'agent_complete', agent: 'MappingRationaleAgent', output: 'Rationale complete' } },
            { delay: 60, payload: { event: 'agent_start', agent: 'ValidationAgent' } },
            { delay: 65, payload: { event: 'agent_complete', agent: 'ValidationAgent', output: 'Validation complete' } },
            {
              delay: 70,
              payload: {
                type: 'complete',
                durationMs: 70,
                complianceSummary: { errors: 0, warnings: 0 },
              },
            },
          ]
        : mode === 'step_agent_alias'
          ? [
            { delay: 0, payload: { type: 'step', agent: 'SchemaDiscoveryAgent', action: 'start', detail: 'start schema' } },
            { delay: 5, payload: { type: 'step', agent: 'SchemaDiscoveryAgent', action: 'schema_discovery_complete', detail: 'schema done' } },
            { delay: 10, payload: { type: 'step', agent: 'ComplianceAgent', action: 'start', detail: 'start compliance' } },
            { delay: 15, payload: { type: 'step', agent: 'ComplianceAgent', action: 'compliance_scan_complete', detail: 'compliance done' } },
            { delay: 20, payload: { type: 'step', agent: 'BankingDomainAgent', action: 'start', detail: 'start banking' } },
            { delay: 25, payload: { type: 'step', agent: 'BankingDomainAgent', action: 'banking_domain_complete', detail: 'banking done' } },
            { delay: 30, payload: { type: 'step', agent: 'CRMDomainAgent', action: 'start', detail: 'start crm' } },
            { delay: 35, payload: { type: 'step', agent: 'CRMDomainAgent', action: 'crm_domain_complete', detail: 'crm done' } },
            { delay: 40, payload: { type: 'step', agent: 'MappingProposalAgent', action: 'start', detail: 'start proposal' } },
            { delay: 45, payload: { type: 'step', agent: 'MappingProposalAgent', action: 'mapping_proposal_complete', detail: 'proposal done' } },
            { delay: 50, payload: { type: 'step', agent: 'MappingRationaleAgent', action: 'start', detail: 'start rationale' } },
            { delay: 55, payload: { type: 'step', agent: 'MappingRationaleAgent', action: 'rationale_generation_complete', detail: 'rationale done' } },
            { delay: 60, payload: { type: 'step', agent: 'ValidationAgent', action: 'start', detail: 'start validation' } },
            { delay: 65, payload: { type: 'step', agent: 'ValidationAgent', action: 'validation_complete', detail: 'validation done' } },
            {
              delay: 70,
              payload: {
                type: 'complete',
                durationMs: 70,
                complianceSummary: { errors: 0, warnings: 0 },
              },
            },
          ]
          : mode === 'validation_heartbeats'
            ? [
              { delay: 0, payload: { type: 'step', agentName: 'SchemaDiscoveryAgent', action: 'schema_discovery_complete', detail: 'schema done' } },
              { delay: 5, payload: { type: 'step', agentName: 'ComplianceAgent', action: 'compliance_scan_complete', detail: 'compliance done' } },
              { delay: 10, payload: { type: 'step', agentName: 'BankingDomainAgent', action: 'banking_domain_complete', detail: 'banking done' } },
              { delay: 15, payload: { type: 'step', agentName: 'CRMDomainAgent', action: 'crm_domain_complete', detail: 'crm done' } },
              { delay: 20, payload: { type: 'step', agentName: 'MappingProposalAgent', action: 'mapping_proposal_complete', detail: 'proposal done' } },
              { delay: 25, payload: { type: 'step', agentName: 'MappingRationaleAgent', action: 'rationale_generation_complete', detail: 'rationale done' } },
              { delay: 30, payload: { type: 'step', agentName: 'ValidationAgent', action: 'start', detail: 'validation started' } },
              { delay: 5000, payload: { type: 'heartbeat', ts: Date.now() } },
              { delay: 10000, payload: { type: 'heartbeat', ts: Date.now() } },
              { delay: 15000, payload: { type: 'heartbeat', ts: Date.now() } },
              { delay: 20000, payload: { type: 'heartbeat', ts: Date.now() } },
              { delay: 25000, payload: { type: 'heartbeat', ts: Date.now() } },
              { delay: 30000, payload: { type: 'step', agentName: 'ValidationAgent', action: 'validation_complete', detail: 'validation done' } },
              {
                delay: 30005,
                payload: {
                  type: 'complete',
                  durationMs: 30005,
                  complianceSummary: { errors: 0, warnings: 0 },
                },
              },
            ]
          : mode === 'orchestrate_only_close'
            ? [
              { delay: 0, payload: { type: 'step', agentName: 'SchemaDiscoveryAgent', action: 'schema_discovery_complete', detail: 'schema done' } },
              { delay: 5, payload: { type: 'step', agentName: 'ComplianceAgent', action: 'compliance_scan_complete', detail: 'compliance done' } },
              { delay: 10, payload: { type: 'step', agentName: 'BankingDomainAgent', action: 'banking_domain_complete', detail: 'banking done' } },
              { delay: 15, payload: { type: 'step', agentName: 'CRMDomainAgent', action: 'crm_domain_complete', detail: 'crm done' } },
              { delay: 20, payload: { type: 'step', agentName: 'MappingProposalAgent', action: 'mapping_proposal_complete', detail: 'proposal done' } },
              { delay: 25, payload: { type: 'step', agentName: 'MappingRationaleAgent', action: 'rationale_generation_complete', detail: 'rationale done' } },
              { delay: 30, payload: { type: 'step', agentName: 'ValidationAgent', action: 'validation_complete', detail: 'validation done' } },
              { delay: 35, payload: { type: 'step', agentName: 'OrchestratorAgent', action: 'orchestrate_complete', detail: 'pipeline checkpoint complete' } },
            ]
          : [
            { delay: 0, payload: { type: 'step', agent: 'SchemaDiscoveryAgent', action: 'start', detail: 'start schema' } },
            { delay: 5, payload: { type: 'step', agent: 'SchemaDiscoveryAgent', action: 'schema_discovery_complete', detail: 'schema done' } },
            { delay: 10, payload: { type: 'step', agent: 'ComplianceAgent', action: 'start', detail: 'start compliance' } },
            { delay: 15, payload: { type: 'step', agent: 'ComplianceAgent', action: 'compliance_scan_complete', detail: 'compliance done' } },
            { delay: 20, payload: { type: 'step', agent: 'BankingDomainAgent', action: 'start', detail: 'start banking' } },
            { delay: 25, payload: { type: 'step', agent: 'BankingDomainAgent', action: 'banking_domain_complete', detail: 'banking done' } },
            { delay: 30, payload: { type: 'step', agent: 'CRMDomainAgent', action: 'start', detail: 'start crm' } },
            { delay: 35, payload: { type: 'step', agent: 'CRMDomainAgent', action: 'crm_domain_complete', detail: 'crm done' } },
            { delay: 40, payload: { type: 'step', agent: 'MappingProposalAgent', action: 'start', detail: 'start proposal' } },
            { delay: 45, payload: { type: 'step', agent: 'MappingProposalAgent', action: 'mapping_proposal_complete', detail: 'proposal done' } },
            { delay: 50, payload: { type: 'step', agent: 'MappingRationaleAgent', action: 'start', detail: 'start rationale' } },
            { delay: 55, payload: { type: 'step', agent: 'MappingRationaleAgent', action: 'rationale_generation_complete', detail: 'rationale done' } },
            { delay: 60, payload: { type: 'step', agent: 'ValidationAgent', action: 'start', detail: 'start validation' } },
            { delay: 65, payload: { type: 'step', agent: 'ValidationAgent', action: 'validation_complete', detail: 'validation done' } },
            {
              delay: 70,
              payload: {
                type: 'complete',
                durationMs: 70,
                complianceSummary: { errors: 0, warnings: 0 },
              },
            },
          ];

      for (const event of events) {
        const timer = setTimeout(() => {
          if (this.closed) return;
          this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event.payload) }));
        }, event.delay);
        this.timers.push(timer);
      }

      // Simulate the socket closing after completion is sent.
      const socketCloseDelayMs =
        mode === 'validation_heartbeats'
          ? 30020
          : mode === 'orchestrate_only_close'
            ? 40
            : 75;
      const errorTimer = setTimeout(() => {
        if (this.closed) return;
        this.onerror?.(new Event('error'));
      }, socketCloseDelayMs);
      this.timers.push(errorTimer);
    }

    close() {
      this.closed = true;
      this.readyState = 2;
      for (const timer of this.timers) clearTimeout(timer);
    }
  }

  return { apiMock, TestEventSource, setEventSourceMode };
});

vi.mock('@core/api-client', () => ({
  api: (path: string, init?: RequestInit) => apiMock(path, init),
  apiBase: () => 'http://localhost:4000',
  isDemoUiMode: () => true,
  getAuthTokenForSse: () => 'test-token',
  getEventSource: (url: string) => new TestEventSource(url),
  MockEventSource: TestEventSource,
}));

describe('AgentPipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMock.mockClear();
    setEventSourceMode('agent_events');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes end-to-end and ignores post-complete socket close errors', async () => {
    const onComplete = vi.fn();

    render(<AgentPipeline projectId="p1" onComplete={onComplete} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /run pipeline/i }));
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/pipeline complete/i)).toBeInTheDocument();
    expect(screen.getByText(/review ready/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Running$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/lost connection to orchestration pipeline/i)).not.toBeInTheDocument();
  });

  it('completes even if project reload hangs after complete event', async () => {
    const onComplete = vi.fn();
    apiMock.mockImplementationOnce(
      () => new Promise(() => {
        // Intentionally unresolved — component should use timeout fallback.
      }),
    );

    render(<AgentPipeline projectId="p1" onComplete={onComplete} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /run pipeline/i }));
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/pipeline complete/i)).toBeInTheDocument();
    expect(screen.queryByText(/pipeline stalled/i)).not.toBeInTheDocument();
  });

  it('updates progress for step events that use agent alias instead of agentName', async () => {
    setEventSourceMode('step_agent_alias');
    const onComplete = vi.fn();

    render(<AgentPipeline projectId="p1" onComplete={onComplete} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /run pipeline/i }));
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/pipeline complete/i)).toBeInTheDocument();
  });

  it('does not stall during long validation when heartbeat events continue', async () => {
    setEventSourceMode('validation_heartbeats');
    const onComplete = vi.fn();

    render(<AgentPipeline projectId="p1" onComplete={onComplete} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /run pipeline/i }));
      await vi.advanceTimersByTimeAsync(42000);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/pipeline complete/i)).toBeInTheDocument();
    expect(screen.queryByText(/pipeline stalled/i)).not.toBeInTheDocument();
  });

  it('finalizes when socket closes after orchestrate_complete but before final complete payload', async () => {
    setEventSourceMode('orchestrate_only_close');
    const onComplete = vi.fn();

    render(<AgentPipeline projectId="p1" onComplete={onComplete} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /run pipeline/i }));
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/pipeline complete/i)).toBeInTheDocument();
    expect(screen.queryByText(/lost connection to orchestration pipeline/i)).not.toBeInTheDocument();
  });
});
