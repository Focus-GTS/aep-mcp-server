# syntax=docker/dockerfile:1.7

# ---------- Builder stage ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Dependencies first, so a source-only change reuses the install layer.
# `npm ci` (not `npm install`) — this project ships a package-lock.json and a
# reproducible build must honour it. There is no pnpm-lock.yaml; using pnpm
# here silently resolves different versions than CI tested.
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Build the TypeScript sources
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Fail the image build if the output cannot actually load. Catches a build that
# emits files but produces an unusable entrypoint.
RUN node --input-type=module -e "\
  const { registerAllTools } = await import('./dist/tools/index.js'); \
  const names = []; \
  registerAllTools({ registerTool: n => names.push(n), tool: n => names.push(n) }, \
    { client:{}, tokenCache:{}, credentials:{ clientId:'x', clientSecret:'y', \
      orgId:'z@AdobeOrg', sandboxName:'dev' } }); \
  if (!names.length) { console.error('no tools registered'); process.exit(1); } \
  console.log('build verified:', names.length, 'tools'); \
"

# Drop dev dependencies from what gets copied into the runtime image
RUN npm prune --omit=dev

# ---------- Runtime stage ----------
FROM node:22-alpine AS runtime

# Adobe IMS is HTTPS; the slim base needs a CA bundle to verify it
RUN apk add --no-cache ca-certificates && update-ca-certificates

WORKDIR /app

# Run unprivileged. The node image ships a `node` user for exactly this.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json
USER node

# Environment
#   Required : AEP_CLIENT_ID, AEP_CLIENT_SECRET, AEP_ORG_ID
#   Optional : AEP_SANDBOX_NAME (default: prod)
#              AEP_MODE         (read-only | safe | production; default: safe)
#              LOG_LEVEL        (default: info)
#              AEP_REQUEST_TIMEOUT_MS (default: 30000)
#              AEP_MAX_RETRIES        (default: 3)
#
# The server starts even when credentials are invalid: it will complete an MCP
# handshake and list its tools, and individual calls return structured
# AEP_AUTH_* errors. That makes the image verifiable with placeholder
# credentials, which registries rely on.

# MCP speaks JSON-RPC over stdio. No port is exposed, and stdout is reserved
# for the protocol — all logging goes to stderr.
ENTRYPOINT ["node", "dist/server.js"]
