import logger from "@/logging";
import { DualLlmConfigModel, DualLlmResultModel } from "@/models";
import type {
  CommonDualLlmParams,
  DualLlmConfig,
  DualLlmMessage,
  SupportedProvider,
} from "@/types";
import { createDualLlmClient, type DualLlmClient } from "./dual-llm-client";

/**
 * DualLlmSubagent implements the dual LLM quarantine pattern for safely
 * extracting information from untrusted data sources.
 *
 * Pattern:
 * - Main Agent (privileged): Formulates questions, has no access to untrusted data
 * - Quarantined Agent: Has access to untrusted data, can only answer multiple choice
 * - Information flows through structured Q&A, preventing prompt injection
 */
export class DualLlmSubagent {
  config: DualLlmConfig; // Configuration loaded from database
  agentId: string; // The agent ID for tracking
  toolCallId: string; // The tool call ID for tracking
  llmClient: DualLlmClient; // LLM client instance
  originalUserRequest: string; // Extracted user request
  toolResult: unknown; // Extracted tool result
  toolName: string; // The tool name
  // biome-ignore lint/suspicious/noExplicitAny: tool schemas can be any shape
  toolInputSchema?: any; // The tool input schema (parameters)
  quarantinedMemory: Map<string, unknown>; // Shared quarantined memory across all subagents

  private constructor(
    config: DualLlmConfig,
    agentId: string,
    toolCallId: string,
    llmClient: DualLlmClient,
    originalUserRequest: string,
    toolResult: unknown,
    toolName: string,
    // biome-ignore lint/suspicious/noExplicitAny: tool schemas can be any shape
    toolInputSchema?: any,
    quarantinedMemory: Map<string, unknown> = new Map(),
  ) {
    this.config = config;
    this.agentId = agentId;
    this.toolCallId = toolCallId;
    this.llmClient = llmClient;
    this.originalUserRequest = originalUserRequest;
    this.toolResult = toolResult;
    this.toolName = toolName;
    this.toolInputSchema = toolInputSchema;
    this.quarantinedMemory = quarantinedMemory;
  }

  static async create(
    params: CommonDualLlmParams,
    agentId: string,
    apiKey: string,
    provider: SupportedProvider,
    quarantinedMemory?: Map<string, unknown>,
  ): Promise<DualLlmSubagent> {
    return new DualLlmSubagent(
      await DualLlmConfigModel.getDefault(),
      agentId,
      params.toolCallId,
      createDualLlmClient(provider, apiKey),
      params.userRequest,
      params.toolResult,
      params.toolName,
      params.toolInputSchema,
      quarantinedMemory || new Map(),
    );
  }

  /**
   * Main entry point for the quarantine pattern.
   * Runs a Q&A session between main agent and quarantined agent.
   *
   * @param onProgress - Optional callback for streaming Q&A progress
   * @returns A safe summary of the information extracted
   */
  async processWithMainAgent(
    onProgress?: (progress: {
      question: string;
      options: string[];
      answer: string;
    }) => void,
  ): Promise<string> {
    // Prepare tool input schemas for template replacement
    const toolInputSchemasText = this.toolInputSchema
      ? JSON.stringify(this.toolInputSchema, null, 2)
      : "No input schema available";

    // Load prompt from database configuration and replace template variables
    const mainAgentPrompt = this.config.mainAgentPrompt
      .replace("{{originalUserRequest}}", this.originalUserRequest)
      .replace("{{toolInputSchemas}}", toolInputSchemasText);

    const conversation: DualLlmMessage[] = [
      {
        role: "user",
        content: mainAgentPrompt,
      },
    ];

    // Q&A loop: Main agent asks questions, quarantined agent answers
    logger.info(
      `\n=== Starting Dual LLM Q&A Loop (max ${this.config.maxRounds} rounds) ===`,
    );

    for (let round = 0; round < this.config.maxRounds; round++) {
      logger.info(`\n--- Round ${round + 1}/${this.config.maxRounds} ---`);

      // Step 1: Main agent formulates a multiple choice question
      const response = await this.llmClient.chat(conversation, 0);
      conversation.push({ role: "assistant", content: response });

      // Check if main agent is done questioning
      if (response === "DONE" || response.includes("DONE")) {
        logger.info("✓ Main agent signaled DONE. Ending Q&A loop.");
        break;
      }

      // Step 2: Parse the question and options from main agent's response
      const questionMatch = response.match(/QUESTION:\s*(.+?)(?=\nOPTIONS:)/s);
      const optionsMatch = response.match(/OPTIONS:\s*([\s\S]+)/);

      if (!questionMatch || !optionsMatch) {
        logger.info("✗ Main agent did not format question correctly. Ending.");
        break;
      }

      const question = questionMatch[1].trim();
      const optionsText = optionsMatch[1].trim();
      const options = optionsText
        .split("\n")
        .map((line) => line.replace(/^\d+:\s*/, "").trim())
        .filter((opt) => opt.length > 0);

      logger.info(`\nQuestion: ${question}`);
      logger.info(`Options (${options.length}):`);
      for (let idx = 0; idx < options.length; idx++) {
        logger.info(`  ${idx}: ${options[idx]}`);
      }

      // Step 3: Quarantined agent answers the question (can see untrusted data)
      const { answerIndex, storedKey } = await this.answerQuestion(
        question,
        options,
      );
      const selectedOption = options[answerIndex];

      logger.info(`\nAnswer: ${answerIndex} - "${selectedOption}"`);
      if (storedKey) {
        logger.info(`✓ Stored in Quarantined Memory as '${storedKey}'`);
      }

      // Stream progress if callback provided
      if (onProgress) {
        onProgress({
          question,
          options,
          answer: `${answerIndex}`,
        });
      }

      // Step 4: Feed the answer back to the main agent
      let answerMessage = `Answer: ${answerIndex} (${selectedOption})`;
      if (storedKey) {
        answerMessage += ` [stored in Quarantined Memory as '${storedKey}']`;
      }
      conversation.push({
        role: "user",
        content: answerMessage,
      });
    }

    logger.info("\n=== Q&A Loop Complete ===\n");

    // Log the complete conversation history
    logger.info("=== Final Messages Object ===");
    logger.info(JSON.stringify(conversation, null, 2));
    logger.info("=== End Messages Object ===\n");

    // Generate a safe summary from the Q&A conversation
    const summary = await this.generateSummary(conversation);

    // Store the result in the database
    await DualLlmResultModel.create({
      agentId: this.agentId,
      toolCallId: this.toolCallId,
      conversations: conversation,
      result: summary,
      quarantinedMemory: Object.fromEntries(this.quarantinedMemory),
    });

    return summary;
  }

