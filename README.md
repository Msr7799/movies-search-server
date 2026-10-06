# Any Movie Server

باك إند مستقل وآمن للبحث الذكي عن الأفلام ومصادر العرض القانونية، مصمم لـ Vercel وللتكامل مع `any-movie-web` وتطبيق Android لاحقًا.

## ما الذي يقدمه؟

- فصل كامل بين مفتاح Gemini للبحث ومفتاح Gemini للاقتراحات التلقائية.
- خط بحث متعدد المراحل: فهم العنوان، توليد استعلامات محدودة، بحث Tavily متوازٍ، فلترة نطاقات قانونية، إزالة التكرار، ترتيب خوارزمي، ثم ترتيب Gemini موثّق بالنتائج الفعلية.
- استهلاك محافظ للخطة المجانية: Cache طويل، نموذج Flash-Lite افتراضي، بحث Tavily أساسي افتراضي، ومحاولات إعادة قصيرة فقط للأخطاء المؤقتة.
- Rate limiting موزع وCache موزع عند إضافة Upstash Redis، مع fallback محلي أثناء التطوير.
- Validation صارم، حد لحجم الطلب، CORS allowlist، Security Headers، Request IDs، رسائل أخطاء عامة لا تكشف المفاتيح أو تفاصيل المزوّد.
- OpenAPI ووظائف Health وProviders ومسارات توافق مع الموقع القديم.
- لا يبحث في مواقع التورنت أو النسخ المقرصنة ولا يتجاوز DRM. الروابط إما رسمية أو مرخّصة أو مكتبات/أرشيفات عامة قانونية.

## المسارات

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api` | معلومات الخدمة |
| `GET` | `/api/openapi` | عقد OpenAPI |
| `GET` | `/api/v1/health` | جاهزية الخدمات بدون كشف الأسرار |
| `GET` | `/api/v1/providers` | قائمة المزوّدين المسموحين |
| `POST` | `/api/v1/suggestions` | اقتراحات العناوين بمفتاح AI المعزول |
| `POST` | `/api/v1/search` | البحث الكامل وترتيب روابط العرض القانونية |
| `POST` | `/api/suggest` | توافق مع `any-movie-web` الحالي |
| `POST` | `/api/discover` | توافق مع `any-movie-web` الحالي |

### مثال بحث

```bash
curl -X POST "https://YOUR-PROJECT.vercel.app/api/v1/search" \
  -H "Content-Type: application/json" \
  -d '{"query":"ديفداس","movieLanguage":"hi","subtitleLanguage":"ar","allowShortClips":false}'
```

صيغة النجاح تحافظ على حقول الموقع الحالية (`understoodTitle`, `year`, `summary`, `results`) وتضيف `originalTitle`, `confidence`, و`meta`. كل خطأ يعاد بهذه الصيغة:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "رسالة آمنة للمستخدم",
    "requestId": "..."
  }
}
```

## الإعداد المحلي (بدون تشغيل السيرفر)

المشروع يستخدم `pnpm` فقط:

```bash
pnpm install
pnpm check
```

للتحقق من صلاحية المفاتيح الثلاثة مباشرة (يستهلك طلب اختبار صغير من كل مزود ولا يعرض الأسرار أو نصوص الرد):

```bash
pnpm smoke:providers
```

انسخ `.env.example` إلى `.env` محليًا وأضف القيم. ملف `.env` مستبعد من Git. لا تضع أي مفتاح داخل تطبيق الويب أو Android ولا تستخدم بادئة `NEXT_PUBLIC_`.

## الرفع إلى Vercel

1. أنشئ Git repository لهذا المجلد أو ارفعه داخل مستودع وحدد **Root Directory** إلى `any-movie-server`.
2. من Vercel اختر **Add New → Project** واربط المستودع.
3. اترك Framework Preset على **Other**؛ يثبت `vercel.json` الإعداد على `framework: null` ويحدد `public` كمخرج ثابت، بينما يكتشف Vercel ملفات TypeScript داخل `api/` كـ Node.js Functions.
4. أضف في **Settings → Environment Variables** القيم المطلوبة:
   - `TAVILY_API_KEY`
   - `GEMINI_API_KEY`
   - `GEMINI_AUTO_SUGGESTED_API_KEY`
   - `ALLOWED_ORIGINS=https://YOUR-WEB-APP.vercel.app`
5. أضف الإعدادات الاختيارية من `.env.example`. ابدأ بـ `TAVILY_SEARCH_DEPTH=basic` للمحافظة على الرصيد.
6. يوصى بإنشاء قاعدة Upstash Redis مجانية وإضافة `UPSTASH_REDIS_REST_URL` و`UPSTASH_REDIS_REST_TOKEN`. بدونها يبقى السيرفر عاملًا، لكن Cache وRate Limit سيكونان لكل نسخة Function فقط.
7. نفّذ Deploy، ثم افتح `/api/v1/health`. يجب أن تكون `status` بقيمة `ready`. لا تُرجع Health أي قيمة سرية.
8. اختبر `/api/v1/suggestions` ثم `/api/v1/search`. راجع `X-Request-Id` عند تتبع خطأ في Vercel Logs.

بعد تغيير متغير بيئة في Vercel يجب تنفيذ Redeploy حتى يصل إلى النسخة المنشورة.

## ربط الويب لاحقًا

المساران `/api/discover` و`/api/suggest` موجودان لتقليل تغييرات الموقع. عند نشر الخادم على نطاق مستقل سيحتاج الويب إلى متغير عام واحد لعنوان الباك إند فقط، مثل `NEXT_PUBLIC_API_BASE_URL`; مفاتيح Gemini وTavily تبقى في مشروع الخادم ولا تُنقل إلى الواجهة.

## English deployment summary

### Ordered providers and HLS

Set `PROVIDERS` to a JSON array of `{ "domain", "name", "inAppPlayback" }` objects. Array order is the search and response priority; the first provider is priority 1. Set `PROVIDERS_IN_APP_PLAYBACK=true` to override every item with one Boolean switch. `GET /api/v1/providers` returns the effective active order and values. When an allowed result is already a direct HTTPS `.m3u8` URL on an enabled provider, the search response returns both `playUrl` and `hlsUrl` with `kind: "hls"`. Known YouTube, Vimeo, Archive.org, and Dailymotion pages use official embed URLs. Subscription/DRM pages remain external provider links; the server does not extract or bypass protected streams.

Deploy this folder as a Vercel project using the **Other** preset. Configure the three required server-only API keys and `ALLOWED_ORIGINS`. Add Upstash Redis for distributed caching and rate limiting across serverless instances. Validate `/api/v1/health`, then test suggestions and search. Never ship provider credentials in web or mobile builds.

## حدود مقصودة

- نتائج الاشتراكات والتوفر تختلف حسب البلد والحساب؛ يجب أن يفتح المستخدم صفحة المزوّد للتحقق.
- التشغيل داخل التطبيق لا يُعرض إلا لصيغ فيديو مباشرة مسموحة أو embeds معروفة. صفحات Netflix وShahid وغيرها تفتح في تطبيق/صفحة المزوّد بسبب DRM وسياسات التضمين.
- لا يمكن لـ CORS وحده حماية API عام يستخدمه تطبيق هاتف؛ الحماية الفعلية هنا هي التحقق، الحدود، Cache، ومخزن Redis الموزع. يمكن إضافة مصادقة مستخدمين لاحقًا إذا أصبح التطبيق قائمًا على حسابات.
