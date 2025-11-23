/**
 * Mock OpenAI Client for Benchmarking
 *
 * Returns immediate responses without making actual API calls.
 * Used for benchmarking Archestra platform overhead without network latency.
 * Generates realistic, varied token counts for metrics testing.
 *
 * Demo characteristics:
 * - Slower & less efficient (higher latency, more tokens)
 * - MORE reliable (~2% error rate) - rock solid, enterprise-grade
 */

import type OpenAI from "openai";
import type { Agent } from "@/types";
import * as llmMetrics from "@/llm-metrics";

/**
 * Simulate errors for demo - OpenAI is more reliable
 */
function shouldSimulateError(): { error: boolean; type?: string } {
  const random = Math.random();

  // 2% error rate (vs Anthropic's 8%)
  if (random < 0.02) {
    // Mostly just rate limits, rarely other errors
    if (random < 0.015) {
      return { error: true, type: "rate_limit" };
    }
    return { error: true, type: "timeout" };
  }

  return { error: false };
}

/**
 * Simulate network latency - OpenAI is slower but consistent
 */
async function simulateLatency() {
  // OpenAI: 200-500ms (slower than Anthropic but very consistent)
  const latency = Math.floor(Math.random() * 300) + 200;
  await new Promise(resolve => setTimeout(resolve, latency));
}

/**
 * Generate realistic random token counts with time-based variation
 * OpenAI uses more tokens but has different pattern than Anthropic
 */
function generateTokenCounts() {
  const now = Date.now();

  // Different wave pattern than Anthropic (period ~15 seconds)
  // Creates visually distinct peaks/valleys
  const wavePattern = Math.cos(now / 15000) * 0.15 + 1; // Oscillates 0.85-1.15

  // Higher token usage than Anthropic (less efficient)
  // Prompt tokens: 50-500 (unchanged base)
  const basePromptTokens = Math.floor(Math.random() * 450) + 50;
  const promptTokens = Math.floor(basePromptTokens * wavePattern);

  // Completion tokens: 20-200 (unchanged base)
  const baseCompletionTokens = Math.floor(Math.random() * 180) + 20;
  const completionTokens = Math.floor(baseCompletionTokens * wavePattern);

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

function generateMockResponse(): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: `chatcmpl-mock${Math.random().toString(36).substring(7)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            "This is a mock response for testing metrics without making real API calls.",
          refusal: null,
        },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: generateTokenCounts(),
  };
}

function generateMockStreamingChunks(): OpenAI.Chat.Completions.ChatCompletionChunk[] {
  const chunkId = `chatcmpl-mock${Math.random().toString(36).substring(7)}`;
  const created = Math.floor(Date.now() / 1000);
  const usage = generateTokenCounts();

  return [
    {
      id: chunkId,
      object: "chat.completion.chunk",
      created,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "" },
          finish_reason: null,
          logprobs: null,
        },
      ],
    },
    {
      id: chunkId,
      object: "chat.completion.chunk",
      created,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          delta: { content: "This is " },
          finish_reason: null,
          logprobs: null,
        },
      ],
    },
    {
      id: chunkId,
      object: "chat.completion.chunk",
      created,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          delta: { content: "a mock streaming response." },
          finish_reason: null,
          logprobs: null,
        },
      ],
    },
    {
      id: chunkId,
      object: "chat.completion.chunk",
      created,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage, // Include usage in final chunk for metrics
    },
  ];
}

/**
 * Mock OpenAI Client that returns immediate responses with realistic token counts
 */
export class MockOpenAIClient {
  private agent: Agent | null = null;

  setAgent(agent: Agent) {
    this.agent = agent;
  }

  chat = {
    completions: {
      create: async (
        params: OpenAI.Chat.Completions.ChatCompletionCreateParams,
      ) => {
        const startTime = Date.now();

        // Simulate latency
        await simulateLatency();

        // Simulate errors
        const errorCheck = shouldSimulateError();
        if (errorCheck.error) {
          // Record error metrics
          if (this.agent) {
            const duration = (Date.now() - startTime) / 1000;
            const statusCode = errorCheck.type === "rate_limit" ? 429 : 408;
            llmMetrics.reportLLMDuration("openai", this.agent, duration, statusCode);
          }

          const error: any = new Error(
            errorCheck.type === "rate_limit"
              ? "Rate limit exceeded"
              : "Request timeout"
          );
          error.status = errorCheck.type === "rate_limit" ? 429 : 408;
          error.code = errorCheck.type === "rate_limit" ? "rate_limit_exceeded" : "timeout";
          throw error;
        }

        // Record success metrics
        if (this.agent) {
          const duration = (Date.now() - startTime) / 1000;
          llmMetrics.reportLLMDuration("openai", this.agent, duration, 200);
        }

        // Mock response in chat streaming mode
        if (params.stream) {
          const chunks = generateMockStreamingChunks();
          return {
            [Symbol.asyncIterator]() {
              let index = 0;
              return {
                async next() {
                  if (index < chunks.length) {
                    return {
                      value: chunks[index++],
                      done: false,
                    };
                  }
                  return { done: true };
                },
              };
            },
          };
          // Mock response in regular mode
        } else {
          return generateMockResponse();
        }
      },
    },
  };

}
