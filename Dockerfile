FROM oven/bun:1-alpine AS build

WORKDIR /app
ARG VITE_GLIVE_APIUSER
ARG VITE_GLIVE_KEY
ARG VITE_GLIVE_SPORTTYPES
ARG VITE_GLIVE_FORMAT
ENV VITE_GLIVE_APIUSER=$VITE_GLIVE_APIUSER
ENV VITE_GLIVE_KEY=$VITE_GLIVE_KEY
ENV VITE_GLIVE_SPORTTYPES=$VITE_GLIVE_SPORTTYPES
ENV VITE_GLIVE_FORMAT=$VITE_GLIVE_FORMAT
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 6663
