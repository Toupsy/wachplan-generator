FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app

RUN mkdir -p /app/data

COPY --from=builder /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
EXPOSE 3000

CMD ["npm", "start"]
