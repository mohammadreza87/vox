FROM node:22.23.3-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY scripts/gemini-live-relay.mjs scripts/
COPY src/features/call/lib/gemini-access.mjs src/features/call/lib/gemini-voices.mjs src/features/call/lib/
USER node
ENV NODE_ENV=production
CMD ["node", "scripts/gemini-live-relay.mjs"]
