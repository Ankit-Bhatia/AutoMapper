import React, { useState } from 'react';
import { apiBase } from '../api/client';

interface ConnectionPanelProps {
  onConnect: (connectorId: string, credentials: Record<string, string>) => void;
  onDisconnect: (connectorId: string) => void;
  connectedSystems: string[];
}

interface CredentialForm {
  [key: string]: string;
}

export default function ConnectionPanel({
  onConnect,
  onDisconnect,
  connectedSystems,
}: ConnectionPanelProps): JSX.Element {
  const [expandedSystem, setExpandedSystem] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, CredentialForm>>({
    jackhenry: { baseUrl: '', clientId: '', clientSecret: '' },
    sap: { baseUrl: '', username: '', password: '', client: '' },
  });
  const [formErrors, setFormErrors] = useState<Record<string, string[]>>({});

  const handleConnectSalesforce = () => {
    window.location.href = `${apiBase()}/api/oauth/salesforce/authorize`;
  };

  const handleDisconnect = (connectorId: string) => {
    onDisconnect(connectorId);
    setExpandedSystem(null);
  };

  const handleFormChange = (
    system: string,
    field: string,
    value: string,
  ): void => {
    setFormData((prev) => ({
      ...prev,
      [system]: {
        ...prev[system],
        [field]: value,
      },
    }));
    // Clear errors when user starts typing
    if (formErrors[system]) {
      setFormErrors((prev) => ({
        ...prev,
        [system]: [],
      }));
    }
  };

  const validateForm = (system: string): string[] => {
    const data = formData[system];
    const errors: string[] = [];

    if (system === 'jackhenry') {
      if (!data.baseUrl?.trim()) errors.push('Instance URL is required');
      if (!data.clientId?.trim()) errors.push('Client ID is required');
      if (!data.clientSecret?.trim()) errors.push('Client Secret is required');
    } else if (system === 'sap') {
      if (!data.baseUrl?.trim()) errors.push('Base URL is required');
      if (!data.username?.trim()) errors.push('Username is required');
      if (!data.password?.trim()) errors.push('Password is required');
    }

    return errors;
  };

  const handleFormSubmit = (system: string): void => {
    const errors = validateForm(system);
    if (errors.length > 0) {
      setFormErrors((prev) => ({
        ...prev,
        [system]: errors,
      }));
      return;
    }

    const credentials = formData[system];
    const connectorId = system === 'jackhenry' ? 'jackhenry-silverlake' : 'sap';
    onConnect(connectorId, credentials);

    // Reset form
    setFormData((prev) => ({
      ...prev,
      [system]: (system === 'jackhenry'
        ? { baseUrl: '', clientId: '', clientSecret: '' }
        : { baseUrl: '', username: '', password: '', client: '' }) as CredentialForm,
    }));
    setExpandedSystem(null);
  };

  const handleFetchSchema = (connectorId: string): void => {
    onConnect(connectorId, {});
  };

  const isConnected = (connectorId: string): boolean => {
    return connectedSystems.includes(connectorId);
  };

  const cardStyles = {
    container: {
      display: 'flex' as const,
      gap: '20px',
      padding: '20px',
      backgroundColor: '#f5f5f5',
      borderRadius: '8px',
      flexWrap: 'wrap' as const,
    },
    card: {
      flex: '1 1 calc(33.333% - 14px)',
      minWidth: '300px',
      backgroundColor: 'white',
      border: '1px solid #ddd',
      borderRadius: '8px',
      padding: '20px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    },
    header: {
      display: 'flex' as const,
      alignItems: 'center' as const,
      gap: '12px',
      marginBottom: '16px',
    },
    icon: {
      fontSize: '32px',
    },
    systemName: {
      fontSize: '18px',
      fontWeight: 'bold' as const,
      color: '#333',
      margin: 0,
    },
    badge: (connected: boolean) => ({
      display: 'inline-block' as const,
      padding: '4px 12px',
      borderRadius: '4px',
      fontSize: '12px',
      fontWeight: 'bold' as const,
      marginTop: '8px',
      backgroundColor: connected ? '#4caf50' : '#ccc',
      color: connected ? 'white' : '#666',
    }),
    buttonContainer: {
      display: 'flex' as const,
      gap: '8px',
      marginTop: '12px',
    },
    button: (primary: boolean = false) => ({
      flex: 1,
      padding: '10px 16px',
      border: 'none',
      borderRadius: '4px',
      fontSize: '14px',
      fontWeight: '500' as const,
      cursor: 'pointer',
      backgroundColor: primary ? '#2196f3' : '#e0e0e0',
      color: primary ? 'white' : '#333',
      transition: 'background-color 0.3s',
    }),
    form: {
      marginTop: '16px',
      padding: '12px',
      backgroundColor: '#fafafa',
      borderRadius: '4px',
      border: '1px solid #e0e0e0',
    },
    formGroup: {
      marginBottom: '12px',
      display: 'flex' as const,
      flexDirection: 'column' as const,
    },
    label: {
      fontSize: '12px',
      fontWeight: '600' as const,
      color: '#555',
      marginBottom: '4px',
    },
    input: {
      padding: '8px 10px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      fontSize: '14px',
      fontFamily: 'inherit',
    },
    errorText: {
      color: '#d32f2f',
      fontSize: '12px',
      marginTop: '4px',
    },
    errorsList: {
      backgroundColor: '#ffebee',
      border: '1px solid #ef5350',
      borderRadius: '4px',
      padding: '8px 12px',
      marginBottom: '12px',
    },
    errorItem: {
      color: '#d32f2f',
      fontSize: '12px',
      margin: '4px 0',
    },
  };

  return (
    <div style={cardStyles.container}>
      {/* Salesforce Card */}
      <div style={cardStyles.card}>
        <div style={cardStyles.header}>
          <span style={cardStyles.icon}>☁️</span>
          <h3 style={cardStyles.systemName}>Salesforce</h3>
        </div>
        <div style={cardStyles.badge(isConnected('salesforce'))}>
          {isConnected('salesforce') ? 'Connected' : 'Not connected'}
        </div>
        <div style={cardStyles.buttonContainer}>
          {!isConnected('salesforce') ? (
            <button
              style={cardStyles.button(true)}
              onClick={handleConnectSalesforce}
            >
              Connect via Salesforce
            </button>
          ) : (
            <>
              <button
                style={cardStyles.button(true)}
                onClick={() => handleFetchSchema('salesforce')}
              >
                Fetch Schema
              </button>
              <button
                style={cardStyles.button(false)}
                onClick={() => handleDisconnect('salesforce')}
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>

      {/* Jack Henry Card */}
      <div style={cardStyles.card}>
        <div style={cardStyles.header}>
          <span style={cardStyles.icon}>🏦</span>
          <h3 style={cardStyles.systemName}>Jack Henry</h3>
        </div>
        <div style={cardStyles.badge(isConnected('jackhenry-silverlake'))}>
          {isConnected('jackhenry-silverlake') ? 'Connected' : 'Not connected'}
        </div>

        {!isConnected('jackhenry-silverlake') ? (
          <>
            <button
              style={cardStyles.button(true)}
              onClick={() =>
                setExpandedSystem(
                  expandedSystem === 'jackhenry' ? null : 'jackhenry',
                )
              }
            >
              {expandedSystem === 'jackhenry' ? 'Hide Form' : 'Connect'}
            </button>

            {expandedSystem === 'jackhenry' && (
              <div style={cardStyles.form}>
                {formErrors.jackhenry && formErrors.jackhenry.length > 0 && (
                  <div style={cardStyles.errorsList}>
                    {formErrors.jackhenry.map((err, idx) => (
                      <div key={idx} style={cardStyles.errorItem}>
                        • {err}
                      </div>
                    ))}
                  </div>
                )}

                <div style={cardStyles.formGroup}>
                  <label style={cardStyles.label}>Instance URL *</label>
                  <input
                    style={cardStyles.input}
                    type="text"
                    placeholder="https://api.jackhenry.com"
                    value={formData.jackhenry.baseUrl}
                    onChange={(e) =>
                      handleFormChange('jackhenry', 'baseUrl', e.target.value)
                    }
                  />
                </div>

                <div style={cardStyles.formGroup}>
                  <label style={cardStyles.label}>Client ID *</label>
                  <input
                    style={cardStyles.input}
                    type="text"
                    placeholder="Your Client ID"
                    value={formData.jackhenry.clientId}
                    onChange={(e) =>
                      handleFormChange('jackhenry', 'clientId', e.target.value)
                    }
                  />
                </div>

                <div style={cardStyles.formGroup}>
                  <label style={cardStyles.label}>Client Secret *</label>
                  <input
                    style={cardStyles.input}
                    type="password"
                    placeholder="Your Client Secret"
                    value={formData.jackhenry.clientSecret}
                    onChange={(e) =>
                      handleFormChange(
                        'jackhenry',
                        'clientSecret',
                        e.target.value,
                      )
                    }
                  />
                </div>

                <button
                  style={cardStyles.button(true)}
                  onClick={() => handleFormSubmit('jackhenry')}
                >
                  Submit
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <button
              style={cardStyles.button(true)}
              onClick={() => handleFetchSchema('jackhenry-silverlake')}
            >
              Fetch Schema
            </button>
            <button
              style={cardStyles.button(false)}
              onClick={() => handleDisconnect('jackhenry-silverlake')}
            >
              Disconnect
            </button>
          </>
        )}
      </div>

      {/* SAP Card */}
      <div style={cardStyles.card}>
        <div style={cardStyles.header}>
          <span style={cardStyles.icon}>🔷</span>
          <h3 style={cardStyles.systemName}>SAP</h3>
        </div>
        <div style={cardStyles.badge(isConnected('sap'))}>
          {isConnected('sap') ? 'Connected' : 'Not connected'}
        </div>

        {!isConnected('sap') ? (
          <>
            <button
              style={cardStyles.button(true)}
              onClick={() =>
                setExpandedSystem(expandedSystem === 'sap' ? null : 'sap')
              }
            >
              {expandedSystem === 'sap' ? 'Hide Form' : 'Connect'}
            </button>

            {expandedSystem === 'sap' && (
              <div style={cardStyles.form}>
                {formErrors.sap && formErrors.sap.length > 0 && (
                  <div style={cardStyles.errorsList}>
                    {formErrors.sap.map((err, idx) => (
                      <div key={idx} style={cardStyles.errorItem}>
                        • {err}
                      </div>
                    ))}
                  </div>
                )}

                <div style={cardStyles.formGroup}>
                  <label style={cardStyles.label}>Base URL *</label>
                  <input
                    style={cardStyles.input}
                    type="text"
                    placeholder="https://sap.example.com"
                    value={formData.sap.baseUrl}
                    onChange={(e) =>
                      handleFormChange('sap', 'baseUrl', e.target.value)
                    }
                  />
                </div>

                <div style={cardStyles.formGroup}>
                  <label style={cardStyles.label}>Username *</label>
                  <input
                    style={cardStyles.input}
                    type="text"
                    placeholder="Your username"
                    value={formData.sap.username}
                    onChange={(e) =>
                      handleFormChange('sap', 'username', e.target.value)
                    }
                  />
                </div>

                <div style={cardStyles.formGroup}>
                  <label style={cardStyles.label}>Password *</label>
                  <input
                    style={cardStyles.input}
                    type="password"
                    placeholder="Your password"
                    value={formData.sap.password}
                    onChange={(e) =>
                      handleFormChange('sap', 'password', e.target.value)
                    }
                  />
                </div>

                <div style={cardStyles.formGroup}>
                  <label style={cardStyles.label}>Client (optional)</label>
                  <input
                    style={cardStyles.input}
                    type="text"
                    placeholder="SAP Client number"
                    value={formData.sap.client}
                    onChange={(e) =>
                      handleFormChange('sap', 'client', e.target.value)
                    }
                  />
                </div>

                <button
                  style={cardStyles.button(true)}
                  onClick={() => handleFormSubmit('sap')}
                >
                  Submit
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <button
              style={cardStyles.button(true)}
              onClick={() => handleFetchSchema('sap')}
            >
              Fetch Schema
            </button>
            <button
              style={cardStyles.button(false)}
              onClick={() => handleDisconnect('sap')}
            >
              Disconnect
            </button>
          </>
        )}
      </div>
    </div>
  );
}