  /**
   * Quarantined agent answers a multiple choice question.
   * Has access to untrusted data but can only return an integer index.
   * Can optionally store exact values in quarantined memory.
   *
   * @param question - The question to answer
   * @param options - Array of possible answers
   * @returns Object with answer index and optional stored key
   */
  private async answerQuestion(
    question: string,
    options: string[],
  ): Promise<{ answerIndex: number; storedKey?: string }> {
    const optionsText = options.map((opt, idx) => `${idx}: ${opt}`).join("\n");

    // Prepare tool input schemas for template replacement
    const toolInputSchemasText = this.toolInputSchema
      ? JSON.stringify(this.toolInputSchema, null, 2)
      : "No input schema available";

    // Load quarantined agent prompt from database configuration and replace template variables
    const quarantinedPrompt = this.config.quarantinedAgentPrompt
      .replace("{{toolResultData}}", JSON.stringify(this.toolResult, null, 2))
      .replace("{{question}}", question)
      .replace("{{options}}", optionsText)
      .replace("{{maxIndex}}", String(options.length - 1))
      .replace("{{toolInputSchemas}}", toolInputSchemasText);

    const parsed = await this.llmClient.chatWithSchema<{
      answer: number;
      storeInQuarantinedMemory?: { key: string; value: unknown };
    }>(
      [{ role: "user", content: quarantinedPrompt }],
      {
        name: "multiple_choice_response",
        schema: {
          type: "object",
          properties: {
            answer: {
              type: "integer",
              description: "The index of the selected option (0-based)",
            },
            storeInQuarantinedMemory: {
              type: "object",
              description:
                "Optional: Store exact value in Quarantined Memory for later use",
              properties: {
                key: {
                  type: "string",
                  description:
                    "Memory key name (descriptive, e.g., 'user_id', 'email')",
                },
                value: {
                  description: "Exact value to store from the tool result data",
                },
              },
              required: ["key", "value"],
              additionalProperties: false,
            },
          },
          required: ["answer"],
          additionalProperties: false,
        },
      },
      0,
    );

    // Code-level validation: Check if response has correct structure
    if (!parsed || typeof parsed.answer !== "number") {
      logger.warn("Invalid response structure, defaulting to last option");
      return { answerIndex: options.length - 1 };
    }

    // Bounds validation: Ensure answer is within valid range
    const answerIndex = Math.floor(parsed.answer);
    if (answerIndex < 0 || answerIndex >= options.length) {
      return { answerIndex: options.length - 1 };
    }

    // Store in quarantined memory if provided
    let storedKey: string | undefined;
    if (parsed.storeInQuarantinedMemory) {
      const { key, value } = parsed.storeInQuarantinedMemory;
      this.quarantinedMemory.set(key, value);
      storedKey = key;
      logger.info(`Stored value in Quarantined Memory with key: ${key}`);
    }

    return { answerIndex, storedKey };
  }

  /**
   * Generate a safe summary from the Q&A conversation.
   * Focuses on facts discovered, not the questioning process.
   *
   * @param conversation - The Q&A conversation history
   * @returns A concise summary (2-3 sentences)
   */
  private async generateSummary(
    conversation: DualLlmMessage[],
  ): Promise<string> {
    // Extract just the Q&A pairs and summarize
    const qaText = conversation
      .map((msg) => msg.content)
      .filter((content) => content.length > 0)
      .join("\n");

    // Prepare tool input schemas for template replacement
    const toolInputSchemasText = this.toolInputSchema
      ? JSON.stringify(this.toolInputSchema, null, 2)
      : "No input schema available";

    // Load summary prompt from database configuration and replace template variables
    const summaryPrompt = this.config.summaryPrompt
      .replace("{{qaText}}", qaText)
      .replace("{{toolInputSchemas}}", toolInputSchemasText);

    const summary = await this.llmClient.chat(
      [{ role: "user", content: summaryPrompt }],
      0,
    );

    return summary;
  }
}
