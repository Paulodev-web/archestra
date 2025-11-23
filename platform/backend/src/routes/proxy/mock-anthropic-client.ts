/**
 * Mock Anthropic Client for Benchmarking
 *
 * Returns immediate responses without making actual API calls.
 * Used for benchmarking Archestra platform overhead without network latency.
 * Generates realistic, varied token counts for metrics testing.
 *
 * Demo characteristics:
 * - Fast & efficient (lower latency, fewer tokens)
 * - LESS reliable (~8-10% error rate) - shows real-world trade-offs
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Agent } from "@/types";
import * as llmMetrics from "@/llm-metrics";

/**
 * Simulate errors for demo - Anthropic is less reliable
 */
function shouldSimulateError(): { error: boolean; type?: string } {
  const random = Math.random();

  // 8% error rate (vs OpenAI's 2%)
  if (random < 0.08) {
    // Different error types
    if (random < 0.03) {
      return { error: true, type: "overloaded" };
    }
    if (random < 0.06) {
      return { error: true, type: "rate_limit" };
    }
    return { error: true, type: "timeout" };
  }

  return { error: false };
}

/**
 * Simulate network latency - Anthropic is faster
 */
async function simulateLatency() {
  // Anthropic: 100-300ms (faster than OpenAI)
  const latency = Math.floor(Math.random() * 200) + 100;
  await new Promise(resolve => setTimeout(resolve, latency));
}

/**
 * Generate realistic random token counts with time-based variation
 * Anthropic performs better with:
 * - Lower average token usage (more efficient)
 * - Time-based patterns creating different peaks/valleys for demo visualization
 */
