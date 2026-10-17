FROM docker.io/oven/bun:1.4.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY build.js ./
COPY src ./src
RUN bun run build

FROM docker.io/oven/bun:1.4.3-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=6663
COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock ./
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/src ./src
COPY --chown=bun:bun server.jsx ./
USER bun
EXPOSE 6663
CMD ["bun", "server.jsx"]
