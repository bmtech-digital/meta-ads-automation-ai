# Privacy Policy — Campaigner by Aiweon

> **Purpose of this file:** Source text for `https://aiweon.co.il/privacy`. English, since Meta App Review is English-only. Roi publishes this on the Aiweon website verbatim (or with equivalent legal review).
>
> **This is a draft for internal use.** Before publishing as a legal document on aiweon.co.il, have a lawyer or privacy professional review. Sections marked `[REVIEW]` are judgment calls that should be confirmed.

---

**Effective date:** [TO BE FILLED when published]
**Last updated:** [TO BE FILLED when published]

## 1. Who we are

This Privacy Policy describes how **Aiweon** (_"Aiweon," "we," "us"_) handles data in connection with **Campaigner**, an internal tool Aiweon uses to manage its own advertising activity on Facebook and Instagram.

Aiweon is a digital marketing agency and SaaS platform based in Israel.

**Contact:** admin@aiweon.co.il

## 2. Scope of this policy

Campaigner is an **internal, first-party tool**. It is used by Aiweon to operate Aiweon's own Meta ad accounts. Campaigner is **not** offered as a service to third parties or end users in its current form.

This policy therefore describes:

- Business data about Aiweon's **own** Meta ad account, Pages, and Pixel.
- Administrative data about Aiweon personnel operating the tool.

This policy does **not** describe the privacy practices of Meta Platforms (Facebook / Instagram). Data sourced from Meta remains subject to [Meta's own Privacy Policy](https://www.facebook.com/privacy/policy) while it is held by Meta.

## 3. Data we collect

Campaigner reads the following categories of data from Meta's APIs, on behalf of and limited to Aiweon's own Meta Business Manager:

| Category                   | Examples                                                                        | Source permission                        |
| -------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| Ad performance data        | Impressions, clicks, spend, cost-per-result, video retention, hook rate         | `ads_read`                               |
| Ad object metadata         | Campaign, ad set, and ad names, status, budget, targeting config                | `ads_read`, `ads_management`             |
| Business Manager context   | Ad account, Page, Pixel, and Business IDs owned by Aiweon                       | `business_management`, `pages_show_list` |
| Page engagement aggregates | Reactions, comments, shares, video retention on Page posts promoted as ads      | `pages_read_engagement`                  |
| Instagram linkage          | Instagram Professional account ID and username linked to Aiweon's Facebook Page | `instagram_basic`                        |

Campaigner does **not** collect:

- Personal data about individuals who view, click, or interact with Aiweon's ads (no names, emails, phone numbers, or device identifiers).
- Content of Page comments, direct messages, or private Page insights.
- Data from ad accounts or Pages that Aiweon does not own or manage directly.

## 4. Why we collect it

- **To evaluate campaign performance** and detect creative fatigue (`ads_read`, `pages_read_engagement`).
- **To generate optimization proposals** that an Aiweon operator reviews and approves before any change is applied (`ads_management`).
- **To verify that operations target Aiweon's legitimate assets** — an internal safety guardrail that prevents publishing to the wrong Page or ad account (`business_management`, `pages_show_list`, `instagram_basic`).

Every automated decision is reviewed and approved by a human operator before execution. No change is applied to Meta assets without explicit human approval.

## 5. How and where data is stored

Data read from Meta is stored in a secure internal database hosted on Aiweon's infrastructure. Access is restricted to authorized Aiweon personnel. Data is encrypted in transit (HTTPS / TLS). Authentication credentials (such as Meta access tokens) are stored in a secrets management system separate from application data.

Data does **not** leave Aiweon's infrastructure. Campaigner does not share Meta-sourced data with any third party.

## 6. Retention

| Data                                                | Retention                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| Ad performance insights (daily snapshots)           | 90 days                                                                  |
| Audit log of agent decisions and operator approvals | Indefinite (required for internal traceability and compliance review)    |
| Generated creative assets (images, copy)            | Indefinite while campaigns remain active, or until deletion is requested |

Retention of Meta-sourced data shall not exceed the periods described above. Aiweon reviews retention policies annually.

## 7. Your rights and data deletion

Any person or entity whose data Aiweon has collected via Campaigner may request access, correction, or deletion of that data. Because Campaigner's MVP scope covers only Aiweon's own business data, rights are typically exercised by Aiweon itself; however, a formal deletion process is documented at [https://aiweon.co.il/data-deletion](https://aiweon.co.il/data-deletion).

For all data-related inquiries: **admin@aiweon.co.il**.

## 8. Data transfers

Aiweon is based in Israel. Some of our service providers (database hosting, cloud infrastructure) may process data outside Israel. Where this occurs, we select providers that maintain industry-standard security practices and, where applicable, comply with international data transfer frameworks. `[REVIEW: confirm against final remote-infrastructure choice once decisions-log §1.4 is re-closed.]`

## 9. Children's data

Campaigner does not knowingly collect data from or about children under the age of 13 (or 16 in jurisdictions where that is the applicable threshold). Aiweon's ads are targeted at adults in line with Meta's advertising policies.

## 10. Changes to this policy

We may update this Privacy Policy from time to time. The "Last updated" date at the top of this page reflects the most recent version. Material changes will be communicated via Aiweon's website.

## 11. Contact

For questions about this policy or about data handling in Campaigner:

**Aiweon**
Email: admin@aiweon.co.il
Website: https://aiweon.co.il
