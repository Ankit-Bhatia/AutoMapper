import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectHistoryItem } from '@contracts';
import { DashboardPage } from './DashboardPage';

function buildProject(overrides?: Partial<ProjectHistoryItem>): ProjectHistoryItem {
  return {
    project: {
      id: 'project-1',
      name: 'Core Director to FSC',
      sourceSystemId: 'src-1',
      targetSystemId: 'tgt-1',
      createdAt: new Date('2026-03-20T10:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-03-24T10:00:00.000Z').toISOString(),
      archived: false,
      ...(overrides?.project ?? {}),
    },
    sourceSystem: {
      id: 'src-1',
      name: 'jackhenry-coredirector',
      type: 'jackhenry',
    },
    targetSystem: {
      id: 'tgt-1',
      name: 'salesforce',
      type: 'salesforce',
    },
    sourceConnectorName: 'Jack Henry Core Director',
    targetConnectorName: 'Salesforce CRM',
    coverage: { mapped: 42, total: 60 },
    fieldMappingCount: 42,
    entityMappingCount: 8,
    canExport: false,
    openConflicts: 3,
    unresolvedConflicts: 3,
    unresolvedRoutingDecisions: 0,
    ...overrides,
  };
}

describe('DashboardPage', () => {
  it('shows portfolio summary, hides archived projects by default, and supports actions', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onDuplicate = vi.fn(async () => undefined);
    const onArchive = vi.fn(async () => undefined);
    const onRename = vi.fn(async () => undefined);

    const activeProject = buildProject();
    const archivedProject = buildProject({
      project: {
        id: 'project-2',
        name: 'Archived Project',
        sourceSystemId: 'src-1',
        targetSystemId: 'tgt-1',
        createdAt: new Date('2026-03-18T10:00:00.000Z').toISOString(),
        updatedAt: new Date('2026-03-19T10:00:00.000Z').toISOString(),
        archived: true,
      },
      coverage: { mapped: 10, total: 20 },
      fieldMappingCount: 10,
      entityMappingCount: 3,
      canExport: true,
      openConflicts: 0,
      unresolvedConflicts: 0,
    });

    render(
      <DashboardPage
        projects={[activeProject, archivedProject]}
        loading={false}
        onRefresh={vi.fn()}
        onNewProject={vi.fn()}
        onOpen={onOpen}
        onDuplicate={onDuplicate}
        onArchive={onArchive}
        onRename={onRename}
      />,
    );

    expect(screen.getByText('42 / 60')).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.dashboard-summary-value' })).toBeInTheDocument();
    expect(screen.queryByText('Archived Project')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith('project-1');

    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(onDuplicate).toHaveBeenCalledWith('project-1');

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onArchive).toHaveBeenCalledWith('project-1', true);

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByDisplayValue('Core Director to FSC');
    await user.clear(input);
    await user.type(input, 'Renamed Project');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('project-1', 'Renamed Project');
    });

    await user.click(screen.getByRole('checkbox', { name: /show archived/i }));
    expect(screen.getByText('Archived Project')).toBeInTheDocument();
  });

  it('renders the empty state when no active projects exist', () => {
    render(
      <DashboardPage
        projects={[]}
        loading={false}
        onRefresh={vi.fn()}
        onNewProject={vi.fn()}
        onOpen={vi.fn()}
        onDuplicate={vi.fn()}
        onArchive={vi.fn()}
        onRename={vi.fn()}
      />,
    );

    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start new migration/i })).toBeInTheDocument();
  });
});
