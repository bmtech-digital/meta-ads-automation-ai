# syntax=docker/dockerfile:1.6
#
# Campaigner webhook (Flask + gunicorn). Build context: ./webhook
# Image: us-central1-docker.pkg.dev/bemtech-478413/generic-agent-repo/campaigner-webhook

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py .

EXPOSE 8080

CMD exec gunicorn --bind :$PORT --workers 1 --threads 2 --timeout 30 app:app
