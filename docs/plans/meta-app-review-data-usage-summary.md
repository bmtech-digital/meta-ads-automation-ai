# Data-Usage Summary — Campaigner by Aiweon

> **Purpose of this file:** One-pager attached to the Meta App Review submission, mapping each requested permission to the specific Meta data fields read, where those fields are stored, how long, and whether data leaves Aiweon's infrastructure.
>
> Meta reviewers ask for this explicitly during review for apps handling business data. Keeping it one page and precise shortens turnaround.

---

## Summary

Campaigner reads data from Meta's APIs on behalf of Aiweon's own Meta Business Manager, stores it in a secure internal database on Aiweon's infrastructure, and uses it to generate optimization proposals that a human operator approves before any write is performed back to Meta.

**No Meta-sourced data leaves Aiweon's infrastructure.** No data is sold, licensed, or shared with third parties.

---

## Per-permission data handling

| Permission              | Meta fields read                                                                                                              | Written back to Meta?                        | Stored where                                                                         | Retention                                                       | Leaves Aiweon infra? |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------- |
| `ads_read`              | Campaign/Ad Set/Ad metadata, daily insights (impressions, clicks, spend, CPR, CTR, hook rate, video retention)                | No — read-only                               | Internal DB, `agent_decisions.inputs` and `baselines` collections                    | 90 days for daily insights; indefinite in audit log             | No                   |
| `ads_management`        | Same metadata as `ads_read`. **Writes** status changes, budget adjustments, and new creative IDs — only after human approval. | **Yes** — on explicit operator approval only | Internal DB, `approvals.execution_result` and `agent_decisions`                      | Audit record indefinite                                         | No                   |
| `business_management`   | Business Manager asset lists — connected ad accounts, Pages, Pixels, linked assets (names + IDs)                              | No — read-only                               | Internal DB, used for per-run guardrail validation, not persisted as separate entity | Held only for the lifetime of one cron invocation; not retained | No                   |
| `pages_show_list`       | List of Page IDs and names accessible under the Business                                                                      | No — read-only                               | Not persisted (used in-memory for heartbeat validation)                              | N/A                                                             | No                   |
| `pages_read_engagement` | Aggregate engagement metrics on Page posts that back ads — reaction counts, comment counts, share counts, video retention     | No — read-only                               | Internal DB, `agent_decisions.inputs` (fatigue detection)                            | 90 days with insights                                           | No                   |
| `instagram_basic`       | Instagram Professional account ID and username linked to the Facebook Page                                                    | No — read-only                               | Not persisted (used in-memory for placement validation)                              | N/A                                                             | No                   |

---

## What is **not** collected or stored

- Personal data about individuals who view or click Aiweon's ads (no names, emails, phone numbers, device IDs, or ad-action-level user identifiers).
- Content of Page comments, direct messages, Message-thread data, or private Page insights beyond aggregate engagement counters.
- Data from Meta assets that Aiweon does not own and manage.

---

## Security controls

- **Transport:** All calls to Meta's APIs over HTTPS / TLS. All database traffic over encrypted connections.
- **Authentication:** Meta access tokens stored in a secrets management system separate from the application database; rotated on the schedule mandated by Meta (every 60 days for User Tokens, or persistent for System User Tokens after Business Verification).
- **Access:** Only authorized Aiweon personnel have access to the internal database and the operator CLI. Internal access is logged.
- **Audit log:** Every automated decision, human approval, and Meta API call is recorded in an immutable audit table with operator identity and timestamp.

---

## Data flow diagram (text)

```
Meta Graph API  --read-->  Campaigner backend  --stored-->  Internal DB
                              |                                |
                              +--proposal (text)-->  Approvals queue
                                                                |
                                           Operator review + approval
                                                                |
Meta Marketing API  <--write (approved only)--  Campaigner backend
                              |
                              +--decision log-->  Audit table (indefinite)
```

No outbound flow from Internal DB to any third party. No export of Meta-sourced fields to analytics platforms, BI tools, or external services.

---

## Data deletion

Per the [Data Deletion page](https://aiweon.co.il/data-deletion) and the [Privacy Policy](https://aiweon.co.il/privacy), data deletion requests are handled by email to admin@aiweon.co.il and completed within 30 days of verification. Audit log entries are retained in anonymized form (reference IDs only, no personal data) after deletion of source data.

---

## Contact

**Aiweon**
Email: admin@aiweon.co.il
Website: https://aiweon.co.il
