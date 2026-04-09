# Dry Run Mode

The ads-optimizer skill is currently in **DRY RUN** mode — it reads account data and produces recommendations but never executes changes.

## What's blocked
All MCP write tools: `update_adset`, `pause_adset`, `pause_ad`, `create_adset`

## What still works
All MCP read tools: `get_campaigns`, `get_adsets`, `get_ads`, `get_insights`

Full analysis pipeline runs normally (Health Scores, ad-eater detection, budget rebalancing) — actions are presented as recommendations only.

## How to reverse

In `.agents/skills/ads-optimizer/SKILL.md`, find **Step 11** and replace the dry-run block with the original execution logic:

```markdown
## Шаг 11: Выполнение через MCP

После подтверждения пользователя:

\```
# Изменение бюджета
update_adset(adset_id="123456", daily_budget=3900)

# Пауза adset
pause_adset(adset_id="789012")

# Пауза объявления
pause_ad(ad_id="345678")

# Создание нового adset (если есть креативы в конфиге)
create_adset(
  account_id="act_XXX",
  campaign_id="123456",
  name="Тест креативов #1",
  daily_budget=1500,
  optimization_goal="OFFSITE_CONVERSIONS",
  billing_event="IMPRESSIONS",
  targeting={...}
)
\```
```

Then delete this file.
