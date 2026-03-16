import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommandCenter } from './CommandCenter';
import type { ProjectHistoryItem } from '@contracts';

const baseProject: ProjectHistoryItem = {
  project: {
    id: 'project-1',
    name: 'RiskClam to Salesforce',
    sourceSystemId: 'source-1',
    targetSystemId: 'target-1',
    createdAt: new Date('2026-03-16T01:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-03-16T01:05:00.000Z').toISOString(),
  },
  sourceSystem: {
    id: 'source-1',
    name: 'RiskClam',
    type: 'riskclam',
  },
  targetSystem: {
    id: 'target-1',
    name: 'Salesforce',
    type: 'salesforce',
  },
  fieldMappingCount: 42,
  entityMappingCount: 19,
  canExport: true,
  unresolvedConflicts: 0,
};

describe('CommandCenter project actions', () => {
  it('offers separate review and export actions for recent projects', async () => {
    const user = userEvent.setup();
    const onOpenReview = vi.fn();
    const onOpenExport = vi.fn();

    render(
      <CommandCenter
        userName="Admin User"
        userRole="ADMIN"
        projects={[baseProject]}
        llmUsage={null}
        isDemoMode={false}
        onNewProject={vi.fn()}
        onOpenReview={onOpenReview}
        onOpenExport={onOpenExport}
        onOpenLLMSettings={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(onOpenReview).toHaveBeenCalledWith(baseProject.project.id);
    expect(onOpenExport).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(onOpenExport).toHaveBeenCalledWith(baseProject.project.id);
  });
});
