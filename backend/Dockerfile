# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONUTF8=1 \
    PATH="/opt/venv/bin:$PATH" UV_PROJECT_ENVIRONMENT=/opt/venv UV_LINK_MODE=copy \
    ORDIVANT_DATA_DIR=/data
WORKDIR /app
RUN groupadd --gid 10001 ordivant && useradd --uid 10001 --gid 10001 --create-home ordivant \
    && mkdir /data && chown ordivant:ordivant /data /app

FROM base AS dependencies
COPY --from=ghcr.io/astral-sh/uv:0.7.2 /uv /uvx /usr/local/bin/
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable

FROM dependencies AS development
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --extra dev
COPY tests ./tests
RUN chown -R ordivant:ordivant /app /opt/venv
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "ordivant.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/app/src", "--no-access-log"]

FROM base AS production
COPY --from=dependencies /opt/venv /opt/venv
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"
CMD ["uvicorn", "ordivant.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
