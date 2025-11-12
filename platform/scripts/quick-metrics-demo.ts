#!/usr/bin/env node
/**
 * Quick metrics data generator for observability demos
 *
 * Prerequisites:
 * 1. Create agents in the UI with labels (or let this script create them)
 * 2. Set ARCHESTRA_API_KEY environment variable
 * 3. Set BENCHMARK_MOCK_MODE=true on backend to avoid real OpenAI API calls
 *
 * Usage:
 *   ARCHESTRA_API_KEY=your-key pnpm exec tsx scripts/quick-metrics-demo.ts
 *
 * Options:
 *   --duration=300          # Run for 5 minutes (default: 300)
 *   --rpm=20                # Requests per minute (default: 20)
 *   --keep-agents           # Don't delete agents after running
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:9000';
const API_KEY = process.env.ARCHESTRA_API_KEY;

if (!API_KEY) {
  console.error('❌ Missing ARCHESTRA_API_KEY environment variable');
  console.error('   Create an API key in the Archestra UI under Settings → API Keys');
  process.exit(1);
}

// Parse arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace('--', '').split('=');
  acc[key] = value || true;
  return acc;
}, {} as Record<string, any>);

const DURATION = parseInt(args.duration || '300');
const RPM = parseInt(args.rpm || '20');
const KEEP_AGENTS = args['keep-agents'] || false;

interface AgentConfig {
  name: string;
  labels: Record<string, string>;
  provider: 'openai';
  model: string;
  stream: boolean;
}

const AGENT_CONFIGS: AgentConfig[] = [
  {
    name: 'Production Chat',
    labels: { environment: 'production', team: 'platform', app: 'chat' },
    provider: 'openai',
    model: 'gpt-4o',
    stream: true,
  },
  {
    name: 'Staging Code Helper',
    labels: { environment: 'staging', team: 'engineering', app: 'code-assistant' },
    provider: 'openai',
    model: 'gpt-4o',
    stream: true,
  },
  {
    name: 'Dev Analytics',
    labels: { environment: 'development', team: 'data-science', app: 'analytics' },
    provider: 'openai',
    model: 'gpt-4o-mini',
    stream: false,
  },
  {
    name: 'Production Support',
    labels: { environment: 'production', team: 'support', app: 'customer-service' },
    provider: 'openai',
    model: 'gpt-4o-mini',
    stream: false,
  },
  {
    name: 'Translation Service',
    labels: { environment: 'production', team: 'i18n', app: 'translation' },
    provider: 'openai',
    model: 'gpt-4o-mini',
    stream: true,
  },
];

const PROMPTS = [
  'Explain quantum computing in one sentence',
  'Write a short haiku about code',
  'What is REST in 10 words',
  'Define microservices briefly',
  'Explain async/await',
  'What is the CAP theorem',
  'Summarize OAuth 2.0',
  'Define SOLID principles',
  'What is garbage collection',
  'Explain DNS in simple terms',
];

const createdAgentIds: string[] = [];

async function api(path: string, options: RequestInit = {}) {
  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY,
      ...options.headers,
    },
  });
}

async function createAgentWithLabels(config: AgentConfig): Promise<string> {
  // Create agent
  const res = await api('/api/agents', {
    method: 'POST',
    body: JSON.stringify({ name: config.name, teams: [] }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create agent: ${await res.text()}`);
  }

  const agent = await res.json();
  createdAgentIds.push(agent.id);

  // Add labels
  for (const [key, value] of Object.entries(config.labels)) {
    await api(`/api/agents/${agent.id}/labels`, {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    });
  }

  console.log(`✅ Created: ${config.name} (${agent.id.slice(0, 8)}...)`);
  return agent.id;
}

async function makeRequest(agentId: string, config: AgentConfig): Promise<boolean> {
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

  const endpoint = `/v1/openai/${agentId}/chat/completions`;
  const body = {
    model: config.model,
    messages: [{ role: 'user', content: prompt }],
    stream: config.stream,
    max_tokens: 50,
  };

  try {
    const res = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Authorization': 'mock-key', // Mock key since BENCHMARK_MOCK_MODE is enabled
      },
    });

    // Consume stream if needed
    if (config.stream && res.ok && res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }

    const icon = res.ok ? '✅' : '❌';
    const label = Object.entries(config.labels).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`${icon} [${res.status}] ${config.name.padEnd(25)} ${config.provider}/${config.model.slice(0, 20)} {${label}}`);

    return res.ok;
  } catch (error) {
    console.log(`❌ [ERR] ${config.name.padEnd(25)} network error`);
    return false;
  }
}

async function generateTraffic(agents: { id: string; config: AgentConfig }[]) {
  console.log(`\n🔥 Generating traffic: ${DURATION}s @ ${RPM} req/min\n`);

  const intervalMs = (60 * 1000) / RPM;
  const endTime = Date.now() + DURATION * 1000;

  let total = 0;
  let success = 0;

  while (Date.now() < endTime) {
    const agent = agents[Math.floor(Math.random() * agents.length)];

    // 5% chance of intentional error
    const shouldFail = Math.random() < 0.05;

    const ok = await makeRequest(agent.id, agent.config);

    total++;
    if (ok && !shouldFail) success++;

    await new Promise(r => setTimeout(r, intervalMs));
  }

  console.log(`\n📊 Generated ${total} requests (${success} successful, ${((success / total) * 100).toFixed(1)}% success rate)`);
}

async function cleanup() {
  if (KEEP_AGENTS) {
    console.log('\n⚠️  Keeping agents (use --keep-agents=false to delete)');
    return;
  }

  console.log('\n🧹 Cleaning up agents...');
  for (const id of createdAgentIds) {
    await api(`/api/agents/${id}`, { method: 'DELETE' });
  }
  console.log(`✅ Deleted ${createdAgentIds.length} agents`);
}

async function main() {
  console.log('🎬 Archestra Observability Metrics Generator');
  console.log(`   Duration: ${DURATION}s | Rate: ${RPM} req/min\n`);

  try {
    // Create agents
    console.log('📝 Creating agents with labels...\n');
    const agents = await Promise.all(
      AGENT_CONFIGS.map(async (config) => ({
        id: await createAgentWithLabels(config),
        config,
      }))
    );

    // Generate traffic
    await generateTraffic(agents);

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Interrupted!');
  await cleanup();
  process.exit(0);
});

main();
