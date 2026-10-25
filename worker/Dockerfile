FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS build
ENV PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev && npm audit --omit=dev --audit-level=high && npm cache clean --force
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates unzip libvulkan1 fonts-liberation libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 libcairo2 libglib2.0-0t64 libdbus-1-3 && rm -rf /var/lib/apt/lists/*
COPY worker/install-chromium.mjs worker/chromium.json ./worker/
RUN node worker/install-chromium.mjs
RUN find /usr /bin /sbin /opt -xdev -type f -perm /6000 -exec chmod a-s {} +
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY src/lib/capture-engine.ts src/lib/capture-worker-contract.ts src/lib/capture-browser.ts src/lib/capture-proxy.ts src/lib/capture-login.ts src/lib/scout-access.ts src/lib/public-network.ts ./src/lib/
COPY worker/main.ts worker/run.ts worker/transport.ts worker/preflight.ts worker/preflight-main.ts ./worker/
FROM build AS runtime
ENV NODE_ENV=production CAPTURE_WORKER_BROWSER=chrome-for-testing CAPTURE_CHROMIUM_EXECUTABLE=/opt/chromium-runtime/chrome-headless-shell LD_LIBRARY_PATH=/opt/chromium-runtime FONTCONFIG_PATH=/etc/fonts HOME=/tmp
USER 10001:10001
CMD ["node","--import","tsx","worker/main.ts"]
FROM runtime AS test
COPY tests/worker/container-fixture.ts ./tests/worker/
CMD ["node","--import","tsx","tests/worker/container-fixture.ts"]