function generateTokenCounts(): Anthropic.Messages.Usage {
  // Create time-based variation using sine wave for interesting patterns
  const now = Date.now();
  const hourOfDay = new Date(now).getHours();

  // Efficiency factor: Claude performs better during peak hours (9-17)
  // More efficient = lower tokens for same task
  const isPeakHours = hourOfDay >= 9 && hourOfDay <= 17;
  const efficiencyMultiplier = isPeakHours ? 0.6 : 0.75; // 40% more efficient during peak

  // Add wave pattern for visual interest (period ~10 seconds for demo)
  const wavePattern = Math.sin(now / 10000) * 0.2 + 1; // Oscillates 0.8-1.2

  // Anthropic: Lower base ranges showing better efficiency
  // Base: 30-350 (vs OpenAI's 50-500)
  const baseInputTokens = Math.floor(Math.random() * 320) + 30;
  const inputTokens = Math.floor(baseInputTokens * efficiencyMultiplier * wavePattern);

  // Base output: 15-120 (vs OpenAI's 20-200)
  const baseOutputTokens = Math.floor(Math.random() * 105) + 15;
  const outputTokens = Math.floor(baseOutputTokens * efficiencyMultiplier * wavePattern);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

const MOCK_RESPONSE: Anthropic.Message = {
  id: "msg-mock123",
  type: "message",
  role: "assistant",
  content: [
    {
      type: "text",
      text: "Hello! How can I help you today?",
      citations: [],
    } as Anthropic.Messages.TextBlock,
  ],
  model: "claude-3-5-sonnet-20241022",
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: generateTokenCounts(),
};

/**
 * Mock Anthropic Client that returns immediate responses
 */
export class MockAnthropicClient {
  private agent: Agent | null = null;

  setAgent(agent: Agent) {
    this.agent = agent;
  }

  messages = {
    stream: async (
      params: Anthropic.Messages.MessageCreateParams,
    ): Promise<Anthropic.Messages.MessageStream> => {
      const startTime = Date.now();

      // Simulate latency
      await simulateLatency();

      // Simulate errors
      const errorCheck = shouldSimulateError();
      if (errorCheck.error) {
        // Record error metrics
        if (this.agent) {
          const duration = (Date.now() - startTime) / 1000;
          const statusCodeMap = {
            overloaded: 529,
            rate_limit: 429,
            timeout: 408,
          };
          const statusCode = statusCodeMap[errorCheck.type as keyof typeof statusCodeMap] || 500;
          llmMetrics.reportLLMDuration("anthropic", this.agent, duration, statusCode);
        }

        const errorMessages = {
          overloaded: "overloaded_error",
          rate_limit: "rate_limit_error",
          timeout: "timeout_error",
        };
        throw new Error(errorMessages[errorCheck.type as keyof typeof errorMessages] || "api_error");
      }

      // Record success metrics
      if (this.agent) {
        const duration = (Date.now() - startTime) / 1000;
        llmMetrics.reportLLMDuration("anthropic", this.agent, duration, 200);
      }

      const usage = generateTokenCounts();
      const chunks: Anthropic.Messages.MessageStreamEvent[] = [
        {
          type: "message_start",
          message: {
            id: "msg-mock123",
            type: "message",
            role: "assistant",
            content: [],
            model: params.model,
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: usage.input_tokens,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            } as Anthropic.Messages.Usage,
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "text",
            text: "",
            citations: [],
          } as Anthropic.Messages.TextBlock,
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello! " },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            text: "How can I help you today?",
          },
        },
        {
          type: "content_block_stop",
          index: 0,
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: {
            output_tokens: usage.output_tokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          } as Anthropic.Messages.MessageDeltaUsage,
        },
        {
          type: "message_stop",
        },
      ];

      let index = 0;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (index < chunks.length) {
                return {
                  value: chunks[index++],
                  done: false,
                };
              }
              return { done: true, value: undefined };
            },
          };
        },
      } as Anthropic.Messages.MessageStream;
    },
    create: async (
      params: Anthropic.Messages.MessageCreateParams,
    ): Promise<Anthropic.Message> => {
      const startTime = Date.now();

      // Simulate latency
      await simulateLatency();

      // Simulate errors
      const errorCheck = shouldSimulateError();
      if (errorCheck.error) {
        // Record error metrics
        if (this.agent) {
          const duration = (Date.now() - startTime) / 1000;
          const statusCodeMap = {
            overloaded: 529,
            rate_limit: 429,
            timeout: 408,
          };
          const statusCode = statusCodeMap[errorCheck.type as keyof typeof statusCodeMap] || 500;
          llmMetrics.reportLLMDuration("anthropic", this.agent, duration, statusCode);
        }

        const errorMessages = {
          overloaded: "overloaded_error",
          rate_limit: "rate_limit_error",
          timeout: "timeout_error",
        };
        throw new Error(errorMessages[errorCheck.type as keyof typeof errorMessages] || "api_error");
      }

      // Record success metrics
      if (this.agent) {
        const duration = (Date.now() - startTime) / 1000;
        llmMetrics.reportLLMDuration("anthropic", this.agent, duration, 200);
      }

      // Mock streaming mode
      if (params.stream) {
        // Return a mock stream
        const usage = generateTokenCounts();
        return {
          [Symbol.asyncIterator]() {
            let index = 0;
            const chunks: Anthropic.Messages.MessageStreamEvent[] = [
              {
                type: "message_start",
                message: {
                  id: "msg-mock123",
                  type: "message",
                  role: "assistant",
                  content: [],
                  model: params.model,
                  stop_reason: null,
                  stop_sequence: null,
                  usage: {
                    input_tokens: usage.input_tokens,
                    output_tokens: 0,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                  } as Anthropic.Messages.Usage,
                },
              },
              {
                type: "content_block_start",
                index: 0,
                content_block: {
                  type: "text",
                  text: "",
                  citations: [],
                } as Anthropic.Messages.TextBlock,
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: "Hello! " },
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: {
                  type: "text_delta",
                  text: "How can I help you today?",
                },
              },
              {
                type: "content_block_stop",
                index: 0,
              },
              {
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: {
                  output_tokens: usage.output_tokens,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0,
                } as Anthropic.Messages.MessageDeltaUsage,
              },
              {
                type: "message_stop",
              },
            ];

            return {
              async next() {
                if (index < chunks.length) {
                  return {
                    value: chunks[index++],
                    done: false,
                  };
                }
                return { done: true, value: undefined };
              },
            };
          },
        } as unknown as Anthropic.Message;
      }

      // Mock regular mode
      return MOCK_RESPONSE;
    },
  };
}
