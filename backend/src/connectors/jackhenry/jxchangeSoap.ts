import { XMLParser } from 'fast-xml-parser';
import type { ConnectorCredentials } from '../IConnector.js';

export interface ServiceGatewayCredentials {
  endpoint: string;
  username: string;
  password: string;
  instRtId: string;
  instEnv: string;
  validConsmName: string;
  validConsmProd: string;
}

export interface SvcDictFieldCandidate {
  name: string;
  dataType?: string;
  jxchangeXPath?: string;
  sourceService?: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function stripNs(tag: string): string {
  const i = tag.indexOf(':');
  return i >= 0 ? tag.slice(i + 1) : tag;
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['#text', '__text', 'value']) {
      const v = record[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return undefined;
}

function findFirstByTag(root: unknown, tagName: string): unknown {
  if (!root || typeof root !== 'object') return undefined;
  const record = root as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (stripNs(key) === tagName) return value;
    const nested = findFirstByTag(value, tagName);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function walkObjects(root: unknown, visitor: (node: Record<string, unknown>) => void): void {
  if (!root) return;
  if (Array.isArray(root)) {
    for (const item of root) walkObjects(item, visitor);
    return;
  }
  if (typeof root !== 'object') return;
  const record = root as Record<string, unknown>;
  visitor(record);
  for (const value of Object.values(record)) {
    walkObjects(value, visitor);
  }
}

function normalizeDataType(input?: string): string | undefined {
  if (!input) return undefined;
  const v = input.toLowerCase();
  if (v.includes('date') && v.includes('time')) return 'datetime';
  if (v.includes('date')) return 'date';
  if (v.includes('time')) return 'datetime';
  if (v.includes('bool')) return 'boolean';
  if (v.includes('int')) return 'number';
  if (v.includes('decimal') || v.includes('money') || v.includes('amount') || v.includes('numeric')) return 'decimal';
  if (v.includes('code')) return 'string';
  if (v.includes('name')) return 'string';
  return 'string';
}

function toFieldCandidate(node: Record<string, unknown>, sourceService: string): SvcDictFieldCandidate | null {
  const keys = Object.keys(node);
  const lowered = new Map(keys.map((k) => [stripNs(k).toLowerCase(), k]));

  const nameKey =
    lowered.get('elemname') ??
    lowered.get('fieldname') ??
    lowered.get('name') ??
    lowered.get('dataname') ??
    lowered.get('xpath') ??
    lowered.get('path');
  if (!nameKey) return null;

  const rawName = textOf(node[nameKey]);
  if (!rawName) return null;
  if (rawName.length > 200) return null;

  const pathKey =
    lowered.get('xpath') ??
    lowered.get('path') ??
    lowered.get('elempath') ??
    lowered.get('msgpath');
  const typeKey =
    lowered.get('datatype') ??
    lowered.get('type') ??
    lowered.get('elemtype') ??
    lowered.get('fldtype');

  const jxchangeXPath = pathKey ? textOf(node[pathKey]) : undefined;
  const fieldName =
    rawName.includes('.') ? rawName.split('.').pop() ?? rawName : rawName;

  if (!/^[A-Za-z_][A-Za-z0-9_]{1,120}$/.test(fieldName)) return null;

  return {
    name: fieldName,
    dataType: normalizeDataType(typeKey ? textOf(node[typeKey]) : undefined),
    jxchangeXPath,
    sourceService,
  };
}

export function buildSvcDictSrchEnvelope(credentials: ServiceGatewayCredentials, serviceName: string): string {
  const created = new Date().toISOString();
  const nonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64');
  // Minimal jXchange SvcDictSrch request for schema dictionary discovery.
  // This is intentionally conservative and may need institution-specific flags.
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:jx="http://jackhenry.com/jxchange/TPG/2008" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <soapenv:Header>
    <wsse:Security soapenv:mustUnderstand="1">
      <wsse:UsernameToken>
        <wsse:Username>${xmlEscape(credentials.username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${xmlEscape(credentials.password)}</wsse:Password>
        <wsse:Nonce>${xmlEscape(nonce)}</wsse:Nonce>
        <wsu:Created>${xmlEscape(created)}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <jx:SvcDictSrch>
      <jx:MsgRqHdr>
        <jx:jXLogTrackingId>${xmlEscape(`AutoMapper-${Date.now()}`)}</jx:jXLogTrackingId>
        <jx:InstRtId>${xmlEscape(credentials.instRtId)}</jx:InstRtId>
        <jx:InstEnv>${xmlEscape(credentials.instEnv)}</jx:InstEnv>
        <jx:ValidConsmName>${xmlEscape(credentials.validConsmName)}</jx:ValidConsmName>
        <jx:ValidConsmProd>${xmlEscape(credentials.validConsmProd)}</jx:ValidConsmProd>
      </jx:MsgRqHdr>
      <jx:SvcDictSrchRq>
        <jx:SvcName>${xmlEscape(serviceName)}</jx:SvcName>
      </jx:SvcDictSrchRq>
    </jx:SvcDictSrch>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export async function postServiceGatewaySoap(
  creds: ServiceGatewayCredentials,
  envelopeXml: string,
  soapAction?: string,
): Promise<string> {
  const response = await fetch(creds.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`,
      'Content-Type': 'text/xml; charset=utf-8',
      Accept: 'text/xml, application/soap+xml, */*',
      ...(soapAction ? { SOAPAction: soapAction } : {}),
    },
    body: envelopeXml,
    signal: AbortSignal.timeout(15000),
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`SOAP HTTP ${response.status}: ${xml.slice(0, 240)}`);
  }
  return xml;
}

export function parseSvcDictSrchFields(xml: string, sourceService: string): SvcDictFieldCandidate[] {
  const parsed = xmlParser.parse(xml) as unknown;
  const fault = findFirstByTag(parsed, 'Fault');
  if (fault) {
    const faultText = textOf(findFirstByTag(fault, 'faultstring')) || textOf(findFirstByTag(fault, 'Reason')) || 'SOAP Fault';
    throw new Error(faultText);
  }

  const body = findFirstByTag(parsed, 'Body') ?? parsed;
  const responseRoot =
    findFirstByTag(body, 'SvcDictSrchResponse') ??
    findFirstByTag(body, 'SvcDictSrchRs') ??
    body;

  const seen = new Set<string>();
  const out: SvcDictFieldCandidate[] = [];

  walkObjects(responseRoot, (node) => {
    const candidate = toFieldCandidate(node, sourceService);
    if (!candidate) return;
    const key = `${candidate.name}|${candidate.jxchangeXPath ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  });

  return out;
}

export function toServiceGatewayCredentials(
  credentials: ConnectorCredentials | Record<string, unknown>,
): ServiceGatewayCredentials | null {
  const c = credentials as Record<string, unknown>;
  const endpoint = typeof c.endpoint === 'string' ? c.endpoint : undefined;
  const username = typeof c.username === 'string' ? c.username : undefined;
  const password = typeof c.password === 'string' ? c.password : undefined;
  const instRtId = typeof c.instRtId === 'string' ? c.instRtId : undefined;
  const instEnv = typeof c.instEnv === 'string' ? c.instEnv : undefined;
  const validConsmName = typeof c.validConsmName === 'string' ? c.validConsmName : undefined;
  const validConsmProd = typeof c.validConsmProd === 'string' ? c.validConsmProd : undefined;

  if (!endpoint || !username || !password || !instRtId || !instEnv || !validConsmName || !validConsmProd) {
    return null;
  }

  return { endpoint, username, password, instRtId, instEnv, validConsmName, validConsmProd };
}

export function mergeConnectorFields(
  baseFields: Array<{ name: string; dataType?: string } & Record<string, unknown>>,
  liveFields: SvcDictFieldCandidate[],
): Array<{ name: string; dataType?: string } & Record<string, unknown>> {
  if (liveFields.length === 0) return baseFields;

  const byName = new Map<string, SvcDictFieldCandidate>(
    liveFields.map((f) => [f.name.toLowerCase(), f]),
  );

  return baseFields.map((field) => {
    const live = byName.get(String(field.name).toLowerCase());
    if (!live) return field;
    return {
      ...field,
      dataType: field.dataType ?? live.dataType,
      jxchangeXPath:
        typeof field.jxchangeXPath === 'string' && field.jxchangeXPath
          ? field.jxchangeXPath
          : live.jxchangeXPath,
    };
  });
}

export function objectToSvcName(objectName: string): string | null {
  switch (objectName) {
    case 'CIF':
      return 'CustInq';
    case 'DDA':
    case 'Certificate':
    case 'LineOfCredit':
      return 'AcctInq';
    case 'LoanAccount':
      return 'LnBilSrch';
    case 'GLAccount':
      return 'GLInq';
    default:
      return null;
  }
}
