FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN node scripts/download-font.js

ENV PORT=7860
ENV USE_SMT=true
ENV SMT_MODEL=/app/model.json.gz

EXPOSE 7860

CMD ["node", "server.js"]
