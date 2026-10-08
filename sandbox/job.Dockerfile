# syntax=docker/dockerfile:1
FROM python:3.12-bookworm AS python

FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git coreutils libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 sandbox \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /tmp sandbox
COPY --from=python /usr/local /usr/local
COPY job_exec.py /usr/local/bin/ordivant-exec
COPY job_files.py /opt/ordivant/job_files.py
RUN chmod 0555 /usr/local/bin/ordivant-exec /opt/ordivant/job_files.py
ENV HOME=/tmp PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 PYTHONNOUSERSITE=1
USER 10001:10001
WORKDIR /workspace
CMD ["sleep", "infinity"]
