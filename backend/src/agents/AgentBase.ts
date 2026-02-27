/**
 * AgentBase — abstract base class for all AutoMapper agents.
 *
 * Every agent must implement run(context) and declare a name.
 * Agents emit steps via context.onStep for SSE streaming.
 */
import type { AgentContext, AgentResult, AgentStep } from './types.js';

export abstract class AgentBase {
  /** Unique human-readable name used in step events and logs */
  abstract readonly name: string;

  /**
   * Execute the agent against the provided context.
   * Must never throw — catch internally and return error as a step.
   */
  abstract run(context: AgentContext): Promise<AgentResult>;

  /**
   * Emit a step event. Call this inside run() for each meaningful action.
   */
  protected emit(context: AgentContext, step: Omit<AgentStep, 'agentName'>): void {
    const full: AgentStep = { agentName: this.name, ...step };
    context.onStep?.(full);
  }

  /**
   * Convenience: emit a simple informational step with no mapping change.
   */
  protected info(
    context: AgentContext,
    action: string,
    detail: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.emit(context, { action, detail, durationMs: 0, metadata });
  }

  /**
   * Build an empty AgentResult (useful as default / no-op return).
   */
  protected noOp(fieldMappings: AgentContext['fieldMappings']): AgentResult {
    return {
      agentName: this.name,
      updatedFieldMappings: fieldMappings,
      steps: [],
      totalImproved: 0,
    };
  }
}
