# The voice worker's image (docs/03-roadmap-appendix/phase2.md §7.5), built from the repository
# root: docker build -f apps/voice-agent/Dockerfile .
# It holds only the worker, its two workspace packages (the contracts and the voice adapters) and
# their dependencies; no database client, no BOS secret. LiveKit Cloud Agents runs it in India with
# the variables of apps/voice-agent/.env.example. Deploying it is the owner's step, later.
FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/voice-agent/package.json apps/voice-agent/
COPY packages/contracts/package.json packages/contracts/
COPY packages/voice/package.json packages/voice/
# The worker's packages and the root's TypeScript runner (`tsx`), from the lockfile as it is.
RUN pnpm install --frozen-lockfile --filter "@shakti/voice-agent..." --filter "shakti-prime"
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/voice packages/voice
COPY apps/voice-agent apps/voice-agent
ENV NODE_ENV=production
USER node
CMD ["node", "--import", "tsx", "apps/voice-agent/src/main.ts", "start"]
