# syntax=docker/dockerfile:1
FROM ghcr.io/astral-sh/uv:0.8.11 AS uv

FROM python:3.12-slim AS production
WORKDIR /app
COPY --from=uv /uv /uvx /bin/
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project --compile-bytecode
COPY . ./sandbox
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8040
CMD ["uvicorn", "sandbox.main:app", "--host", "0.0.0.0", "--port", "8040"]
