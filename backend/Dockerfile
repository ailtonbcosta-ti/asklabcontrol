FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm install --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl tini poppler-utils tesseract-ocr tesseract-ocr-data-por python3
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package*.json ./
COPY scripts ./scripts
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./scripts/*.py ./entrypoint.sh
RUN mkdir -p /data/uploads /tmp/sigtap
EXPOSE 3000
ENTRYPOINT ["/sbin/tini","--"]
CMD ["./entrypoint.sh"]
