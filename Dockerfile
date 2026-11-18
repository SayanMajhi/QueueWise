FROM node:24-bookworm-slim AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/index.html frontend/vite.config.js ./
COPY frontend/src ./src
COPY frontend/public ./public
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node backend/src ./src
COPY --chown=node:node database /app/database
COPY --from=web --chown=node:node /app/frontend/dist /app/frontend/dist
WORKDIR /app
USER node
EXPOSE 3000
CMD ["node", "backend/src/server.js"]
