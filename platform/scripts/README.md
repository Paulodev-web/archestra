# Observability Demo Scripts

Scripts to generate realistic metrics and traces for demonstrating Archestra's observability features.

## Quick Start

### 1. Create an API Key

In the Archestra UI:
1. Go to Settings → Your Account
2. Create a new API key
3. Copy the key value

### 2. Enable Mock Mode

To generate metrics without making real API calls, enable benchmark mock mode in your `.env`:

```bash
BENCHMARK_MOCK_MODE=true
```

Then restart the backend (or `tilt up`) to apply the setting. The mock client will generate realistic, randomized token counts (50-500 prompt tokens, 20-200 completion tokens) for observability testing.

### 3. Set Environment Variables

```bash
# Required: Archestra API key for creating agents
export ARCHESTRA_API_KEY=your-api-key-here
```

### 4. Clear Previous Metrics (Optional)

```bash
docker compose -f dev/docker-compose.observability.yml down -v
docker compose -f dev/docker-compose.observability.yml up -d
```

### 5. Run the Demo

```bash
# Simulate 24 hours of support bot traffic at 60x speed (runs in ~24 minutes)
node scripts/demo-support-bot.js

# Simulate 20 hours at 300x speed (runs in ~5 minutes)
node scripts/demo-support-bot.js --duration=72000 --speed=300
```

## What It Does

The script will:

1. **Create 2 support bot agents** for A/B testing:
  - Support Bot A Anthropic - using claude-3-5-sonnet
  - Support Bot B OpenAI - using gpt-4o
   - Both labeled with: team=support, tier=2, product=readymade, environment=production
   - Differentiated by variant=a or variant=b

2. **Generate realistic support traffic patterns**:
   - Business hours (9am-6pm): 15-30 requests/minute
   - Peak hours (11am-2pm): 25-35 requests/minute
   - Off hours: 2-5 requests/minute
   - 50/50 split between OpenAI and Anthropic bots

3. **Include realistic variance**:
   - Support-specific prompts (CSS issues, integrations, webhooks, etc.)
   - Time-based traffic patterns
   - Both streaming responses

4. **Clean up** agents when done (unless `--keep-agents` is specified)

## Options

```bash
--duration=86400   # Simulated duration in seconds (default: 86400 = 24 hours)
--speed=60         # Speed multiplier (default: 60 = 60x faster, 1 day in 24 min)
--keep-agents      # Don't delete agents after running (useful for repeated runs)
```

## Viewing the Results

### Prometheus Metrics

```bash
# Check metrics endpoint
curl http://localhost:9050/metrics | grep llm_

# Example metrics you'll see:
# llm_request_duration_seconds{provider="openai",agent_name="Production Chat",environment="production",team="platform",app="chat"}
# llm_tokens_total{provider="anthropic",agent_name="Staging Code Helper",type="input"}
```

### Grafana Dashboard

1. Start Grafana: `tilt trigger observability`
2. Open: http://localhost:3002/
3. Import the dashboard: `dev/grafana/dashboards/platform.json`
4. View:
   - Request rates by agent, environment, team
   - Token consumption by provider and agent
   - Error rates and latency percentiles
   - Distributed traces with agent labels

### Trace Explorer

1. Open Grafana: http://localhost:3002/
2. Navigate to Explore → Tempo
3. Search traces by:
   - `agent.name="Production Chat"`
   - `agent.environment="production"`
   - `agent.team="platform"`
   - `llm.provider="openai"`
   - `llm.model="gpt-4o"`

## Example Queries

### PromQL (for Grafana charts)

```promql
# Request rate by environment
sum(rate(llm_request_duration_seconds_count[5m])) by (environment)

# Token usage by team
sum(rate(llm_tokens_total[5m])) by (team, type)

# Error rate by provider
sum(rate(llm_request_duration_seconds_count{status_code!="200"}[5m])) by (provider)
  / sum(rate(llm_request_duration_seconds_count[5m])) by (provider) * 100

# P95 latency by agent
histogram_quantile(0.95, sum(rate(llm_request_duration_seconds_bucket[5m])) by (agent_name, le))
```

### TraceQL (for Tempo)

```traceql
# All production requests
{ agent.environment = "production" }

# OpenAI streaming requests
{ llm.provider = "openai" && llm.stream = "true" }

# Slow requests (>2s)
{ duration > 2s }

# Errors from specific agent
{ agent.name = "Production Chat" && status = error }
```

## Tips for Demo Videos

1. **Quick demo** (~10 minutes for 20 hours of data):
   ```bash
   node scripts/demo-support-bot.js --duration=72000 --speed=120 --keep-agents
   ```

2. **Full day simulation** (~24 minutes for 24 hours of data):
   ```bash
   node scripts/demo-support-bot.js --keep-agents
   ```

3. **Keep agents** for repeated runs:
   ```bash
   node scripts/demo-support-bot.js --keep-agents
   # Run again later without recreating agents
   ```

4. **Different time periods**:
   ```bash
   # Simulate 12 hours at 30x speed (24 minutes)
   node scripts/demo-support-bot.js --duration=43200 --speed=30

   # Simulate 48 hours at 120x speed (24 minutes)
   node scripts/demo-support-bot.js --duration=172800 --speed=120
   ```

## Troubleshooting

**"Missing ARCHESTRA_API_KEY"**
- Create an API key in Settings → Your Account

**"Failed to create agent"**
- Check that the platform is running (`tilt up`)
- Verify API key is valid

**"401 Unauthorized" or "500 Server Error"**
- Ensure BENCHMARK_MOCK_MODE=true is set in your .env file
- Restart the backend after setting BENCHMARK_MOCK_MODE
- Check that the backend is running (`tilt up`)

**No metrics showing up**
- Wait 15-30 seconds for Prometheus to scrape
- Check http://localhost:9050/metrics directly
- Ensure observability stack is running (`tilt trigger observability`)
