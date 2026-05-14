# Legacy upstream docs (Portuguese)

These files are inherited from the original upstream fork [`sandhere01/meta-ads-automation-ai`](https://github.com/sandhere01/meta-ads-automation-ai), which was a Brazilian-real-estate Meta Ads automation written in Portuguese.

They are kept for **historical reference only**. The current project (Aiweon, Israel, Hebrew, Claude Code agent) does not use them. Their topics — Meta App configuration, page permissions, public-mode activation, automation success diagnosis — are now covered by:

- [`../../plans/meta-app-review-submission.md`](../../plans/meta-app-review-submission.md) and the rest of the `meta-app-review-*` series — current Meta App review documentation.
- [`../../plans/task-2.3-keys-and-quotas.md`](../../plans/task-2.3-keys-and-quotas.md) — credential setup (Anthropic + GCP + Meta).
- [`../../../scripts/validate_credentials.py`](../../../scripts/validate_credentials.py) and [`../../../scripts/diagnose_page_permissions.py`](../../../scripts/diagnose_page_permissions.py) — validation scripts.
- [Root `CLAUDE.md`](../../../CLAUDE.md) "Setup & Configuration" — current setup flow.

## Files in this folder

| File | Original purpose |
|---|---|
| `ATIVAR_APP_MODO_PUBLICO.md` | How to activate the upstream Meta App in public/Live mode (Brazilian flow) |
| `CONFIGURACAO_META.md` | Original Meta credentials/setup walkthrough (PT) |
| `DIAGNOSTICO_COMPLETO.md` | Original "complete diagnostic" troubleshooting guide |
| `QUICK_START.md` | Original quick-start (in PT, real-estate-specific) |
| `SOLUCAO_PAGINA.md` | Page-permissions troubleshooting (PT) |
| `SUCESSO_AUTOMACAO.md` | Original success-state documentation |

## Why kept (not deleted)

- They preserve the upstream attribution chain (this is a fork).
- A future contributor may want to compare an obscure Meta-side gotcha against what the upstream documented; deleting them removes that reference.
- They are out of the working path now, so they don't pollute the root or mislead the agent.

**If you are a new contributor:** ignore this folder. The current docs are at [`../../`](../../) (`docs/`).
