# محمد — PWA

رأس ثلاثي الأبعاد (Three.js) بيحكي عربي وإنجليزي، مربوط بمحادثة ذكاء اصطناعي حقيقية عن طريق backend
آمن (Vercel أو Netlify) بيحمي مفتاح الـ Anthropic API بحيث ما ينكشف بالمتصفح.

## البنية

```
src/App.jsx        ← الواجهة + الرأس ثلاثي الأبعاد (ينادي /api/chat فقط، ما بيلمس مفتاح الـ API)
api/chat.js         ← نسخة Vercel من الوسيط (Serverless Function)
netlify/functions/chat.js  ← نفس الوسيط بصيغة Netlify
public/manifest.json + public/sw.js  ← إعدادات الـ PWA (تثبيت + عمل أوفلاين للواجهة)
```

## 1) التشغيل محليًا

```bash
npm install
```

**على Vercel:**
```bash
npm i -g vercel
vercel dev        # بيشغل الواجهة + api/chat.js سوا على localhost:3000
```

**على Netlify:**
```bash
npm i -g netlify-cli
netlify dev        # بيشغل الواجهة + netlify/functions/chat.js سوا
```

> لاحظ: تشغيل `npm run dev` (Vite لحاله) مش كافي، لأنه ما رح يشغّل دالة الـ backend.
> استخدم `vercel dev` أو `netlify dev` زي ما فوق.

## 2) حط مفتاح الـ API

1. روح لـ [console.anthropic.com](https://console.anthropic.com) وسوي API key
2. محليًا: انسخ `.env.example` لملف اسمه `.env` أو `.env.local` وحط المفتاح فيه
3. على الاستضافة (Vercel/Netlify): بإعدادات المشروع → Environment Variables → أضف
   `ANTHROPIC_API_KEY` بنفس القيمة. **لا تحط المفتاح بالكود أو بأي ملف بيترفع لـ GitHub.**

## 3) النشر

**Vercel:**
```bash
vercel        # أول مرة بيسألك أسئلة إعداد، بعدين
vercel --prod
```

**Netlify:**
```bash
netlify deploy --build
netlify deploy --build --prod
```

كل وحدة رح تكتشف تلقائيًا إنه مشروع Vite + تبني `dist/` + تفعّل الدالة (`api/` أو `netlify/functions/`).

## 4) التثبيت كتطبيق (PWA)

بعد النشر، افتح الرابط من موبايلك:
- **أندرويد (Chrome)**: بيظهر اقتراح "إضافة للشاشة الرئيسية" تلقائيًا، أو من القائمة ⋮ → Install app
- **آيفون (Safari)**: زر المشاركة 🔗 → Add to Home Screen

## أيقونات

الأيقونات بمجلد `public/icons/` (192px و512px) مولّدة بنفس هوية الرأس (تيل غامق + عيون فيروزية
+ فم كهرماني). فيك تبدلها بأي وقت بنفس الأسماء.

## ملاحظات أمان مهمة

- المفتاح موجود بس بالـ backend (`process.env.ANTHROPIC_API_KEY`) — أبدًا ما يوصل للمتصفح
- الـ Service Worker بيتجنب الـ `/api/*` عمدًا حتى ردود محمد تضل حيّة، مش من الكاش
- إذا بدك تحد الاستخدام (rate limiting) عشان محدا يستهلك رصيدك، هاد شي ممكن نضيفه بالـ backend لاحقًا
