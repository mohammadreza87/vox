# Official Playwright 1.64.0 Noble manifest resolved 2026-10-19; immutable base.
FROM mcr.microsoft.com/playwright@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f
USER root
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client && rm -rf /var/lib/apt/lists/* \
    && npm install --prefix /opt/vox playwright-core@1.64.0 --omit=dev --ignore-scripts --no-audit --no-fund \
    && groupadd --gid 10001 voxrunner && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin voxrunner
COPY worker.mjs tunnel-proxy.mjs /opt/vox/
RUN chmod 0555 /opt/vox/worker.mjs /opt/vox/tunnel-proxy.mjs
ENV NODE_ENV=production HOME=/tmp/vox-home PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER 10001:10001
WORKDIR /tmp
ENTRYPOINT ["node", "/opt/vox/worker.mjs"]
