#!/usr/bin/env node
/**
 * Demo script for A/B Testing Support Bots (OpenAI vs Anthropic)
 *
 * Simulates one day of support traffic with realistic patterns:
 * - Business hours (9am-6pm): higher traffic
 * - Off hours: minimal traffic
 * - Traffic split 50/50 between OpenAI and Anthropic bots
 *
 * Usage:
 *   ARCHESTRA_API_KEY=your-key node scripts/demo-support-bot.js
 *
 * Options:
 *   --duration=86400                # Seconds to run (default: 86400 = 24 hours)
 *   --speed=60                      # Speed multiplier (60 = 60x faster, 1 day in 24 min)
 *   --keep-agents                   # Don't delete agents after running
 *   --otel-exporter=honeycomb       # Send traces to Honeycomb (requires HONEYCOMB_API_KEY env var)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:9000';
const API_KEY = process.env.ARCHESTRA_API_KEY;

if (!API_KEY) {
  console.error('❌ Missing ARCHESTRA_API_KEY environment variable');
  console.error('   Create an API key in the Archestra UI under Settings → Your Account');
  process.exit(1);
}

// Parse arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace('--', '').split('=');
  acc[key] = value || true;
  return acc;
}, {});

const DURATION = parseInt(args.duration || '86400'); // 24 hours in seconds
const SPEED = parseInt(args.speed || '60'); // 60x speed = 1 day in 24 min
const KEEP_AGENTS = args['keep-agents'] || false;
const OTEL_EXPORTER = args['otel-exporter']; // 'honeycomb' or undefined

// Validate Honeycomb configuration
if (OTEL_EXPORTER === 'honeycomb' && !process.env.HONEYCOMB_API_KEY) {
  console.error('❌ --otel-exporter=honeycomb requires HONEYCOMB_API_KEY environment variable');
  console.error('   Get your API key from https://ui.honeycomb.io/account');
  process.exit(1);
}

const AGENT_CONFIGS = [
  {
    name: 'Support Bot A Anthropic',
    labels: {
      team: 'support',
    },
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    stream: false,
  },
  {
    name: 'Support Bot B OpenAI',
    labels: {
      team: 'support',
    },
    provider: 'openai',
    model: 'gpt-4o',
    stream: false,
  },
  {
    name: 'Sales Assistant',
    labels: {
      team: 'sales',
    },
    provider: 'openai',
    model: 'gpt-4o',
    stream: false,
  },
];

// Realistic support prompts
const SUPPORT_PROMPTS = [
  'My custom CSS is not applying to the widget',
  'How do I integrate the Stripe payment widget?',
  'The animation is stuttering on mobile Safari',
  'Can I embed a YouTube video with autoplay?',
  'My custom domain shows 404 error',
  'The form submission is not triggering webhooks',
  'How to add Google Analytics tracking?',
  'Images are not loading after publishing',
  'Can I password-protect a page?',
  'The responsive layout breaks on iPad',
];

// Realistic sales prompts
const SALES_PROMPTS = [
  'What pricing plans do you offer?',
  'Can I get a demo of the enterprise plan?',
  'How does the free trial work?',
  'What are the differences between Pro and Enterprise?',
  'Do you offer discounts for annual subscriptions?',
  'What kind of support is included in each plan?',
  'Can I upgrade or downgrade my plan anytime?',
  'Do you have a partner or reseller program?',
  'What payment methods do you accept?',
  'Is there a limit on the number of projects?',
];

const createdAgentIds = [];

async function api(path, options = {}) {
  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY,
      ...options.headers,
    },
  });
}

async function findOrCreateAgent(config) {
  // Check if agent already exists
  const listRes = await api('/api/agents');
  if (!listRes.ok) {
    throw new Error(`Failed to list agents: ${await listRes.text()}`);
  }

  const response = await listRes.json();
  // API returns paginated response with 'data' field
  const existingAgents = response.data || response;
  const existingAgent = existingAgents.find(a => a.name === config.name);

  let agent;
  if (existingAgent) {
    agent = existingAgent;
    console.log(`♻️  Reusing: ${config.name} (${agent.id.slice(0, 8)}...)`);
  } else {
    // Convert labels object to array format for API
    const labels = Object.entries(config.labels).map(([key, value]) => ({
      key,
      value
    }));

    // Create agent with labels
    const res = await api('/api/agents', {
      method: 'POST',
      body: JSON.stringify({
        name: config.name,
        teams: [],
        labels
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to create agent: ${await res.text()}`);
    }

    agent = await res.json();
    createdAgentIds.push(agent.id);
    console.log(`✅ Created: ${config.name} (${agent.id.slice(0, 8)}...)`);
  }

  return { id: agent.id, config };
}

async function makeRequest(agentId, config) {
  // Choose prompts based on team
  const prompts = config.labels.team === 'sales' ? SALES_PROMPTS : SUPPORT_PROMPTS;
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];

  // Different endpoints for different providers
  const endpoint = config.provider === 'anthropic'
    ? `/v1/anthropic/${agentId}/v1/messages`
    : `/v1/${config.provider}/${agentId}/chat/completions`;

  const body = {
    model: config.model,
    messages: [{ role: 'user', content: prompt }],
    stream: config.stream,
    max_tokens: 100,
  };

  try {
    const headers = {
      'Authorization': `Bearer ${agentId}`,
    };

    // Anthropic requires specific headers
    if (config.provider === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      headers['x-api-key'] = 'mock-key';
    }

    const res = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
    });

    return res.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Calculate requests per minute based on time of day and team
 * Support: peaks 11am-2pm (support rush)
 * Sales: peaks 2pm-5pm (sales calls)
 * Business hours (9am-6pm): 15-30 req/min
 * Off hours: 2-5 req/min
 */
