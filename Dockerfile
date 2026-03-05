# =============================================================================
# GitIntel MCP Server — Multi-stage Production Dockerfile
# =============================================================================

# --- Stage 1: Build ---
FROM node:22-alpine AS builder

WORKDIR /app

# Install git (needed for smoke test during build verification)
RUN apk add --no-cache git

# Copy dependency manifests first for layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci --ignore-scripts

# Copy source
COPY tsconfig.json ./
COPY src/ src/

# Build TypeScript
RUN npm run build

# Prune devDependencies
RUN npm prune --production

# --- Stage 2: Production ---
FROM node:22-alpine AS production

# Labels for container registries
LABEL org.opencontainers.image.title="mcp-git-intel"
LABEL org.opencontainers.image.description="Git Intelligence MCP Server"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.vendor="GitIntel"
LABEL org.opencontainers.image.source="https://github.com/org/mcp-server"

# Install git (runtime dependency)
RUN apk add --no-cache git tini

# Create non-root user
RUN addgroup -g 1001 -S gitintel && \
    adduser -u 1001 -S gitintel -G gitintel

WORKDIR /app

# Copy built artifacts and production dependencies
COPY --from=builder --chown=gitintel:gitintel /app/dist/ dist/
COPY --from=builder --chown=gitintel:gitintel /app/node_modules/ node_modules/
COPY --from=builder --chown=gitintel:gitintel /app/package.json package.json

# Default repo mount point
RUN mkdir -p /repo && chown gitintel:gitintel /repo
VOLUME ["/repo"]

# Environment
ENV NODE_ENV=production
ENV GIT_INTEL_REPO=/repo

# Run as non-root
USER gitintel

# Health check — verify node process is alive
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
