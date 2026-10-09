FROM docker.gitea.com/gitea:28.0.0

USER root
RUN apk add --no-cache python3

ENV PYTHONDONTWRITEBYTECODE=1
COPY initialize.py /opt/ordivant-gitea-init/initialize.py
ENTRYPOINT ["python3", "/opt/ordivant-gitea-init/initialize.py"]
