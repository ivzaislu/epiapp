FROM node:22-alpine

WORKDIR /app

COPY package.json server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

RUN addgroup -S epiapp && adduser -S -G epiapp epiapp \
    && mkdir -p /data \
    && chown -R epiapp:epiapp /data /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_FILE=/data/epiapp.json

USER epiapp
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>r.json()).then(v=>process.exit(v.ok===true?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
