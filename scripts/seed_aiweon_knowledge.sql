-- Seed business_knowledge for Aiweon based on weon.co.il public content.
-- Facts extracted: product type (influencer marketing platform), Hebrew/IL,
-- WhatsApp contact, cross-channel (IG/TT/FB). Inferences clearly marked in
-- questionnaire_answers — Roi should review at /business-knowledge.

INSERT INTO business_knowledge (
  business_id,
  vertical,
  website_url,
  service_regions,
  customer_age_min,
  customer_age_max,
  products,
  delivery_time_days,
  strong_seasons,
  weak_seasons,
  questionnaire_answers,
  brand_voice,
  competitors,
  last_refreshed_at
) VALUES (
  '9f8f42d9-3f6c-4e2e-bc1a-b60f9ff551f3',
  'leads',
  'https://weon.co.il',
  ARRAY['ישראל'],
  25,
  55,
  jsonb_build_array(
    jsonb_build_object(
      'name', 'פלטפורמת Aiweon לשיווק משפיענים',
      'description', 'חיבור בין מותגים למשפיענים בעזרת AI — התאמה, ניהול קמפיין ומדידה. אינסטגרם/טיקטוק/פייסבוק.'
    )
  ),
  NULL,
  NULL,
  NULL,
  jsonb_build_object(
    'ideal_customer',
      'מנהלי שיווק / בעלי מותגים בישראל שרוצים לרוץ קמפיינים עם משפיענים. B2B — החלטות על תקציבי שיווק. (הסקה מתוכן האתר — לוודא.)',
    'main_pain',
      'מותגים מתקשים למצוא משפיענים רלוונטיים, לנהל את הקשר, ולמדוד ROI. התהליך הידני איטי ולא יעיל. (הסקה — לוודא.)',
    'usp',
      '"החזון שלך | הידע שלנו | הכוח של AI" — שילוב בין בינה מלאכותית להתאמת משפיענים לבין ידע שוקי אנושי. Tagline רשמי מהאתר.',
    'what_worked_before',
      '—',
    'what_failed_before',
      '—',
    'common_objections',
      'לא מופיע באתר — לוודא עם Roi.'
  ),
  jsonb_build_object(
    'tone', 'מקצועי, חדשני, נקי. השפה באתר קצרה ושיווקית. אין באתר דוגמאות של טון שיחה/CTA — לוודא.',
    'forbidden_words', ARRAY[]::text[]
  ),
  NULL,
  now()
)
ON CONFLICT (business_id) DO UPDATE SET
  vertical = EXCLUDED.vertical,
  website_url = EXCLUDED.website_url,
  service_regions = EXCLUDED.service_regions,
  customer_age_min = EXCLUDED.customer_age_min,
  customer_age_max = EXCLUDED.customer_age_max,
  products = EXCLUDED.products,
  questionnaire_answers = EXCLUDED.questionnaire_answers,
  brand_voice = EXCLUDED.brand_voice,
  last_refreshed_at = now();

UPDATE businesses
   SET primary_kpi = 'cpl'
 WHERE id = '9f8f42d9-3f6c-4e2e-bc1a-b60f9ff551f3';
