Archestra Platform Observability - Launch Video Script (3 minutes)

Opening Hook (0:00-0:20)

[Visual: Dashboard with metrics lighting up]

"Your AI agents are making hundreds of LLM calls. But do you know which ones are failing? Which agents are burning through tokens? How long your
requests actually take?

Without observability, you're flying blind. Today, that changes."

The Problem (0:20-0:40)

[Visual: Black box diagram with question marks]

"Traditional monitoring tools don't understand AI workloads. They can't tell you:
- Which agent is responsible for that spike in costs
- Why certain LLM requests are slow                                                                                                                         - How your database queries impact response times

You need observability built specifically for AI platforms."

Introducing Archestra Observability (0:40-1:10)
[Visual: Grafana dashboard with metrics and traces]

"We've shipped production-grade observability for the Archestra Platform. Here's what you get out of the box:

Prometheus metrics on port 9050 - track HTTP requests, LLM performance, token consumption, and Node.js runtime health.

OpenTelemetry distributed tracing - see the complete journey of every request, from your application through to OpenAI, Anthropic, or Gemini.

Grafana dashboard - pre-built visualizations for the four golden signals, token usage, and trace analysis."

Key Features Deep Dive (1:10-2:20)

[Visual: Split screen showing metrics and traces]

"LLM-specific metrics - Every LLM call is instrumented with provider, model, streaming mode, and response status. You'll see exactly where your tokens
and time are going.

Custom agent labels - Tag your agents with environment, team, or application type. These labels automatically flow through to both metrics and traces.
Filter your Grafana charts by environment=production or drill into traces for team=data-science.

Full request visibility - We instrument HTTP requests with Fastify OTEL and database queries with Drizzle OTEL plugins. See the complete picture: API
→ Database → LLM provider.

Flexible authentication - Connect to any OTLP backend - Grafana Cloud, Honeycomb, or your self-hosted Tempo instance - with bearer token or basic auth
support."

Real-World Impact (2:20-2:45)

[Visual: Example query results and dashboard panels]

"Here's what this means in practice:

Spot that one agent consuming 80% of your token budget with a single PromQL query.

Trace a slow request and discover it's waiting on a database query, not the LLM.

Set up alerts when error rates spike for specific providers or agents.

All with standard tools you already know - Prometheus and Grafana."

Closing & Call to Action (2:45-3:00)

[Visual: GitHub repo and documentation links]

"Observability is now live in Archestra Platform. Check out our documentation for PromQL examples and dashboard templates.

Visit github.com/archestra-ai/archestra to get started.

Stop guessing. Start observing."

[End screen: Archestra logo and GitHub link]

  ---
Key talking points to emphasize:
- Built over 3 weeks with 6+ major commits
- Production-ready, not experimental
- Works with your existing monitoring stack
- Agent-centric approach (labels, per-agent metrics)
- The shift from Jaeger to Tempo shows maturity and production focus
