# ============================================================
# Dockerfile für DLRG Wachplan-Generator
# ============================================================

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
LABEL maintainer="DLRG"

WORKDIR /app

# su-exec: lightweight privilege-drop tool (replaces sudo/gosu on Alpine)
RUN apk add --no-cache su-exec

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy deps + app code
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

# Entrypoint runs as root, fixes /app/data permissions, then drops to nodejs
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.sh

ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npm", "start"]
