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
 *   --duration=86400        # Seconds to run (default: 86400 = 24 hours)
 *   --speed=60              # Speed multiplier (60 = 60x faster, 1 day in 24 min)
 *   --keep-agents           # Don't delete agents after running
 */

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

const AGENT_CONFIGS = [
  {
    name: 'Support Bot A (OpenAI)',
    labels: {
      team: 'support',
      tier: '2',
      product: 'readymade',
      environment: 'production',
      variant: 'a'
    },
    provider: 'openai',
    model: 'gpt-4o',
    stream: true,
  },
  {
    name: 'Support Bot B (Anthropic)',
    labels: {
      team: 'support',
      tier: '2',
      product: 'readymade',
      environment: 'production',
      variant: 'b'
    },
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    stream: true,
  },
];

// Realistic support prompts
const PROMPTS = [
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

async function createAgentWithLabels(config) {
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
  return { id: agent.id, config };
}

async function makeRequest(agentId, config) {
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

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

    // Consume stream if needed
    if (config.stream && res.ok && res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }

    return res.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Calculate requests per minute based on time of day
 * Business hours (9am-6pm): 15-30 req/min
 * Off hours: 2-5 req/min
 */
function getTrafficRate(simulatedHour) {
  const hour = simulatedHour % 24;

  // Business hours: 9am (9) to 6pm (18)
  if (hour >= 9 && hour < 18) {
    // Peak hours: 11am-2pm
    if (hour >= 11 && hour < 14) {
      return 25 + Math.random() * 10; // 25-35 req/min
    }
    // Regular business hours
    return 15 + Math.random() * 10; // 15-25 req/min
  }

  // Off hours
  return 2 + Math.random() * 3; // 2-5 req/min
}

async function generateTraffic(agents) {
  const realDuration = DURATION / SPEED; // Actual time script will run
  const startTime = Date.now();
  const endTime = startTime + (realDuration * 1000);

  console.log(`\n🔥 Simulating ${DURATION}s (${DURATION/3600} hours) of traffic`);
  console.log(`   Running at ${SPEED}x speed for ${Math.round(realDuration/60)} minutes`);
  console.log(`   Split 50/50 between OpenAI and Anthropic\n`);

  let total = 0;
  let success = 0;
  let lastHour = -1;

  const stats = {
    'openai': { total: 0, success: 0 },
    'anthropic': { total: 0, success: 0 },
  };

  while (Date.now() < endTime) {
    const elapsed = (Date.now() - startTime) / 1000; // Real seconds elapsed
    const simulatedElapsed = elapsed * SPEED; // Simulated seconds
    const simulatedHour = Math.floor(simulatedElapsed / 3600);

    // Log hour transitions
    if (simulatedHour !== lastHour) {
      const hourLabel = (simulatedHour % 24).toString().padStart(2, '0');
      const rate = getTrafficRate(simulatedHour);
      console.log(`\n⏰ Hour ${hourLabel}:00 - Traffic rate: ~${Math.round(rate)} req/min`);
      lastHour = simulatedHour;
    }

    const rpm = getTrafficRate(simulatedHour);
    const intervalMs = (60 * 1000) / rpm / SPEED; // Adjusted for speed

    // Alternate between agents (50/50 split)
    const agent = agents[total % agents.length];
    const ok = await makeRequest(agent.id, agent.config);

    total++;
    if (ok) success++;

    // Track per-provider stats
    stats[agent.config.provider].total++;
    if (ok) stats[agent.config.provider].success++;

    const icon = ok ? '✅' : '❌';
    const progress = ((simulatedElapsed / DURATION) * 100).toFixed(1);
    const providerLabel = agent.config.provider === 'openai' ? 'OAI' : 'ANT';
    process.stdout.write(`\r${icon} [${providerLabel}] Requests: ${total} (${success} ok) | Progress: ${progress}%`);

    await new Promise(r => setTimeout(r, intervalMs));
  }

  console.log(`\n\n📊 Total: ${total} requests (${success} successful, ${((success / total) * 100).toFixed(1)}% success rate)`);
  console.log(`   OpenAI: ${stats['openai'].total} requests (${stats['openai'].success} ok)`);
  console.log(`   Anthropic: ${stats['anthropic'].total} requests (${stats['anthropic'].success} ok)`);
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

async function main() {
  console.log('🎬 ReadyMade Support Bot A/B Test - Observability Demo');
  console.log(`   Simulating: ${DURATION/3600}h @ ${SPEED}x speed`);
  console.log(`   Comparing: OpenAI GPT-4o vs Anthropic Claude 3.5 Sonnet\n`);

  try {
    // Create agents
    console.log('📝 Creating support bots...\n');
    const agents = await Promise.all(
      AGENT_CONFIGS.map(config => createAgentWithLabels(config))
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
