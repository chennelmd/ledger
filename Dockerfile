# ── Build + runtime image ──────────────────────────────────────────────────────
# Single-stage so drizzle-kit can read src/db/schema.ts at startup to
# initialise or migrate the SQLite database before the server boots.
FROM node:22-alpine

WORKDIR /app

# Install dependencies (includes drizzle-kit and tsx for migrations)
COPY package*.json ./
RUN npm ci

# Copy source and build the client + server
COPY . .
RUN npm run build

# ── Runtime config ─────────────────────────────────────────────────────────────

# /data holds the SQLite database. Mount a persistent volume here in PikaPods:
#   Container path: /data
VOLUME /data

ENV NODE_ENV=production
ENV DB_PATH=/data/app.db
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# 1. Push schema to /data/app.db (creates tables on first run; safe to re-run).
# 2. Start the production server.
CMD ["sh", "-c", "npx drizzle-kit push --force && node dist/server/server/index.js"]
