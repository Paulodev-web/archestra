/**
 * Mock OpenAI Client for Benchmarking
 *
 * Returns immediate responses without making actual API calls.
 * Used for benchmarking Archestra platform overhead without network latency.
 * Generates realistic, varied token counts for metrics testing.
 */

import type OpenAI from "openai";

/**
 * Generate realistic random token counts
 */
function generateTokenCounts() {
  // Typical prompt tokens: 50-500
  const promptTokens = Math.floor(Math.random() * 450) + 50;
  // Typical completion tokens: 20-200
  const completionTokens = Math.floor(Math.random() * 180) + 20;
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
  chat = {
    completions: {
      create: async (
        params: OpenAI.Chat.Completions.ChatCompletionCreateParams,
      ) => {
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
