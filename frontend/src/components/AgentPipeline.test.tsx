import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPipeline } from './AgentPipeline';

const { apiMock, TestEventSource } = vi.hoisted(() => {
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
      const events = [
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
      ];

      for (const event of events) {
        const timer = setTimeout(() => {
          if (this.closed) return;
          this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event.payload) }));
        }, event.delay);
        this.timers.push(timer);
      }

      // Simulate the socket closing after completion is sent.
      const errorTimer = setTimeout(() => {
        if (this.closed) return;
        this.onerror?.(new Event('error'));
      }, 75);
      this.timers.push(errorTimer);
    }

    close() {
      this.closed = true;
      this.readyState = 2;
      for (const timer of this.timers) clearTimeout(timer);
    }
  }

  return { apiMock, TestEventSource };
});

vi.mock('../api/client', () => ({
  api: (path: string, init?: RequestInit) => apiMock(path, init),
  apiBase: () => 'http://localhost:4000',
  getAuthTokenForSse: () => 'test-token',
  getEventSource: (url: string) => new TestEventSource(url),
  MockEventSource: TestEventSource,
}));

describe('AgentPipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMock.mockClear();
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
});
