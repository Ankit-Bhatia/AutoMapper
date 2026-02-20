# SAP JSON Schema Format

Upload this format to `POST /api/projects/:id/source-schema`.

```json
{
  "entities": [
    {
      "name": "SAP.Customer",
      "label": "Customer",
      "description": "Optional",
      "fields": [
        {
          "name": "CustomerNumber",
          "label": "Customer No",
          "dataType": "string",
          "length": 10,
          "precision": 0,
          "scale": 0,
          "required": true,
          "isKey": true,
          "picklistValues": ["A", "B"]
        }
      ]
    }
  ],
  "relationships": [
    {
      "fromEntity": "SAP.Customer",
      "toEntity": "SAP.Contact",
      "type": "parentchild",
      "viaField": "CustomerNumber"
    }
  ]
}
```

## Supported dataType values

- `string`, `text`, `number`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `time`, `picklist`, `email`, `phone`, `id`, `reference`, `unknown`
