# WindSwordAI hosted gateway: serves the UI and the API from one https origin.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN node scripts/build-local.mjs
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "scripts/run-gateway.mjs"]
