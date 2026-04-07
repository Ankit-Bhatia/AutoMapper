import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, isDemoUiMode } from '@core/api-client';
import { ROLE_RANK, type ProjectMember, type ProjectMembersResponse, type UserRole } from '@contracts';
import { useAuth } from '../auth/AuthContext';

export function canPerform(role: UserRole, minRole: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

interface UseProjectRoleResult {
  role: UserRole;
  members: ProjectMember[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  canPerform: (role: UserRole, minRole: UserRole) => boolean;
}

export function useProjectRole(projectId: string | null | undefined): UseProjectRoleResult {
  const { user } = useAuth();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [role, setRole] = useState<UserRole>('admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setMembers([]);
      setRole('admin');
      setError(null);
      return;
    }

    if (isDemoUiMode()) {
      setMembers([]);
      setRole('admin');
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api<ProjectMembersResponse>(`/api/projects/${projectId}/members`);
      const nextMembers = response.members ?? [];
      setMembers(nextMembers);

      const current = nextMembers.find((member) => member.userId === user?.id);
      if (current) {
        setRole(current.role);
      } else if (nextMembers.length === 0) {
        // Compatibility for legacy projects created before project-member persistence existed.
        setRole('admin');
      } else {
        setRole('viewer');
      }
    } catch (nextError) {
      setMembers([]);
      setRole('viewer');
      setError(nextError instanceof Error ? nextError.message : 'Failed to load project members');
    } finally {
      setLoading(false);
    }
  }, [projectId, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return useMemo(() => ({
    role,
    members,
    loading,
    error,
    refresh,
    canPerform,
  }), [error, loading, members, refresh, role]);
}
