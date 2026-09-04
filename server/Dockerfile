FROM node:22-alpine AS dependencies
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY server/package.json ./package.json
COPY server/src ./src
COPY server/migrations ./migrations
RUN chown -R node:node /app
USER node
EXPOSE 8787
CMD ["node", "src/index.js"]
