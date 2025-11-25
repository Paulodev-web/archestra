/**
 * Utility functions for Quarantined Memory (QM) substitution
 * Replaces [QM:key] placeholders with actual values from quarantined memory
 */

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Substitute [QM:key] placeholders with actual values from quarantined memory
 *
 * @param text - Text containing [QM:key] placeholders
 * @param memory - Record of key-value pairs from quarantined memory
 * @returns Text with all placeholders substituted
 */
export function substituteQuarantinedMemory(
  text: string,
  memory: Record<string, unknown>,
): string {
  let result = text;

  for (const [key, value] of Object.entries(memory)) {
    const placeholder = `[QM:${key}]`;
    const valueStr = typeof value === "string" ? value : JSON.stringify(value);

    // Replace all occurrences (global)
    result = result.replace(
      new RegExp(escapeRegExp(placeholder), "g"),
      valueStr,
    );
  }

  return result;
}

/**
 * Deep substitute [QM:key] in an object structure
 * Used for substituting in messages, tool calls, and other nested objects
 *
 * @param obj - Object containing potential [QM:key] placeholders
 * @param memory - Record of key-value pairs from quarantined memory
 * @returns Deep copy of object with all placeholders substituted
 */
export function substituteQuarantinedMemoryInObject(
  obj: unknown,
  memory: Record<string, unknown>,
): unknown {
  if (typeof obj === "string") {
    return substituteQuarantinedMemory(obj, memory);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => substituteQuarantinedMemoryInObject(item, memory));
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteQuarantinedMemoryInObject(value, memory);
    }
    return result;
  }

  return obj;
}
