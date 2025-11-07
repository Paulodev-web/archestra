#!/usr/bin/env tsx
/**
 * Generate realistic metrics data for observability demo
 *
 * This script:
 * - Creates multiple agents with labels (environment, team, application)
 * - Makes varied LLM requests through different providers
 * - Includes streaming and non-streaming requests
 * - Generates some errors for realistic dashboards
 *
 * Usage:
 *   pnpm tsx scripts/generate-metrics-data.ts [--duration 300] [--requests-per-minute 20]
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:9000';
const UI_BASE_URL = process.env.UI_BASE_URL || 'http://localhost:3000';

// Parse CLI arguments
const args = process.argv.slice(2);
const durationSeconds = parseInt(args.find(arg => arg.startsWith('--duration='))?.split('=')[1] || '300');
const requestsPerMinute = parseInt(args.find(arg => arg.startsWith('--requests-per-minute='))?.split('=')[1] || '20');

interface Agent {
  id: string;
  name: string;
  labels: Record<string, string>;
  provider: 'openai' | 'anthropic' | 'gemini';
  model: string;
  streaming: boolean;
}

// Agent configurations for demo
const agentConfigs = [
  {
    name: 'Production Chat Assistant',
    labels: { environment: 'production', team: 'platform', application: 'chat' },
    provider: 'openai' as const,
    model: 'gpt-4o',
    streaming: true
  },
  {
    name: 'Staging Code Helper',
    labels: { environment: 'staging', team: 'engineering', application: 'code-assistant' },
    provider: 'anthropic' as const,
    model: 'claude-3-5-sonnet-20241022',
    streaming: true
  },
  {
    name: 'Dev Analytics Bot',
    labels: { environment: 'development', team: 'data-science', application: 'analytics' },
    provider: 'gemini' as const,
    model: 'gemini-1.5-pro',
    streaming: false
  },
  {
    name: 'Production Support Agent',
    labels: { environment: 'production', team: 'support', application: 'customer-service' },
    provider: 'openai' as const,
    model: 'gpt-4o-mini',
    streaming: false
  },
  {
    name: 'Test Translation Service',
    labels: { environment: 'test', team: 'i18n', application: 'translation' },
    provider: 'anthropic' as const,
    model: 'claude-3-5-haiku-20241022',
    streaming: true
  },
];

// Sample prompts for variety
const prompts = [
  'Explain quantum computing in simple terms',
  'Write a haiku about programming',
  'What are the benefits of microservices?',
  'Summarize the principles of REST APIs',
  'How does garbage collection work?',
  'Explain the difference between SQL and NoSQL',
  'What is the CAP theorem?',
  'Describe the OAuth 2.0 flow',
  'What are the SOLID principles?',
  'Explain async/await in JavaScript',
];

let sessionCookie: string | null = null;
let agents: Agent[] = [];

async function login() {
  console.log('🔐 Authenticating...');

  // For demo purposes, we'll use session-based auth
  // In production, you might use API keys
  const response = await fetch(`${UI_BASE_URL}/api/auth/session`, {
    credentials: 'include',
  });

  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    sessionCookie = setCookie.split(';')[0];
  }

  console.log('✅ Authenticated');
}

async function createAgent(config: typeof agentConfigs[0]): Promise<Agent> {
  console.log(`📝 Creating agent: ${config.name}...`);

  const response = await fetch(`${UI_BASE_URL}/api/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: JSON.stringify({
      name: config.name,
      teams: [],
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create agent: ${response.status} ${await response.text()}`);
  }

  const agent = await response.json();

  // Add labels to the agent
  for (const [key, value] of Object.entries(config.labels)) {
    await fetch(`${UI_BASE_URL}/api/agents/${agent.id}/labels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      },
      body: JSON.stringify({ key, value }),
    });
  }

  console.log(`✅ Created agent: ${config.name} (${agent.id})`);

  return {
    id: agent.id,
    name: config.name,
    labels: config.labels,
    provider: config.provider,
    model: config.model,
    streaming: config.streaming,
  };
}

async function makeLLMRequest(agent: Agent, prompt: string, shouldFail = false) {
  const endpoint = {
    openai: `/v1/openai/${agent.id}/chat/completions`,
    anthropic: `/v1/anthropic/${agent.id}/messages`,
    gemini: `/v1/gemini/${agent.id}/models/${agent.model}:generateContent`,
  }[agent.provider];

  const requestBody = {
    openai: {
      model: agent.model,
      messages: [{ role: 'user', content: prompt }],
      stream: agent.streaming,
      max_tokens: shouldFail ? -1 : 100, // Invalid value to trigger error
    },
    anthropic: {
      model: agent.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: shouldFail ? -1 : 100,
      stream: agent.streaming,
    },
    gemini: {
      contents: [{ parts: [{ text: prompt }] }],
    },
  }[agent.provider];

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer demo-token',
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      },
      body: JSON.stringify(requestBody),
    });

    if (agent.streaming && response.ok) {
      // Consume the stream
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    }

    const status = response.ok ? '✅' : '❌';
    console.log(`${status} ${agent.name} → ${agent.provider}/${agent.model} [${response.status}]`);

    return response.ok;
  } catch (error) {
    console.log(`❌ ${agent.name} → ${agent.provider}/${agent.model} [network error]`);
    return false;
  }
}

async function generateTraffic() {
  console.log(`\n🚀 Generating traffic for ${durationSeconds}s at ~${requestsPerMinute} requests/minute...\n`);

  const intervalMs = (60 * 1000) / requestsPerMinute;
  const endTime = Date.now() + (durationSeconds * 1000);

  let totalRequests = 0;
  let successfulRequests = 0;

  while (Date.now() < endTime) {
    // Pick a random agent
    const agent = agents[Math.floor(Math.random() * agents.length)];

    // Pick a random prompt
    const prompt = prompts[Math.floor(Math.random() * prompts.length)];

    // 10% chance of error for realistic metrics
    const shouldFail = Math.random() < 0.1;

    // Make the request
    const success = await makeLLMRequest(agent, prompt, shouldFail);

    totalRequests++;
    if (success) successfulRequests++;

    // Wait before next request
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Total requests: ${totalRequests}`);
  console.log(`   Successful: ${successfulRequests}`);
  console.log(`   Failed: ${totalRequests - successfulRequests}`);
  console.log(`   Success rate: ${((successfulRequests / totalRequests) * 100).toFixed(1)}%`);
}

async function cleanup() {
  console.log('\n🧹 Cleaning up agents...');

  for (const agent of agents) {
    try {
      await fetch(`${UI_BASE_URL}/api/agents/${agent.id}`, {
        method: 'DELETE',
        headers: {
          ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        },
      });
      console.log(`   Deleted: ${agent.name}`);
    } catch (error) {
      console.log(`   Failed to delete: ${agent.name}`);
    }
  }

  console.log('✅ Cleanup complete');
}

async function main() {
  console.log('🎬 Starting metrics data generation...');
  console.log(`   Duration: ${durationSeconds}s`);
  console.log(`   Rate: ~${requestsPerMinute} requests/minute\n`);

  try {
    // 1. Authenticate
    await login();

    // 2. Create agents with labels
    for (const config of agentConfigs) {
      const agent = await createAgent(config);
      agents.push(agent);
    }

    console.log(`\n✅ Created ${agents.length} agents with labels\n`);

    // 3. Generate traffic
    await generateTraffic();

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    // 4. Optional cleanup
    const shouldCleanup = process.env.CLEANUP !== 'false';
    if (shouldCleanup) {
      await cleanup();
    } else {
      console.log('\n⚠️  Skipping cleanup (agents will remain for further testing)');
    }
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Interrupted! Cleaning up...');
  await cleanup();
  process.exit(0);
});

main();
