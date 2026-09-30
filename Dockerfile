# syntax=docker/dockerfile:1

# Stage 1: Build & Dependencies
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install all dependencies including devDependencies (for Tailwind compilation)
RUN npm ci

# Copy application source code
COPY . .

# Precompile Tailwind CSS bundle for production
RUN npm run build:css

# Prune devDependencies to keep container lightweight
RUN npm prune --omit=dev

# Stage 2: Production Runtime
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/phonemail.sqlite

# Copy built application and production dependencies from builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/public ./public

# Create persistent storage folder for SQLite database
RUN mkdir -p /app/data

# Expose web server port
EXPOSE 3000

# Health check to ensure server responds
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start PhoneMail server
CMD ["node", "server/index.js"]
