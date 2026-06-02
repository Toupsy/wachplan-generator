FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache su-exec \
 && addgroup -g 1001 -S nodejs \
 && adduser -S nodejs -u 1001 \
 && printf '#!/bin/sh\nset -e\nmkdir -p /app/data\nchown nodejs:nodejs /app/data\nexec su-exec nodejs "$@"\n' > /entrypoint.sh \
 && chmod +x /entrypoint.sh

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]
