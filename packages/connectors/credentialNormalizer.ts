import type { ConnectorCredentials } from './IConnector.js';

function firstNonEmpty(
  credentials: ConnectorCredentials,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = credentials[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeJackHenryCredentials(credentials: ConnectorCredentials): ConnectorCredentials {
  const normalized: ConnectorCredentials = { ...credentials };

  // Service Gateway SOAP aliases (accept UI/ops-provided field names as-is).
  const endpoint = firstNonEmpty(credentials, ['endpoint', 'Endpoint', 'serviceGatewayEndpoint']);
  const username = firstNonEmpty(credentials, ['username', 'Username']);
  const password = firstNonEmpty(credentials, ['password', 'Password']);
  const instRtId = firstNonEmpty(credentials, ['instRtId', 'InstRtId']);
  const instEnv = firstNonEmpty(credentials, ['instEnv', 'InstEnv']);
  const validConsmName = firstNonEmpty(credentials, ['validConsmName', 'ValidConsmName']);
  const validConsmProd = firstNonEmpty(credentials, ['validConsmProd', 'ValidConsmProd']);

  if (endpoint) normalized.endpoint = endpoint;
  if (username) normalized.username = username;
  if (password) normalized.password = password;
  if (instRtId) normalized.instRtId = instRtId;
  if (instEnv) normalized.instEnv = instEnv;
  if (validConsmName) normalized.validConsmName = validConsmName;
  if (validConsmProd) normalized.validConsmProd = validConsmProd;

  const hasOAuthCreds = Boolean(
    firstNonEmpty(normalized, ['instanceUrl']) &&
    firstNonEmpty(normalized, ['clientId']) &&
    firstNonEmpty(normalized, ['clientSecret']),
  );
  const hasServiceGatewayCreds = Boolean(
    endpoint && username && password && instRtId && instEnv && validConsmName && validConsmProd,
  );

  // Explicit mode is allowed, otherwise infer from complete credential set.
  const requestedMode = firstNonEmpty(normalized, ['authMode']);
  if (requestedMode === 'service-gateway' || (!requestedMode && hasServiceGatewayCreds && !hasOAuthCreds)) {
    normalized.authMode = 'service-gateway';
  } else if (requestedMode === 'oauth-client-credentials' || (!requestedMode && hasOAuthCreds)) {
    normalized.authMode = 'oauth-client-credentials';
  }

  return normalized;
}

export function normalizeConnectorCredentials(
  connectorId: string,
  credentials: ConnectorCredentials,
): ConnectorCredentials {
  if (!credentials || Object.keys(credentials).length === 0) return credentials;

  if (connectorId.startsWith('jackhenry-')) {
    return normalizeJackHenryCredentials(credentials);
  }

  return credentials;
}