function getTrafficRate(simulatedHour, team = 'support') {
  const hour = simulatedHour % 24;

  // Business hours: 9am (9) to 6pm (18)
  if (hour >= 9 && hour < 18) {
    if (team === 'sales') {
      // Sales peak: 2pm-5pm (afternoon calls)
      if (hour >= 14 && hour < 17) {
        return 20 + Math.random() * 8; // 20-28 req/min
      }
      // Regular sales hours
      return 10 + Math.random() * 8; // 10-18 req/min
    } else {
      // Support peak: 11am-2pm (lunch rush)
      if (hour >= 11 && hour < 14) {
        return 25 + Math.random() * 10; // 25-35 req/min
      }
      // Regular support hours
      return 15 + Math.random() * 10; // 15-25 req/min
    }
  }

  // Off hours (sales quieter than support)
  if (team === 'sales') {
    return 1 + Math.random() * 2; // 1-3 req/min
  }
  return 2 + Math.random() * 3; // 2-5 req/min
}

async function generateTraffic(agents) {
  const realDuration = DURATION / SPEED; // Actual time script will run
  const startTime = Date.now();
  const endTime = startTime + (realDuration * 1000);

  console.log(`\n🔥 Simulating ${DURATION}s (${DURATION/3600} hours) of traffic`);
  console.log(`   Running at ${SPEED}x speed for ${Math.round(realDuration/60)} minutes`);
  console.log(`   Support: 40% Bot A Anthropic, 40% Bot B OpenAI`);
  console.log(`   Sales: 20% Sales Assistant OpenAI\n`);

  let total = 0;
  let success = 0;
  let lastHour = -1;

  // Track stats per agent
  const stats = {};
  for (const agent of agents) {
    stats[agent.config.name] = { total: 0, success: 0 };
  }

  while (Date.now() < endTime) {
    const elapsed = (Date.now() - startTime) / 1000; // Real seconds elapsed
    const simulatedElapsed = elapsed * SPEED; // Simulated seconds
    const simulatedHour = Math.floor(simulatedElapsed / 3600);

    // Weighted agent selection: 40% Bot A, 40% Bot B, 20% Sales
    const rand = Math.random();
    let agent;
    if (rand < 0.4) {
      agent = agents[0]; // Bot A Anthropic
    } else if (rand < 0.8) {
      agent = agents[1]; // Bot B OpenAI
    } else {
      agent = agents[2]; // Sales Assistant
    }

    const team = agent.config.labels.team;

    // Log hour transitions with team-specific rates
    if (simulatedHour !== lastHour) {
      const hourLabel = (simulatedHour % 24).toString().padStart(2, '0');
      const supportRate = getTrafficRate(simulatedHour, 'support');
      const salesRate = getTrafficRate(simulatedHour, 'sales');
      console.log(`\n⏰ Hour ${hourLabel}:00 - Support: ~${Math.round(supportRate)} req/min, Sales: ~${Math.round(salesRate)} req/min`);
      lastHour = simulatedHour;
    }

    // Use team-specific traffic rate for interval timing
    const rpm = getTrafficRate(simulatedHour, team);
    const intervalMs = (60 * 1000) / rpm / SPEED; // Adjusted for speed

    const ok = await makeRequest(agent.id, agent.config);

    total++;
    if (ok) success++;

    // Track per-agent stats
    stats[agent.config.name].total++;
    if (ok) stats[agent.config.name].success++;

    const icon = ok ? '✅' : '❌';
    const progress = ((simulatedElapsed / DURATION) * 100).toFixed(1);
    const agentLabel = team === 'sales' ? 'S' : (agent.config.provider === 'anthropic' ? 'A' : 'B');
    process.stdout.write(`\r${icon} [${agentLabel}] Requests: ${total} (${success} ok) | Progress: ${progress}%`);

    await new Promise(r => setTimeout(r, intervalMs));
  }

  console.log(`\n\n📊 Total: ${total} requests (${success} successful, ${((success / total) * 100).toFixed(1)}% success rate)`);
  for (const [name, stat] of Object.entries(stats)) {
    const successRate = stat.total > 0 ? ((stat.success / stat.total) * 100).toFixed(1) : 0;
    console.log(`   ${name}: ${stat.total} requests (${stat.success} ok, ${successRate}% success)`);
  }
}

