import type { CommonToolResult } from "./tool-execution";

/**
 * Common message format for evaluating trusted data
 * Only includes the information needed for trusted data evaluation
 */
export interface CommonMessage {
  /** Message role */
  role: "user" | "assistant" | "tool" | "system" | "model" | "function";
  /** Tool calls if this message contains them */
  toolCalls?: CommonToolResult[];
}

/**
 * Result of evaluating trusted data policies
 * Maps tool call IDs to their updated content (if modified)
 */
export type ToolResultUpdates = Record<string, string>;

/**
 * Parameters for creating a DualLlmSubagent in a provider-agnostic way
 */
export interface CommonDualLlmParams {
  /** The tool call ID for tracking */
  toolCallId: string;
  /** The original user request */
  userRequest: string;
  /** The tool result to be analyzed */
  toolResult: unknown;
  /** The tool name */
  toolName: string;
  /** The tool input schema (parameters) */
  // biome-ignore lint/suspicious/noExplicitAny: tool schemas can be any shape
  toolInputSchema?: any;
}
