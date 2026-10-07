# Any Movie Server 2.1.0

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

ADMIN_USERNAME=admin
ADMIN_PASSWORD=use-at-least-12-characters
ADMIN_SESSION_SECRET=use-at-least-32-random-characters

MONGODB_URI=
MONGODB_DATABASE=any_movie_control

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
- `GET /api/v1/catalog` الكتالوج العام
- `POST /api/v1/history` مزامنة سجل المشاهدة بعد موافقة المستخدم
- `/api/admin/catalog` إدارة كتالوج HLS (تتطلب جلسة الأدمن)
- `/api/admin/history` عرض وتعديل وحذف سجل المشاهدة العام (تتطلب جلسة الأدمن)
- `/api/admin/catalog/from-tmdb` إضافة بيانات فيلم أو مسلسل من TMDB (تتطلب جلسة الأدمن)

## لوحة الإدارة

تُحفظ مفاتيح Tavily وGemini الإضافية مشفرة في MongoDB ولا تعاد قيمها إلى
العميل. يمكن استيراد JSON من HLS Collector، وإضافة البيانات الوصفية عبر TMDB،
وإدارة روابط HLS وسجل المشاهدة من تطبيق Kotlin. المستورد
يقبل HTTPS HLS فقط، يتجاهل telemetry والملفات غير المرئية، ويحتاج تأكيد حقوق
النشر قبل الحفظ. هذا الخادم مخصص لعملاء تطبيق Kotlin ولا تعتمد عليه واجهة
`any-movie-web`.

تسجيل المشاهدة العام اختياري ويطلب موافقة المستخدم في تطبيق Android؛ يرسل اسم
الفيلم وملصقه والتقدم ومعرّف تثبيت عشوائيًا، ولا يرسل رابط البث أو معرّف حساب
Firebase. تُحفظ السجلات في مجموعة MongoDB `playback_history`.

## Search behavior in 1.9.0

Search is open-web and does not use a content-provider allow-list. The exact user query is preserved, indexed dynamic watch/player pages are retained when crawler rendering fails, and Gemini failure no longer prevents Tavily from searching.
