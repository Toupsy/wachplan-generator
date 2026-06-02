# ============================================================
# Dockerfile für DLRG Wachplan-Generator
# Multi-stage build für kleine Production-Images
# ============================================================

# ─── Builder Stage ───────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install dependencies with exact versions for reproducibility
RUN npm ci --only=production

# ─── Runtime Stage ───────────────────────────────────────
FROM node:18-alpine

# Metadata
LABEL maintainer="DLRG"
LABEL description="Single-Page Application für DLRG Wachplangeneration"
LABEL version="1.0.0"

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy production dependencies from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=nodejs:nodejs . .

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["npm", "start"]
