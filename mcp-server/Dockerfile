FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY bin ./bin
COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY bin ./bin
COPY --from=build /app/dist ./dist
ENV GOJO_HOME=/app/gojo
RUN chmod +x /app/dist/gojo.js && ln -sf /app/dist/gojo.js /usr/local/bin/gojo

# Dev/container compatibility only. Official product entry is `gojo`.
CMD ["gojo", "mcp", "serve"]
