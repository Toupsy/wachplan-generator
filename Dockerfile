# ============================================================
# Dockerfile für DLRG Wachplan-Generator
# ============================================================

# Multi-stage build: Kleine finale Image
FROM node:18-alpine AS base

# Metadaten
LABEL maintainer="DLRG"
LABEL description="Single-Page Application für DLRG Wachplangeneration"

# Working Directory
WORKDIR /app

# Dependencies installieren
COPY package.json package-lock.json* ./
RUN npm install --only=production

# Alle App-Dateien kopieren
COPY . .

# Port exposieren
EXPOSE 3000

# Health Check (Docker erkennt Crashes)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Server starten
CMD ["npm", "start"]
