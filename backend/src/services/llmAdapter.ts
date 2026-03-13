import type { Entity, Field } from '../types.js';
import { activeProvider, llmComplete } from '../agents/llm/LLMGateway.js';

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
  if (activeProvider() === 'heuristic') return null;

  const prompt = {
    sourceEntity,
    targetEntity,
    sourceFields: sourceFields.map((f) => ({ name: f.name, label: f.label, dataType: f.dataType })),
    targetFields: targetFields.map((f) => ({ name: f.name, label: f.label, dataType: f.dataType })),
    task: 'Suggest SAP-to-Salesforce field mappings with confidence and rationale as strict JSON.',
  };

  let response: Awaited<ReturnType<typeof llmComplete>>;
  try {
    response = await llmComplete([
      {
        role: 'system',
        content:
          'Return valid JSON with shape {confidence:number,rationale:string,fields:[{sourceFieldName,targetFieldName,confidence,rationale,transformType,transformConfig}]}.',
      },
      { role: 'user', content: JSON.stringify(prompt) },
    ]);
  } catch {
    return null;
  }
  if (!response?.content) return null;

  const parsed = parseJsonPayload(response.content);
  if (!parsed || typeof parsed !== 'object') return null;

  const fieldsRaw = parsed['fields'];
  const parsedFields = Array.isArray(fieldsRaw) ? fieldsRaw : [];
  return {
    sourceEntityName: sourceEntity.name,
    targetEntityName: targetEntity.name,
    confidence: Number(parsed['confidence'] ?? 0.5),
    rationale: String(parsed['rationale'] ?? 'AI-assisted match'),
    fields: parsedFields
      .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
      .map((f) => ({
          sourceFieldName: String(f['sourceFieldName'] ?? ''),
          targetFieldName: String(f['targetFieldName'] ?? ''),
          confidence: Number(f['confidence'] ?? 0.5),
          rationale: String(f['rationale'] ?? ''),
          transformType: typeof f['transformType'] === 'string' ? f['transformType'] : undefined,
          transformConfig: isObject(f['transformConfig']) ? f['transformConfig'] : undefined,
        })),
  };
}

function parseJsonPayload(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const normalized = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed;

  try {
    const parsed = JSON.parse(normalized) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      const parsed = JSON.parse(normalized.slice(start, end + 1)) as unknown;
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
