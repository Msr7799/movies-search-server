# Any Movie Server 1.3.0

خادم بحث واكتشاف وسائط عام للتطبيق. البحث لم يعد مربوطًا بقائمة مزودين أو دومينات محددة.

## مسار البحث

1. يفهم Gemini عنوان الفيلم واللغة/السنة.
2. Tavily Search يبحث في الويب العام بدون `include_domains`.
3. أفضل الصفحات تمر عبر فاحص وسائط محدود وآمن.
4. الفاحص يبحث في HTML/JSON و`video/source` وiframes وصفحات player القريبة عن HLS/M3U8 أو فيديو مباشر.
5. إذا لم تكفِ نتائج البحث المباشر، يستخدم الخادم Tavily Crawl بشكل محدود على أفضل النتائج لاكتشاف صفحات داخل الموقع نفسه ثم يفحصها محليًا.
6. لا يرجع التطبيق إلا نتيجة تم التحقق أن لها `playUrl` أو `hlsUrl`.

لا يوجد Provider allow-list. يبقى اسم `provider` في JSON فقط للتوافق مع التطبيق، وقيمته الآن اسم المضيف الذي جاءت منه الصفحة.

## الحماية

- HTTPS عام فقط.
- حظر loopback/private/link-local وDNS destinations غير العامة قبل fetch.
- حدود صارمة للمهلة، الحجم، redirects، عدد الصفحات وعمق الزحف.
- لا يوجد تجاوز لتسجيل الدخول أو paywalls أو DRM ولا استخراج مفاتيح تشفير.
- الملف المباشر فقط يعلّم `downloadable=true`; HLS لا يتحول تلقائيًا لتنزيل إذا لم يكن ملفًا مباشرًا.

## متغيرات البيئة

المطلوب:

- `TAVILY_API_KEY`
- `GEMINI_API_KEY`
- `GEMINI_AUTO_SUGGESTED_API_KEY`

مفيد للإنتاج:

- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- `TAVILY_SEARCH_DEPTH=advanced` لتحسين جودة البحث عند توفر الرصيد
- `TAVILY_MAX_RESULTS=10`
- `TAVILY_CRAWL_ROOTS=1`
- `TAVILY_CRAWL_LIMIT=5`

لإيقاف Tavily Crawl والإبقاء على Search + فحص HTML فقط، ضع `TAVILY_CRAWL_ROOTS=0`.

## Endpoints

- `POST /api/v1/search` بحث عام ثم اكتشاف وسائط
- `POST /api/v1/media` فحص أي رابط HTTPS عام أو التحقق من media request التقطه WebView
- `GET /api/v1/providers` يعاد للتوافق فقط ويعطي `mode: open_web` وقائمة فارغة
- `GET /api/v1/health` حالة المفاتيح/الخدمات

## ملاحظة عن الصفحات الديناميكية

الفحص السيرفري يستطيع اكتشاف manifests الموجودة في HTML/JSON والiframes والصفحات القريبة. إذا كان الموقع لا ينشئ رابط HLS إلا بعد JavaScript/interaction، WebView داخل تطبيق Android يراقب طلبات `m3u8/hls/playlist/manifest` أثناء تشغيل الصفحة ويرسل المرشح إلى `/api/v1/media` للتحقق ثم يحوله إلى Media3 عند نجاح الفحص.
