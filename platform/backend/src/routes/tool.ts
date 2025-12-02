import Anthropic from "@anthropic-ai/sdk";
import { RouteId } from "@shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { hasPermission } from "@/auth";
import logger from "@/logging";
import { ToolModel } from "@/models";
import { ApiError, constructResponseSchema, ExtendedSelectToolSchema } from "@/types";

const TOOL_CATEGORIES = [
  "Development",
  "Data Processing",
  "File Management",
  "Database",
  "Search",
  "Communication",
  "Web",
  "Automation",
  "AI/ML",
  "System",
  "Other",
] as const;

const toolRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/api/tools",
    {
      schema: {
        operationId: RouteId.GetTools,
        description: "Get all tools",
        tags: ["Tools"],
        response: constructResponseSchema(z.array(ExtendedSelectToolSchema)),
      },
    },
    async ({ user, headers }, reply) => {
      const { success: isAgentAdmin } = await hasPermission(
        { profile: ["admin"] },
        headers,
      );

      return reply.send(await ToolModel.findAll(user.id, isAgentAdmin));
    },
  );

  fastify.post(
    "/api/tools/categorize",
    {
      schema: {
        operationId: RouteId.CategorizeTools,
        description: "Auto-categorize tools using LLM",
        tags: ["Tools"],
        body: z.object({
          toolIds: z.array(z.string()).min(1, "At least one tool ID required"),
        }),
        response: constructResponseSchema(
          z.object({
            categorized: z.array(
              z.object({
                toolId: z.string(),
                category: z.string(),
              }),
            ),
            failed: z.array(
              z.object({
                toolId: z.string(),
                error: z.string(),
              }),
            ),
          }),
        ),
      },
    },
    async ({ body, headers }, reply) => {
      const { toolIds } = body;

      // Check for chat token in Authorization header
      const authHeader = headers.authorization as string | undefined;
      const chatApiKey = authHeader?.replace(/^Bearer\s+/i, "");

      if (!chatApiKey) {
        throw new ApiError(
          401,
          "Authorization header with chat token is required",
        );
      }

      // Fetch tools to categorize
      const tools = await ToolModel.getByIds(toolIds);

      if (tools.length === 0) {
        throw new ApiError(404, "No tools found with provided IDs");
      }

      const categorized: Array<{ toolId: string; category: string }> = [];
      const failed: Array<{ toolId: string; error: string }> = [];

      // Initialize Anthropic client
      const anthropic = new Anthropic({ apiKey: chatApiKey });

      // Process tools in batches of 5 for efficiency
      const batchSize = 5;
      for (let i = 0; i < tools.length; i += batchSize) {
        const batch = tools.slice(i, i + batchSize);

        try {
          const toolDescriptions = batch
            .map(
              (tool, idx) =>
                `${idx + 1}. Tool: ${tool.name}\n   Description: ${tool.description || "No description"}\n   Parameters: ${JSON.stringify(tool.parameters || {}, null, 2)}`,
            )
            .join("\n\n");

          const prompt = `You are a tool categorization assistant. Analyze the following tools and assign each one to the most appropriate category from this list:
${TOOL_CATEGORIES.join(", ")}

Tools to categorize:
${toolDescriptions}

For each tool, respond with ONLY a JSON array in this exact format:
[
  {"toolNumber": 1, "category": "Category Name"},
  {"toolNumber": 2, "category": "Category Name"}
]

Important:
- Use ONLY categories from the list above
- Choose the single most appropriate category for each tool
- Respond with ONLY the JSON array, no other text`;

          const message = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }],
          });

          const content = message.content[0];
          if (content.type !== "text") {
            throw new Error("Unexpected response type from LLM");
          }

          // Extract JSON from response (handle potential markdown code blocks)
          let jsonText = content.text.trim();
          const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            jsonText = jsonMatch[1].trim();
          }

          const results = JSON.parse(jsonText) as Array<{
            toolNumber: number;
            category: string;
          }>;

          // Map results back to tool IDs
          for (const result of results) {
            const tool = batch[result.toolNumber - 1];
            if (tool) {
              categorized.push({
                toolId: tool.id,
                category: result.category,
              });
            }
          }
        } catch (error) {
          logger.error({ error }, "Failed to categorize batch of tools");
          // Mark all tools in this batch as failed
          for (const tool of batch) {
            failed.push({
              toolId: tool.id,
              error:
                error instanceof Error ? error.message : "Failed to categorize",
            });
          }
        }
      }

      // Update database with successful categorizations
      if (categorized.length > 0) {
        await ToolModel.bulkUpdateCategories(
          categorized.map((c) => ({
            toolId: c.toolId,
            category: c.category,
            isAutoAssigned: true,
          })),
        );
      }

      return reply.send({
        categorized,
        failed,
      });
    },
  );

  fastify.patch(
    "/api/tools/:id/category",
    {
      schema: {
        operationId: RouteId.UpdateToolCategory,
        description: "Update tool category manually",
        tags: ["Tools"],
        params: z.object({
          id: z.string(),
        }),
        body: z.object({
          category: z.string().nullable(),
        }),
        response: constructResponseSchema(ExtendedSelectToolSchema),
      },
    },
    async ({ params, body, user, headers }, reply) => {
      const { id } = params;
      const { category } = body;

      // Check permissions
      const { success: isAgentAdmin } = await hasPermission(
        { profile: ["admin"] },
        headers,
      );

      // Verify tool exists and user has access
      const tool = await ToolModel.findById(id, user.id, isAgentAdmin);
      if (!tool) {
        throw new ApiError(404, "Tool not found");
      }

      // Update category (manual update, not auto-assigned)
      const updatedTool = await ToolModel.updateCategory(
        id,
        category,
        false, // User manually updated, so not auto-assigned
      );

      if (!updatedTool) {
        throw new ApiError(500, "Failed to update tool category");
      }

      // Return extended tool format (need to fetch with joins)
      const [extendedTool] = await ToolModel.findAll(user.id, isAgentAdmin);
      const result = extendedTool; // Simplified for POC

      return reply.send(result);
    },
  );
};

export default toolRoutes;
