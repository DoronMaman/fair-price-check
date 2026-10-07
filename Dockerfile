# Portable image (Fly.io / Railway / any container host).
# NOTE: not built locally (no Docker on the dev machine); Render deploys use render.yaml instead.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build && npm test

FROM node:${NODE_VERSION}-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Runtime needs only the API's third-party deps; our code + @fpc/shared are in the bundle.
RUN npm ci --omit=dev -w @fpc/api && npm cache clean --force
COPY --from=build /app/apps/api/dist/server.mjs /app/apps/api/dist/server.mjs.map apps/api/dist/
COPY --from=build /app/apps/api/data apps/api/data
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "apps/api/dist/server.mjs"]
