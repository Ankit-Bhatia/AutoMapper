import { describe, expect, it } from 'vitest';
import { normalizeConnectorCredentials } from '../connectors/credentialNormalizer.js';

describe('normalizeConnectorCredentials', () => {
  it('normalizes Jack Henry Service Gateway credential aliases and infers auth mode', () => {
    const normalized = normalizeConnectorCredentials('jackhenry-silverlake', {
      Endpoint: 'https://example.test/ServiceGateway.svc',
      Username: 'svc-user',
      Password: 'secret',
      InstRtId: '011001276',
      InstEnv: 'Ovation',
      ValidConsmName: 'TrialKSquare',
      ValidConsmProd: 'TrialSalesforce',
    });

    expect(normalized.endpoint).toBe('https://example.test/ServiceGateway.svc');
    expect(normalized.username).toBe('svc-user');
    expect(normalized.password).toBe('secret');
    expect(normalized.instRtId).toBe('011001276');
    expect(normalized.instEnv).toBe('Ovation');
    expect(normalized.validConsmName).toBe('TrialKSquare');
    expect(normalized.validConsmProd).toBe('TrialSalesforce');
    expect(normalized.authMode).toBe('service-gateway');
  });

  it('leaves non-Jack-Henry credentials unchanged', () => {
    const credentials = { username: 'alice', password: 'pw' };
    expect(normalizeConnectorCredentials('sap', credentials)).toEqual(credentials);
  });

  it('normalizes Core Director Service Gateway aliases as well', () => {
    const normalized = normalizeConnectorCredentials('jackhenry-coredirector', {
      Endpoint: 'https://example.test/cd/ServiceGateway.svc',
      Username: 'cd-user',
      Password: 'cd-secret',
      InstRtId: '11111900',
      InstEnv: 'Ovation',
      ValidConsmName: 'TrialKSquare',
      ValidConsmProd: 'TrialSalesforce',
    });

    expect(normalized.endpoint).toContain('ServiceGateway.svc');
    expect(normalized.instRtId).toBe('11111900');
    expect(normalized.authMode).toBe('service-gateway');
  });
});