async function cleanup() {
  if (KEEP_AGENTS) {
    console.log('\n⚠️  Keeping agents (use --keep-agents=false to delete)');
    return;
  }

  if (createdAgentIds.length > 0) {
    console.log('\n🧹 Cleaning up agents...');
    for (const id of createdAgentIds) {
      await api(`/api/agents/${id}`, { method: 'DELETE' });
    }
    console.log(`✅ Deleted ${createdAgentIds.length} agents`);
  }
}

/**
 * Configure OTEL exporter for Honeycomb
 */
const CONFIG_FILE_PATH = path.join(process.cwd(), 'backend/src/config.ts');
let originalConfigContent = null;

async function configureOtelExporter() {
  if (OTEL_EXPORTER !== 'honeycomb') return;

  console.log('🍯 Configuring Honeycomb OTEL exporter...');

  // Read original config
  originalConfigContent = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');

  // Replace OTEL config with Honeycomb endpoint
  const modifiedConfig = originalConfigContent.replace(
    /traceExporter: \{[\s\S]*?\} satisfies Partial<OTLPExporterNodeConfigBase>,/,
    `traceExporter: {
        url: "https://api.honeycomb.io:443/v1/traces",
        headers: {
          "x-honeycomb-team": process.env.HONEYCOMB_API_KEY || "",
        },
      } satisfies Partial<OTLPExporterNodeConfigBase>,`
  );

  fs.writeFileSync(CONFIG_FILE_PATH, modifiedConfig, 'utf8');

  // Restart backend
  console.log('🔄 Restarting backend with Honeycomb config...');
  execSync('tilt trigger pnpm-dev', { stdio: 'ignore' });

  // Wait for backend to be ready
  console.log('⏳ Waiting for backend to restart...');
  await waitForBackend();
  console.log('✅ Backend ready with Honeycomb exporter\n');
}

async function restoreOtelExporter() {
  if (!originalConfigContent) return;

  console.log('\n🔄 Restoring original OTEL configuration...');
  fs.writeFileSync(CONFIG_FILE_PATH, originalConfigContent, 'utf8');
  execSync('tilt trigger pnpm-dev', { stdio: 'ignore' });
  await waitForBackend();
  console.log('✅ Configuration restored\n');
}

async function waitForBackend() {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (response.ok) return;
    } catch (e) {
      // Backend not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Backend failed to start after 30 seconds');
}

async function main() {
  console.log('🎬 ReadyMade Support Bot A/B Test - Observability Demo');
  console.log(`   Simulating: ${DURATION/3600}h @ ${SPEED}x speed`);
  console.log(`   Bot A Anthropic: Fast & efficient, but less reliable (~8% errors)`);
  console.log(`   Bot B OpenAI: Slower & more tokens, but rock-solid (~2% errors)`);
  if (OTEL_EXPORTER === 'honeycomb') {
    console.log(`   📊 Traces → Honeycomb`);
  }
  console.log('');

  try {
    // Configure OTEL exporter if needed
    await configureOtelExporter();

    // Find or create agents
    console.log('📝 Setting up support bots...\n');
    const agents = await Promise.all(
      AGENT_CONFIGS.map(config => findOrCreateAgent(config))
    );

    // Generate traffic
    await generateTraffic(agents);

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await cleanup();
    await restoreOtelExporter();
  }
}

process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Interrupted!');
  await cleanup();
  await restoreOtelExporter();
  process.exit(0);
});

main();
