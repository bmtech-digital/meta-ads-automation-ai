# syntax=docker/dockerfile:1.6
#
# Campaigner agent image — Python 3.11 + Node 20 + Claude Code CLI.
# Used by k8s CronJobs (daily observe-propose, executor every 15min, weekly creative).
# Each CronJob overrides `command:` to invoke a runner script under runners/.

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        ca-certificates \
        git \
        libjpeg-dev \
        zlib1g-dev \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && pip install uv

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/uv \
    UV_HTTP_TIMEOUT=600 uv pip install --system -r requirements.txt

# Copy only what the runners need at runtime.
COPY campaigner ./campaigner
COPY runners ./runners
COPY migrations ./migrations
COPY scripts ./scripts
COPY meta_ads_manager.py image_generator.py ./

RUN chmod +x runners/*.sh

CMD ["bash"]
