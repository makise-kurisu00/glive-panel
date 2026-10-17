FROM docker.io/oven/bun:1.4.3-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM dependencies AS build
COPY build.js ./
COPY src ./src
RUN bun run build

FROM docker.io/oven/bun:1.4.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=6663
COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock ./
COPY --from=dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/src/App.jsx ./src/App.jsx
COPY --from=build --chown=bun:bun /app/src/server ./src/server
COPY --chown=bun:bun server.jsx ./
USER bun
EXPOSE 6663
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e 'const response = await fetch(`http://127.0.0.1:${process.env.PORT || 6663}/healthz`); process.exit(response.ok ? 0 : 1);'
CMD ["bun", "server.jsx"]
