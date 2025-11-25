/**
 * Session-based storage for Quarantined Memory (QM)
 * Stores QM per agent ID across multiple requests in the same conversation
 */

// In-memory store keyed by agent ID
const qmStore = new Map<string, Record<string, unknown>>();

/**
 * Get existing quarantined memory for an agent
 *
 * @param agentId - The agent ID
 * @returns Existing quarantined memory or empty object
 */
export function getQuarantinedMemory(agentId: string): Record<string, unknown> {
  return qmStore.get(agentId) || {};
}

/**
 * Update quarantined memory for an agent
 * Merges with existing memory
 *
 * @param agentId - The agent ID
 * @param newMemory - New memory to merge
 */
export function updateQuarantinedMemory(
  agentId: string,
  newMemory: Record<string, unknown>,
): void {
  const existing = getQuarantinedMemory(agentId);
  qmStore.set(agentId, { ...existing, ...newMemory });
}

/**
 * Clear quarantined memory for an agent
 * Useful for cleanup or when conversation ends
 *
 * @param agentId - The agent ID
 */
export function clearQuarantinedMemory(agentId: string): void {
  qmStore.delete(agentId);
}

/**
 * Get all keys currently stored for an agent
 *
 * @param agentId - The agent ID
 * @returns Array of key names
 */
export function getQuarantinedMemoryKeys(agentId: string): string[] {
  const memory = getQuarantinedMemory(agentId);
  return Object.keys(memory);
}
