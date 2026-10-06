# Any Movie Server 1.9.0

خادم بحث عام واكتشاف وسائط لتطبيق Any Movie. لا توجد قائمة providers أو domains مفروضة على Tavily Search.

## البحث

`POST /api/v1/search`

مثال body:

```json
{
  "query": "Kal Ho Naa Ho 2003",
  "movieLanguage": "hi",
  "subtitleLanguage": "ar",
  "allowShortClips": false,
  "resultLimit": 10
}
```

`resultLimit` يقبل من 5 إلى 30، والافتراضي 10.

المسار:

1. Gemini يطبع/يصحح عنوان الفيلم والسنة والaliases.
2. Tavily Search يبحث في الويب العام، بدون `include_domains`.
3. السيرفر يفحص المرشحين بحثًا عن HLS/M3U8 أو فيديو مباشر داخل HTML/JSON/video/source/iframe/player links.
4. Master HLS يتم تحليله لعدد الجودات والصوت والترجمة، ويتم فحص variant للحصول على مدة تقريبية عندما يمكن ذلك.
5. إذا كانت المقاطع القصيرة غير مسموحة، يجب وجود دليل فيلم كامل أو مدة HLS مناسبة؛ live/short/trailer يُستبعد.
6. إذا تم تحديد لغة ترجمة، يجب وجود evidence لها في HLS `TYPE=SUBTITLES` أو `<track>` أو metadata واضحة في الصفحة.
7. إذا لم تكفِ النتائج، Tavily Crawl يعمل بشكل محدود على أفضل roots ثم تُفحص الصفحات الجديدة بنفس verifier.
8. لا ترجع نتيجة إلا إذا كان لديها `playUrl` أو `hlsUrl` تم التحقق منه.

## الحماية

- HTTP/HTTPS عام فقط.
- حظر loopback/private/link-local وDNS destinations غير العامة.
- حدود للredirects والحجم والمهلات وعمق الصفحات.
- لا bypass لتسجيل الدخول/paywalls/DRM ولا استخراج مفاتيح تشفير.
- `downloadable=true` فقط للملف المباشر الذي تم التحقق منه كـvideo response.

## Environment

```env
TAVILY_API_KEY=
GEMINI_API_KEY=
GEMINI_AUTO_SUGGESTED_API_KEY=

TAVILY_SEARCH_DEPTH=advanced
TAVILY_MAX_RESULTS=20
TAVILY_CRAWL_ROOTS=2
TAVILY_CRAWL_LIMIT=8
```

Upstash موصى به للكاش/rate-limit الموزع.

## Endpoints

- `POST /api/v1/search`
- `POST /api/v1/media`
- `POST /api/v1/suggestions`
- `GET /api/v1/providers` للتوافق فقط؛ يرجع `mode: open_web`
- `GET /api/v1/health`

## Search behavior in 1.9.0

Search is open-web and does not use a content-provider allow-list. The exact user query is preserved, indexed dynamic watch/player pages are retained when crawler rendering fails, and Gemini failure no longer prevents Tavily from searching.
