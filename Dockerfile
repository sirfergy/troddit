# Install dependencies only when needed
FROM node:24-slim AS deps

ENV NODE_ENV=production

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ make python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn config set network-timeout 600000 -g
RUN yarn install --frozen-lockfile 

# Rebuild the source code only when needed
FROM node:24-slim AS builder

ENV NODE_ENV=production

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry.
ENV NEXT_TELEMETRY_DISABLED 1

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build && yarn install --production --ignore-scripts --prefer-offline

# Production image, copy all the files and run next
FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV production

# Uncomment the following line in case you want to disable telemetry during runtime.
ENV NEXT_TELEMETRY_DISABLED 1

# Install CA certificates for SSL and GitHub Copilot CLI globally
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @github/copilot

RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 --gid nodejs --create-home nextjs

# You only need to copy next.config.js if you are NOT using the default configuration
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/public ./public
#use standalon/static
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy startup script
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs

ARG portnum=3000
EXPOSE ${portnum}
# Expose Copilot CLI server port
EXPOSE 4321

ENV PORT ${portnum}
ENV COPILOT_CLI_PORT 4321

CMD ["./docker-entrypoint.sh"]