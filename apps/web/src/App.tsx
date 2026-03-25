import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { FirstSetupPage } from './auth/FirstSetupPage';
import { LoginPage } from './auth/LoginPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import { MappingStudioApp } from './MappingStudioApp';
import type { AuthError } from './auth/types';

function AuthLoading() {
  return <div className="auth-loading">Restoring session...</div>;
}

function LoginRoute() {
  const { status, login } = useAuth();
  const navigate = useNavigate();

  if (status === 'loading') {
    return <AuthLoading />;
  }

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  if (status === 'setup-required') {
    return <Navigate to="/setup" replace />;
  }

  return (
    <LoginPage
      onSubmit={async (input) => {
        try {
          await login(input);
          navigate('/', { replace: true });
        } catch (error) {
          const authError = error as AuthError;
          if (authError.code === 'SETUP_REQUIRED') {
            navigate('/setup', { replace: true });
          }
          throw error;
        }
      }}
      onGoToSetup={() => navigate('/setup')}
    />
  );
}

function SetupRoute() {
  const { status, setup } = useAuth();
  const navigate = useNavigate();

  if (status === 'loading') {
    return <AuthLoading />;
  }

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return (
    <FirstSetupPage
      onSubmit={async (input) => {
        await setup(input);
        navigate('/', { replace: true });
      }}
      onGoToLogin={() => navigate('/login')}
    />
  );
}

export default function App() {
  function StudioRoute({ initialView }: { initialView: 'dashboard' | 'new' }) {
    const navigate = useNavigate();
    return <MappingStudioApp initialView={initialView} onNavigate={(path) => navigate(path)} />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/setup" element={<SetupRoute />} />
      <Route
        path="/"
        element={(
          <ProtectedRoute>
            <StudioRoute initialView="dashboard" />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/dashboard"
        element={(
          <ProtectedRoute>
            <StudioRoute initialView="dashboard" />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/new"
        element={(
          <ProtectedRoute>
            <StudioRoute initialView="new" />
          </ProtectedRoute>
        )}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
