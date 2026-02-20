import type { Entity, Field } from '../types.js';

export interface AiFieldSuggestion {
  sourceFieldName: string;
  targetFieldName: string;
  confidence: number;
  rationale: string;
  transformType?: string;
  transformConfig?: Record<string, unknown>;
}

export interface AiEntitySuggestion {
  sourceEntityName: string;
  targetEntityName: string;
  confidence: number;
  rationale: string;
  fields: AiFieldSuggestion[];
}

export async function getAiSuggestions(
  sourceEntity: Entity,
  sourceFields: Field[],
  targetEntity: Entity,
  targetFields: Field[],
): Promise<AiEntitySuggestion | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = {
    sourceEntity,
    targetEntity,
    sourceFields: sourceFields.map((f) => ({ name: f.name, label: f.label, dataType: f.dataType })),
    targetFields: targetFields.map((f) => ({ name: f.name, label: f.label, dataType: f.dataType })),
    task: 'Suggest SAP-to-Salesforce field mappings with confidence and rationale as strict JSON.',
  };

  const response = await fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Return valid JSON with shape {confidence:number,rationale:string,fields:[{sourceFieldName,targetFieldName,confidence,rationale,transformType,transformConfig}]}.',
        },
        { role: 'user', content: JSON.stringify(prompt) },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as any;
  const content = body?.choices?.[0]?.message?.content;
  if (!content) return null;

  const parsed = JSON.parse(content);
  return {
    sourceEntityName: sourceEntity.name,
    targetEntityName: targetEntity.name,
    confidence: Number(parsed.confidence ?? 0.5),
    rationale: String(parsed.rationale ?? 'AI-assisted match'),
    fields: Array.isArray(parsed.fields)
      ? parsed.fields.map((f: any) => ({
          sourceFieldName: String(f.sourceFieldName),
          targetFieldName: String(f.targetFieldName),
          confidence: Number(f.confidence ?? 0.5),
          rationale: String(f.rationale ?? ''),
          transformType: f.transformType,
          transformConfig: f.transformConfig,
        }))
      : [],
  };
}
