# 02 · Data Model — Postgres migrations

> **Conversational Layer PRD** · split 31.5.2026 · [↩ index](README.md) · source §7

All new tables: `business_id`-scoped, RLS enabled, `created_at timestamptz default now()`, FK to `businesses`. Next migration = `033`.

| Migration | Table | Purpose | Phase |
|---|---|---|:--:|
| `033` | `conversations` | session header + rolling summary + last intent | 1 |
| `034` | `conversation_messages` | turns; `artifacts` jsonb; `related_approval_ids` | 1 |
| `035` | `strategic_memory` | the **operator brain** — preferences, what failed/converts, seasonal, rejected strategies | 1 (schema) / 3 (use) |
| `036` | `recommendation_ledger` | ⭐ anti-repetition: fingerprint, cooldown, novelty | 1 (recommended) / 3 |
| `037` | `campaign_drafts` | draft store before promotion to `approvals` | 2 |
| `038` | `creative_intelligence` | image/video content tags (see [07](07-creative-intelligence.md)) | 4 |
| `039` | `lead_outcomes` | CRM-fed downstream outcomes (won/lost/deal value/no-show) (see [08](08-leads-crm-whatsapp.md)) | 5 |
| `040` | `cross_client_benchmarks` (matview) | aggregated cross-client patterns, min 3 accounts/cohort (see [10](10-elevators-postmvp.md) §17.3) | post-MVP |
| `040` (parallel) | `whatsapp_conversations` + `whatsapp_messages` | WhatsApp transcripts per lead (see [08](08-leads-crm-whatsapp.md) §8.8.1) | 5 |

## DDL (Phase 1–2 core: `033`–`037`)

```sql
-- 033_conversations.sql
create table conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  title text, status text not null default 'active',
  summary text, last_intent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_business_idx on conversations(business_id, updated_at desc);

-- 034_conversation_messages.sql
create table conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  business_id uuid not null references businesses(id),
  role text not null,                       -- operator | agent | system
  content text not null,
  intent text, intent_confidence numeric,
  artifacts jsonb default '[]',             -- action_cards, draft refs, embeds
  related_approval_ids uuid[] default '{}',
  token_usage jsonb,
  created_at timestamptz not null default now()
);
create index conv_msg_idx on conversation_messages(conversation_id, created_at);

-- 035_strategic_memory.sql
create table strategic_memory (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  kind text not null,   -- preference|dislike|what_failed|what_converts|seasonal_pattern|
                        -- rejected_strategy|positioning_insight|audience_insight|offer_insight
  key text not null,                        -- canonical handle e.g. "tone:warm_family"
  value jsonb not null,
  confidence numeric not null default 0.5,
  source text not null,                     -- conversation|flow|operator_explicit|outcome
  source_conversation_id uuid references conversations(id),
  evidence_refs jsonb default '[]',
  reinforced_count int not null default 1,
  last_reinforced_at timestamptz not null default now(),
  expires_at timestamptz,                   -- null=durable; set for seasonal/transient
  created_at timestamptz not null default now()
);
create unique index strategic_memory_key_idx on strategic_memory(business_id, kind, key);

-- 036_recommendation_ledger.sql
create table recommendation_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  fingerprint text not null,                -- hash(intent, target_kind, target_id, action_class)
  intent text, action_class text not null,
  target_kind text, target_id text,
  human_summary text not null,
  times_proposed int not null default 1,
  first_proposed_at timestamptz not null default now(),
  last_proposed_at timestamptz not null default now(),
  status text not null default 'open',      -- open|accepted|rejected|superseded|acted
  cooldown_until timestamptz, novelty_score numeric, outcome jsonb,
  created_at timestamptz not null default now()
);
create unique index rec_ledger_fp_idx on recommendation_ledger(business_id, fingerprint);
create index rec_ledger_cooldown_idx on recommendation_ledger(business_id, status, cooldown_until);

-- 037_campaign_drafts.sql
create table campaign_drafts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  conversation_id uuid references conversations(id),
  status text not null default 'draft',     -- draft|proposed|discarded|promoted
  structure jsonb not null,
  promoted_approval_id uuid references approvals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaign_drafts_idx on campaign_drafts(business_id, status, updated_at desc);
```

## Later-phase tables (DDL defined in their domain files)
- `038 creative_intelligence` → [07-creative-intelligence.md](07-creative-intelligence.md)
- `039 lead_outcomes` → [08-leads-crm-whatsapp.md](08-leads-crm-whatsapp.md): `business_id · lead_id (FK leads) · crm_lead_id · stage · status (won|lost|no_show|in_progress) · deal_value_ils · close_reason · occurred_at · raw jsonb`
- `040 whatsapp_*` and `040 cross_client_benchmarks` → [08](08-leads-crm-whatsapp.md) / [10](10-elevators-postmvp.md)
