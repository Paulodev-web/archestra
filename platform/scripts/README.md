# Observability Demo Scripts

Scripts to generate realistic metrics and traces for demonstrating Archestra's observability features.

## Quick Start

### 1. Create an API Key

In the Archestra UI:
1. Go to Settings → Your Account
2. Create a new API key
3. Copy the key value

### 2. Set Environment Variables

```bash
# Required: Archestra API key for creating agents
export ARCHESTRA_API_KEY=your-api-key-here

# Required: At least one provider API key
export OPENAI_API_KEY=your-openai-key
export ANTHROPIC_API_KEY=your-anthropic-key
```

### 3. Run the Demo

```bash
# Generate 5 minutes of traffic at 20 requests/minute
pnpm --filter @backend exec tsx ../scripts/quick-metrics-demo.ts

# Or customize:
pnpm --filter @backend exec tsx ../scripts/quick-metrics-demo.ts --duration=600 --rpm=30 --keep-agents
```

## What It Does

The script will:

1. **Create 5 agents** with realistic labels:
   - Production Chat (environment=production, team=platform, app=chat)
   - Staging Code Helper (environment=staging, team=engineering, app=code-assistant)
   - Dev Analytics (environment=development, team=data-science, app=analytics)
   - Production Support (environment=production, team=support, app=customer-service)
   - Translation Service (environment=production, team=i18n, app=translation)

2. **Generate LLM requests** across:
   - OpenAI (gpt-4o, gpt-4o-mini)
   - Anthropic (claude-3-5-sonnet, claude-3-5-haiku)
   - Both streaming and non-streaming modes

3. **Include realistic variance**:
   - Random prompt selection
   - 5% intentional error rate
   - Mixed request patterns

4. **Clean up** agents when done (unless `--keep-agents` is specified)

## Options

```bash
--duration=300      # Duration in seconds (default: 300 = 5 minutes)
--rpm=20           # Requests per minute (default: 20)
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

1. **Run overnight** to build up historical data:
   ```bash
   ARCHESTRA_API_KEY=key pnpm --filter @backend exec tsx ../scripts/quick-metrics-demo.ts --duration=28800 --rpm=10 --keep-agents
   ```

2. **Keep agents** for repeated runs:
   ```bash
   pnpm --filter @backend exec tsx ../scripts/quick-metrics-demo.ts --keep-agents
   # Run again later without recreating agents
   ```

3. **Vary traffic patterns**:
   ```bash
   # Morning spike
   pnpm --filter @backend exec tsx ../scripts/quick-metrics-demo.ts --rpm=50 --duration=300

   # Normal load
   pnpm --filter @backend exec tsx ../scripts/quick-metrics-demo.ts --rpm=20 --duration=600

   # Quiet period
   pnpm --filter @backend exec tsx ../scripts/quick-metrics-demo.ts --rpm=5 --duration=300
   ```

4. **Use multiple terminals** to simulate concurrent workloads with different patterns

## Troubleshooting

**"Missing ARCHESTRA_API_KEY"**
- Create an API key in Settings → Your Account

**"Failed to create agent"**
- Check that the platform is running (`tilt up`)
- Verify API key is valid

**"401 Unauthorized" or "500 Server Error"**
- Ensure you have provider API keys set (OPENAI_API_KEY, ANTHROPIC_API_KEY)
- The script will skip providers without API keys
- At least one provider API key is required to generate traffic

**No metrics showing up**
- Wait 15-30 seconds for Prometheus to scrape
- Check http://localhost:9050/metrics directly
- Ensure observability stack is running (`tilt trigger observability`)
