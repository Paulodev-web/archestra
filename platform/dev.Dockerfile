FROM node:24.11.1-alpine3.22 AS base

# Enable pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Development stage
FROM base AS dev
WORKDIR /app

# Copy package files for all workspaces
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY shared/package.json shared/

# Install all dependencies (including dev dependencies)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy all source code into the image for fast compilation
# Tilt's live_update will sync changes without rebuilding
COPY backend ./backend
COPY frontend ./frontend
COPY shared ./shared
COPY experiments ./experiments
COPY e2e-tests ./e2e-tests

# Disable Next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# The actual command will be specified in Tiltfile
# Default to running dev mode for all workspaces
CMD ["pnpm", "dev"]
