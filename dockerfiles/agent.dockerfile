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

# Bake a Claude Code permissions allowlist into the image so headless `claude -p`
# in runners/*.sh can call campaigner.tools.* without per-turn approval prompts
# (which silently fail in non-interactive cron context — Claude returns
# success:true to indicate the turn finished, even when every Bash call denied).
RUN mkdir -p /app/.claude && cat > /app/.claude/settings.json <<'JSON'
{
  "permissions": {
    "allow": [
      "Bash(python -m campaigner.tools.list_approved *)",
      "Bash(python -m campaigner.tools.fetch_insights *)",
      "Bash(python -m campaigner.tools.load_baselines *)",
      "Bash(python -m campaigner.tools.load_business_knowledge *)",
      "Bash(python -m campaigner.tools.check_data_sufficiency *)",
      "Bash(python -m campaigner.tools.check_guardrails *)",
      "Bash(python -m campaigner.tools.recheck_guardrails *)",
      "Bash(python -m campaigner.tools.list_active_creatives *)",
      "Bash(python -m campaigner.tools.list_gallery_assets *)",
      "Bash(python -m campaigner.tools.compute_monthly_pace *)",
      "Bash(python -m campaigner.tools.suggest_where_to_save *)",
      "Bash(python -m campaigner.tools.generate_creative *)",
      "Bash(python -m campaigner.tools.log_decision *)",
      "Bash(python -m campaigner.tools.propose_task *)",
      "Bash(python -m campaigner.tools.execute_task *)",
      "Bash(python -m campaigner.tools.mark_failed *)",
      "Bash(python -m campaigner.tools.heartbeat *)"
    ],
    "deny": []
  }
}
JSON

CMD ["bash"]
