import { AsyncLocalStorage } from 'node:async_hooks';

export type RuntimeLLMProvider = 'openai' | 'anthropic' | 'gemini' | 'custom';

export interface RuntimeLLMConfig {
  useDefault: boolean;
  paused: boolean;
  provider?: RuntimeLLMProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface LLMUsageCapture {
  provider: string;
  model?: string;
  tokensUsed?: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface LLMRuntimeContext {
  llmConfig?: RuntimeLLMConfig;
  usageMeta?: {
    userId?: string;
    projectId?: string;
    requestId?: string;
  };
  onUsage?: (capture: LLMUsageCapture, meta?: LLMRuntimeContext['usageMeta']) => void;
}

const runtimeStore = new AsyncLocalStorage<LLMRuntimeContext>();

export function runWithLLMRuntimeContext<T>(context: LLMRuntimeContext, handler: () => Promise<T>): Promise<T>;
export function runWithLLMRuntimeContext<T>(context: LLMRuntimeContext, handler: () => T): T;
export function runWithLLMRuntimeContext<T>(context: LLMRuntimeContext, handler: () => Promise<T> | T): Promise<T> | T {
  return runtimeStore.run(context, handler);
}

export function getLLMRuntimeContext(): LLMRuntimeContext | undefined {
  return runtimeStore.getStore();
}
