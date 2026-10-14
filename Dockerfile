FROM node:24.15.0-bookworm-slim AS app-build
WORKDIR /opt/project/app
COPY app/package*.json ./
RUN npm ci --no-audit --no-fund
COPY app/ ./
RUN npm run build && npm prune --omit=dev

FROM node:24.15.0-bookworm-slim AS runtime
ARG SOURCE_REVISION=unknown
ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    REPO_ROOT=/opt/project \
    PYTHON_BIN=/opt/solver/bin/python \
    ARTIFACT_DIR=/opt/project/artifacts \
    SOLVER_MODE=real \
    MODEL_REVISION=${SOURCE_REVISION}
LABEL org.opencontainers.image.title="IE402 Voxel Air Dispersion" \
      org.opencontainers.image.revision=${SOURCE_REVISION}
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/solver
COPY requirements-solver.txt /opt/project/requirements-solver.txt
COPY requirements-solver-lock.txt /opt/project/requirements-solver-lock.txt
RUN /opt/solver/bin/pip install --no-cache-dir -r /opt/project/requirements-solver-lock.txt
WORKDIR /opt/project
COPY src/ ./src/
COPY config/ ./config/
COPY db/ ./db/
COPY web/ ./web/
COPY pyproject.toml ./
COPY deploy/ ./deploy/
COPY --from=app-build /opt/project/app/dist ./app/dist/
COPY --from=app-build /opt/project/app/node_modules ./app/node_modules/
COPY app/package.json ./app/package.json
RUN mkdir -p artifacts data/processed \
    && chown -R node:node artifacts data \
    && chmod +x deploy/entrypoint.sh
WORKDIR /opt/project/app
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
    CMD node /opt/project/deploy/healthcheck.mjs
ENTRYPOINT ["/opt/project/deploy/entrypoint.sh"]
CMD ["node", "dist/main.js"]
