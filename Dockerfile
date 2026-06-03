# syntax=docker/dockerfile:1.7

# ---------- Builder stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (using package-lock if present)
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Build the TypeScript sources
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies for the runtime image
RUN npm prune --omit=dev

# ---------- Runtime stage ----------
FROM node:20-alpine AS runtime

# Adobe IMS uses HTTPS; ensure CA bundle is present
RUN apk add --no-cache ca-certificates && update-ca-certificates

WORKDIR /app

# Bring over only what's needed to run
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Required environment variables (set at runtime via -e or compose):
#   AEP_CLIENT_ID
#   AEP_CLIENT_SECRET
#   AEP_ORG_ID
# Optional:
#   AEP_SANDBOX_NAME (default: prod)
#   LOG_LEVEL (default: info)
#   AEP_REQUEST_TIMEOUT_MS (default: 30000)
#   AEP_MAX_RETRIES (default: 3)

# MCP servers speak JSON-RPC over stdio. No port exposed.
ENTRYPOINT ["node", "dist/server.js"]
