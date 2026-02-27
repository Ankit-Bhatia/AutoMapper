import { describe, expect, it } from 'vitest';
import { parseUploadedSchema } from '../services/schemaUploadParser.js';

const SYSTEM_ID = 'sys-upload-test';

describe('parseUploadedSchema', () => {
  it('parses explicit schema JSON payload', () => {
    const content = JSON.stringify({
      entities: [
        {
          name: 'Customer',
          fields: [
            { name: 'Id', dataType: 'id', required: true, isKey: true },
            { name: 'Name', dataType: 'string' },
          ],
        },
      ],
    });
    const parsed = parseUploadedSchema(content, 'schema.json', SYSTEM_ID);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.fields.some((f) => f.name === 'Name')).toBe(true);
  });

  it('infers schema from tabular CSV data when entity/field format is absent', () => {
    const csv = `AccountId,AccountName,Balance\nA100,Acme,42.10\nA200,Beta,99.00`;
    const parsed = parseUploadedSchema(csv, 'accounts.csv', SYSTEM_ID);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['AccountId', 'AccountName', 'Balance']));
  });

  it('infers schema from JSON array of records', () => {
    const json = JSON.stringify([
      { id: '1', email: 'a@example.com', active: true },
      { id: '2', email: 'b@example.com', active: false },
    ]);
    const parsed = parseUploadedSchema(json, 'contacts.json', SYSTEM_ID);
    expect(parsed.entities).toHaveLength(1);
    const email = parsed.fields.find((f) => f.name === 'email');
    expect(email?.dataType).toBe('email');
  });
});

