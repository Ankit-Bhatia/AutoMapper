import { describe, expect, it } from 'vitest';
import {
  buildSvcDictSrchEnvelope,
  objectToSvcName,
  parseSvcDictSrchFields,
} from '../connectors/jackhenry/jxchangeSoap.js';

describe('jxchangeSoap helpers', () => {
  it('builds a SvcDictSrch SOAP envelope with service gateway header fields', () => {
    const xml = buildSvcDictSrchEnvelope(
      {
        endpoint: 'https://example.test/ServiceGateway.svc',
        username: 'user',
        password: 'pass',
        instRtId: '11111900',
        instEnv: 'TEST',
        validConsmName: 'TrialKSquare',
        validConsmProd: 'TrialSalesforce',
      },
      'CustInq',
    );

    expect(xml).toContain('<jx:SvcDictSrch>');
    expect(xml).toContain('<jx:SvcName>CustInq</jx:SvcName>');
    expect(xml).toContain('<jx:InstRtId>11111900</jx:InstRtId>');
  });

  it('parses candidate fields from a SvcDictSrch SOAP response', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <SvcDictSrchResponse xmlns="http://jackhenry.com/jxchange/TPG/2008">
      <SvcDictSrchRs>
        <DictElemArray>
          <DictElemRec>
            <ElemName>CustId</ElemName>
            <DataType>String</DataType>
            <XPath>CustInq.Rs.CustRec.CustId</XPath>
          </DictElemRec>
          <DictElemRec>
            <ElemName>OpenDt</ElemName>
            <DataType>Date</DataType>
            <XPath>CustInq.Rs.CustRec.PersonInfo.OpenDt</XPath>
          </DictElemRec>
        </DictElemArray>
      </SvcDictSrchRs>
    </SvcDictSrchResponse>
  </soap:Body>
</soap:Envelope>`;

    const fields = parseSvcDictSrchFields(xml, 'CustInq');
    expect(fields.length).toBeGreaterThanOrEqual(2);
    expect(fields.some((f) => f.name === 'CustId' && f.jxchangeXPath?.includes('CustRec.CustId'))).toBe(true);
    expect(fields.some((f) => f.name === 'OpenDt' && f.dataType === 'date')).toBe(true);
  });

  it('maps object names to SvcDict services', () => {
    expect(objectToSvcName('CIF')).toBe('CustInq');
    expect(objectToSvcName('DDA')).toBe('AcctInq');
    expect(objectToSvcName('LoanAccount')).toBe('LnBilSrch');
    expect(objectToSvcName('GLAccount')).toBe('GLInq');
    expect(objectToSvcName('UnknownThing')).toBeNull();
  });
});

