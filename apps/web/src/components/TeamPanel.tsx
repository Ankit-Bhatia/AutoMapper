import { useEffect, useMemo, useState } from 'react';
import { api, isDemoUiMode } from '@core/api-client';
import type {
  AddMemberRequest,
  PatchMemberRequest,
  ProjectMember,
  ProjectMembersResponse,
  UserRole,
} from '@contracts';

const ROLE_OPTIONS: UserRole[] = ['viewer', 'mapper', 'approver', 'admin'];

interface TeamPanelProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onMembersChanged?: (members: ProjectMember[]) => void;
}

function buildStandaloneMembers(): ProjectMember[] {
  return [{
    userId: 'standalone-user',
    email: 'demo@automapper.local',
    role: 'admin',
    addedAt: new Date().toISOString(),
  }];
}

export function TeamPanel({
  open,
  projectId,
  onClose,
  onMembersChanged,
}: TeamPanelProps) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('viewer');
  const [error, setError] = useState<string | null>(null);

  async function loadMembers() {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const nextMembers = isDemoUiMode()
        ? buildStandaloneMembers()
        : (await api<ProjectMembersResponse>(`/api/projects/${projectId}/members`)).members ?? [];
      setMembers(nextMembers);
      onMembersChanged?.(nextMembers);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load project members');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMembers();
  }, [open, projectId]);

  const adminCount = useMemo(
    () => members.filter((member) => member.role === 'admin').length,
    [members],
  );

  async function handleAddMember() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setBusyUserId('invite');
    setError(null);
    try {
      const nextMember = isDemoUiMode()
        ? {
            userId: email,
            email,
            role: inviteRole,
            addedAt: new Date().toISOString(),
          }
        : await api<ProjectMember>(`/api/projects/${projectId}/members`, {
            method: 'POST',
            body: JSON.stringify({ email, role: inviteRole } satisfies AddMemberRequest),
          });
      const nextMembers = [...members, nextMember];
      setMembers(nextMembers);
      setInviteEmail('');
      setInviteRole('viewer');
      onMembersChanged?.(nextMembers);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to add member');
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRoleChange(userId: string, role: UserRole) {
    setBusyUserId(userId);
    setError(null);
    try {
      const updated = isDemoUiMode()
        ? members.find((member) => member.userId === userId)
        : await api<ProjectMember>(`/api/projects/${projectId}/members/${userId}`, {
            method: 'PATCH',
            body: JSON.stringify({ role } satisfies PatchMemberRequest),
          });
      if (!updated) return;
      const nextMembers = members.map((member) => (
        member.userId === userId ? { ...member, role: updated.role } : member
      ));
      setMembers(nextMembers);
      onMembersChanged?.(nextMembers);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to change member role');
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRemove(userId: string) {
    setBusyUserId(userId);
    setError(null);
    try {
      if (isDemoUiMode()) {
        const member = members.find((candidate) => candidate.userId === userId);
        if (member?.role === 'admin' && adminCount <= 1) {
          throw new Error('Cannot remove the last Admin');
        }
      } else {
        await api<void>(`/api/projects/${projectId}/members/${userId}`, {
          method: 'DELETE',
        });
      }
      const nextMembers = members.filter((member) => member.userId !== userId);
      setMembers(nextMembers);
      onMembersChanged?.(nextMembers);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to remove member');
    } finally {
      setBusyUserId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="team-panel-backdrop" onClick={onClose}>
      <aside className="team-panel" onClick={(event) => event.stopPropagation()} aria-label="Team panel">
        <div className="team-panel-header">
          <div>
            <div className="team-panel-eyebrow">Project access</div>
            <h2 className="team-panel-title">Team</h2>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>Close</button>
        </div>

        {error && <p className="team-panel-error">{error}</p>}
        {loading && <p className="team-panel-state">Loading members…</p>}

        <div className="team-panel-list">
          {members.map((member) => {
            const disableRemove = member.role === 'admin' && adminCount <= 1;
            return (
              <div key={member.userId} className="team-panel-row">
                <div className="team-panel-member">
                  <div className="team-panel-email">{member.email}</div>
                  <div className="team-panel-added">Added {new Date(member.addedAt).toLocaleDateString()}</div>
                </div>
                <select
                  className="form-select team-panel-role"
                  value={member.role}
                  disabled={busyUserId === member.userId}
                  onChange={(event) => {
                    void handleRoleChange(member.userId, event.target.value as UserRole);
                  }}
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busyUserId === member.userId || disableRemove}
                  title={disableRemove ? 'Cannot remove the last Admin' : 'Remove member'}
                  onClick={() => { void handleRemove(member.userId); }}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>

        <div className="team-panel-invite">
          <div className="team-panel-section-title">Invite member</div>
          <input
            className="form-input team-panel-input"
            type="email"
            placeholder="teammate@example.com"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
          />
          <select
            className="form-select team-panel-role"
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as UserRole)}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busyUserId === 'invite' || inviteEmail.trim().length === 0}
            onClick={() => { void handleAddMember(); }}
          >
            {busyUserId === 'invite' ? 'Adding…' : 'Add Member'}
          </button>
        </div>
      </aside>
    </div>
  );
}
