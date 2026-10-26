# syntax=docker/dockerfile:1
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Dependencies stay cached until package.json changes.
COPY --chown=node:node package*.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# Copy the server modules (every .js in the root) and the website files.
# A fixed list here broke deploys whenever a new module was added.
COPY --chown=node:node *.js ./
COPY --chown=node:node public ./public

# Writable target for Coolify persistent badge/profile storage.
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["node", "server.js"]
