import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Configuration for the Dual LLM Quarantine Pattern
 * Stores prompts and settings used by DualLlmSubagent
 */
const dualLlmConfigTable = pgTable("dual_llm_config", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Enable/disable dual LLM analysis
  enabled: boolean("enabled").notNull().default(false),

  // Main agent prompt - all instructions for the privileged LLM in a single user message
  // This agent asks questions to understand quarantined data without direct access to it
  // Available variables: {{originalUserRequest}} for user request, {{toolInputSchemas}} for tool input schemas
  mainAgentPrompt: text("main_agent_prompt").notNull(),

  // Quarantined agent prompt - instructions for answering questions safely
  // This agent has access to untrusted data but can only answer multiple choice questions
  // Available variables: {{toolResultData}}, {{question}}, {{options}}, {{maxIndex}}, {{toolInputSchemas}}
  quarantinedAgentPrompt: text("quarantined_agent_prompt").notNull(),

  // Summary generation prompt - how to create safe summary from Q&A
  // Available variables: {{qaText}} for the Q&A conversation, {{toolInputSchemas}} for tool input schemas
  summaryPrompt: text("summary_prompt").notNull(),

  // Maximum number of Q&A rounds
  maxRounds: integer("max_rounds").notNull().default(5),

  // Metadata
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export default dualLlmConfigTable;
