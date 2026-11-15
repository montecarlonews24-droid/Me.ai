// Me.ai Job Scout — Agent بيدوّر على شغل فريلانس لـ Moe كل يوم
// الخطوة 1: بحث بـ 3 أسواق (عربي، أمريكا/أوروبا، الشرق الأقصى/أستراليا)
// الخطوة 2: بيتأكد إنه الروابط حقيقية (من نتائج البحث نفسها)
// الخطوة 3: حكم صارم + عرض جاهز لكل فرصة
import fs from 'fs';
import path from 'path';

const KEYS = (process.env.GEMINI_API_KEY || '').split(',').map(s => s.trim()).filter(Boolean);
const MODELS = ['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-4-hydrogen'];
const DIR = path.join(process.cwd(), 'reports');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Amman' });
const trace = [];

if (!KEYS.length) { console.error('GEMINI_API_KEY missing'); process.exit(1); }
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

function log(step, msg) {
  console.log(`[${step}] ${msg}`);
  trace.push({ step, msg });
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function extractJSON(text) {
  text = text.replace(/```json|```/g, '');
  const s = text.indexOf('{');
  if (s < 0) throw new Error('no JSON in reply');
  const body = text.slice(s, text.lastIndexOf('}') + 1);
  try { return JSON.parse(body); } catch (err) {
    // تصليح: فواصل زيادة قبل } أو ]
    const fixed = body.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(fixed); } catch {}
    // إنقاذ: إذا الرد انقطع بالنص، منخلي العناصر الكاملة ومنسكّر القائمة
    const raw = text.slice(s);
    for (let i = raw.lastIndexOf('}'); i > 0; i = raw.lastIndexOf('}', i - 1)) {
      for (const tail of [']}', ']}]}', '}']) {
        try {
          const o = JSON.parse(raw.slice(0, i + 1) + tail);
          if (o && typeof o === 'object') return o;
        } catch {}
      }
    }
    throw err;
  }
}

// يسأل Gemini، ويلف على الموديلات والمفاتيح لحد ما ينجح
async function ask(prompt, { search = false } = {}) {
  let lastErr = '';
  for (const model of MODELS) {
    for (const [i, key] of KEYS.entries()) {
      try {
        const body = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: search ? 0.9 : 0.4 }
        };
        if (!search) body.generationConfig.responseMimeType = 'application/json';
        if (search) body.tools = [{ google_search: {} }];
        let r, data;
        for (let attempt = 0; attempt < 3; attempt++) {
          r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify(body)
          }
        );
          data = await r.json();
          const busy = r.status === 503 || /high demand|overloaded|try again later/i.test(data.error?.message || '');
          if (!busy || attempt === 2) break;
          console.log(`  ~ ${model} busy, waiting ${20 * (attempt + 1)}s then retrying`);
          await new Promise(res => setTimeout(res, 20000 * (attempt + 1)));
        }
        if (!r.ok) { lastErr = data.error?.message || r.status; console.log(`  x ${model} key${i + 1}: ${lastErr}`); continue; }
        const cand = data.candidates?.[0];
        const text = (cand?.content?.parts || []).map(p => p.text || '').join('');
        const sources = (cand?.groundingMetadata?.groundingChunks || [])
          .map(c => c.web).filter(Boolean)
          .map(w => ({ title: w.title, url: w.uri }));
        let json;
        try {
          json = extractJSON(text);
        } catch {
          // الرد طلع كلام بدل JSON: منطلب من نفس الموديل يرتبه كـ JSON بدون بحث
          if (!text.trim()) throw new Error('empty reply');
          console.log(`  ~ ${model}: reply was not JSON, asking to reformat`);
          const fix = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: `Convert the answer below into ONLY a valid JSON object that follows the format requested in the original task. No markdown, no prose.\n\nORIGINAL TASK:\n${prompt}\n\nANSWER TO CONVERT:\n${text}` }] }],
                generationConfig: { temperature: 0, responseMimeType: 'application/json' }
              })
            }
          );
          const fd = await fix.json();
          if (!fix.ok) throw new Error(fd.error?.message || fix.status);
          json = extractJSON((fd.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''));
        }
        return { json, sources, model };
      } catch (e) {
        lastErr = e.message;
        console.log(`  x ${model} key${i + 1}: ${e.message}`);
      }
    }
  }
  throw new Error('All models failed: ' + lastErr);
}

// روابط البحث من Google بتيجي مخفية ورا redirect: منفتحها عشان ناخد الرابط الحقيقي
async function realUrl(u) {
  if (!/grounding-api-redirect|vertexaisearch/.test(u)) return u;
  try {
    const r = await fetch(u, { redirect: 'manual' });
    return r.headers.get('location') || u;
  } catch {
    return u;
  }
}

// بيفتح الرابط فعلياً: بيرجع رقم الحالة ونص الصفحة (0 إذا ما فتح)
async function page(u) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(u, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', 'Accept-Language': 'en,ar' } });
    clearTimeout(t);
    let text = '';
    if (r.ok) {
      const html = (await r.text()).slice(0, 400000);
      text = html
        .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ').trim().slice(0, 1800);
    }
    return { st: r.status, text };
  } catch {
    return { st: 0, text: '' };
  }
}

// صفحات قوائم وبحث (مش مشروع واحد): بترمى فوراً
const LISTING = /(\/job-search\/|\/jobs?\/?$|\/search|[?&](q|query|keywords?)=|\/freelance-jobs\/?$|\/category\/|\/tags?\/|\/careers?\/?$|\/courses?\/|\/sessions?\/|\/blog\/)/i;

// لكل منصة: شكل رابط المشروع الحقيقي
const PROJECT_SHAPE = [
  [/freelancer\./, /\/projects\/[^/]+\/[^/]+/],
  [/upwork\.com/, /\/(freelance-jobs\/apply|jobs)\/[^/]*~/],
  [/mostaql\.com/, /\/project\/\d+/],
  [/khamsat\.com/, /\/community\/requests\/\d+/],
  [/reddit\.com/, /\/comments\/\w+/],
  [/linkedin\.com/, /\/(posts|feed\/update|jobs\/view)\//]
];
function badShape(u) {
  const raw = String(u);
  if (LISTING.test(raw)) return 'listing/search page';
  const h = host(raw);
  for (const [site, shape] of PROJECT_SHAPE) if (site.test(h) && !shape.test(raw)) return `not a project page on ${h}`;
  return '';
}

const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// مواقع بتسكّر صفحاتها على البوتات: منقبل الرابط إذا شكله صفحة مشروع، والبحث وصل لنفس الموقع
const PROJECT_PAGE = /(upwork\.com\/(freelance-jobs\/apply|jobs)\/|linkedin\.com\/(posts|feed\/update|jobs\/view)\/|freelancer\.com\/projects\/|reddit\.com\/r\/\w+\/comments\/|mostaql\.com\/project\/|khamsat\.com\/community\/requests\/|contra\.com\/|wellfound\.com\/)/;

// الرابط بدون domain فاضي (لازم يكون صفحة، مش موقع كامل)
const deep = u => { try { return new URL(u).pathname.replace(/\/+$/, '').length > 1; } catch { return false; } };

const clean = u => String(u || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();

const ABOUT = `Moe (Mohammad) is an independent app maker in Amman, Jordan (brand: Monte-Carlo24). He builds AI-powered Android apps with AI-assisted development: he designs, plans, directs, tests and publishes; AI tools help write the code. He works from a phone, alone.
Proven, live work:
- 4 apps live on Google Play: Peace & Conflict 24 (news dashboard, live chat, in-app billing), Islam Rising (worship tracker used in 177 countries), SCANIQ (AI image recognition with Gemini Vision), STACK! Tower Rush (casual game)
- Flicker: native Kotlin NFC & tracker scanner (Bluetooth/Wi-Fi/NFC), in closed testing
- Me.ai: his own daily AI research agent (Gemini + web search on GitHub Actions, no server) with a native Android app
What he CAN deliver: Android apps (native Kotlin or hybrid WebView), website-to-app, Firebase backend (login, database, push), AdMob, Gemini AI features (vision, chat, smart search), NFC/Wi-Fi/Bluetooth features, daily AI research/monitoring agents, Google Play publishing and rejection fixes, Arabic + English apps with full RTL.
What he CANNOT do: iOS / App Store publishing, Flutter/React Native/Swift codebases, joining a company team as a full-time engineer, live coding interviews, large backends, blockchain, games beyond simple casual.
Languages: Arabic (native) and English.
Portfolio link (all his live apps on Google Play): https://play.google.com/store/apps/developer?id=MonteCarlo+News24`;

const RULES = `REJECT a lead if ANY of these is true:
- It is a full-time or staff job at a company (titles with Senior, Staff, Lead, Engineer, "X years experience", interviews, relocation, salary per year).
- It requires iOS / App Store, Flutter, React Native, Swift, or working inside an existing large codebase.
- It is closed, expired, or older than 14 days.
- The scope is clearly much bigger than the budget (example: Android + iOS + web admin + chat + maps for $250-750).
- It is not a real request from a client hiring for a project (courses, training sessions, tutorials, articles, ads, product pages, job boards, careers pages, freelancers advertising themselves).
- It is outside what Moe can deliver (see profile). This includes: SQL/MySQL/PHP/WordPress work, database migration or data extraction, web scraping, data entry, DevOps/servers, and anything that collects or exports people's personal data (phone numbers, emails, contacts).
- The client needs a specialist in a technology Moe does not use (e.g. Laravel, .NET, Unity, Swift, Flutter, React Native).
PREFER: Android-only apps, website-to-app, AI features in an app, AI agents/automation/research bots, Google Play publishing or rejection fixes, NFC/Bluetooth apps, Arabic/RTL apps.
PREFER clients from the US, Europe, Gulf, Singapore, Japan, Australia (they usually pay more), and projects with few proposals.`;

const MARKETS = `1) ARAB market (label "arab"): mostaql.com projects (تطوير تطبيق أندرويد، برمجة تطبيق جوال، ذكاء اصطناعي، تحويل موقع إلى تطبيق)، khamsat.com requests، Arabic projects on freelancer.com، public LinkedIn posts "مطلوب مطور تطبيقات". Clients in Saudi Arabia, UAE, Qatar, Kuwait, Jordan, Egypt.
2) USA & EUROPE remote (label "west"): Upwork jobs, freelancer.com projects, Reddit r/forhire "[Hiring]" posts, public LinkedIn posts "looking for an Android developer" / "need an app developer" / "build an AI agent".
3) FAR EAST & AUSTRALIA remote (label "east"): clients in Singapore, Japan, Hong Kong, South Korea, Malaysia, Australia on freelancer.com, Upwork, LinkedIn.
Topics for all: Android app, website to Android app, AI features in an app, AI agent / AI automation, Google Play publishing or rejection fix.`;

// ---------- Freelancer.com: مشاريع مفتوحة هلا من الـ API العام (بدون مفتاح) ----------
const FL_QUERIES = ['android app', 'android', 'mobile app', 'ai agent', 'ai chatbot', 'chatbot', 'ai automation', 'gemini', 'website to app', 'webview app', 'google play', 'play store', 'nfc', 'تطبيق'];
const ago = sec => {
  const h = Math.max(0, Math.round((Date.now() / 1000 - sec) / 3600));
  return h < 1 ? 'less than an hour ago' : h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
};
async function freelancerFeed() {
  const out = new Map();
  for (const q of FL_QUERIES) {
    try {
      const u = `https://www.freelancer.com/api/projects/0.1/projects/active/?query=${encodeURIComponent(q)}&limit=30&full_description=true&job_details=true&compact=true`;
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', Accept: 'application/json' } });
      if (!r.ok) { log('freelancer', `${q}: HTTP ${r.status}`); continue; }
      const d = await r.json();
      for (const p of d?.result?.projects || []) {
        if (!p?.seo_url || out.has(p.id)) continue;
        const age = Date.now() / 1000 - (p.time_submitted || 0);
        if (age > 5 * 86400) continue;                       // آخر 5 أيام بس
        const bids = p.bid_stats?.bid_count ?? 0;
        if (bids > 80) continue;                              // زحمة كثير
        const cur = p.currency?.code || 'USD';
        const b = p.budget || {};
        const budget = b.minimum ? `${b.minimum}${b.maximum ? '-' + b.maximum : '+'} ${cur}${p.type === 'hourly' ? '/hr' : ''}` : '';
        const text = String(p.description || p.preview_description || '').replace(/\s+/g, ' ').trim();
        out.set(p.id, {
          title: p.title || '',
          url: `https://www.freelancer.com/projects/${p.seo_url}`,
          market: '',
          platform: 'Freelancer',
          country: '',
          budget,
          posted: ago(p.time_submitted || 0),
          proposals: String(bids),
          language: /[؀-ۿ]/.test(p.title + text) ? 'ar' : 'en',
          summary: text.slice(0, 220),
          pageText: `${(p.jobs || []).map(j => j.name).join(', ')} | ${text}`.slice(0, 1800),
          _t: p.time_submitted || 0
        });
      }
    } catch (e) {
      log('freelancer', `${q}: ${e.message}`);
    }
  }
  const list = [...out.values()].sort((a, b) => b._t - a._t);
  log('freelancer', `${list.length} open projects from the last 5 days`);
  return list;
}

(async () => {
  const index = readJSON(path.join(DIR, 'jobs-index.json'), { dates: [], seen: [] });
  const seen = new Set(index.seen.map(clean));
  log('memory', `${seen.size} leads seen before`);

  // ---------- Step 1: Google search, جولتين: عربي وعالمي ----------
  let found = [];
  const urls = new Map(); // رابط حقيقي -> عنوان
  const ROUNDS = [
    { id: 'arab', text: MARKETS.split('\n')[0] },
    { id: 'global', text: MARKETS.split('\n').slice(1).join('\n') }
  ];
  for (const round of ROUNDS) {
    try {
      const r = await ask(`
TODAY is ${today}. Use Google Search to find REAL, CURRENTLY OPEN freelance PROJECTS posted in the last 14 days, where a client wants to hire a freelancer for a one-off project.
NOT full-time jobs, NOT company vacancies, NOT salaries per year, NOT courses or articles.

Search this market, several searches with different keywords:
${round.text}

Return up to 12 leads. Copy each page URL exactly from your search results. Do not invent URLs. Each URL must be ONE project or post, not a search or list page.
Keep every text field short (under 25 words) and do not use double quotes inside values.

Respond with ONLY JSON:
{
  "leads": [
    {
      "title": "project title as written",
      "url": "exact URL from search results",
      "market": "arab or west or east",
      "platform": "Mostaql / Upwork / Freelancer / LinkedIn / Reddit / other",
      "country": "client country if known, else empty",
      "budget": "budget as written, else empty",
      "posted": "when it was posted, as written",
      "proposals": "number of proposals/bids if shown, else empty",
      "language": "ar or en",
      "summary": "what the client wants, in English"
    }
  ]
}`, { search: true });
      const real = await Promise.all(r.sources.map(async s => ({ ...s, url: await realUrl(s.url) })));
      real.forEach(s => urls.set(clean(s.url), s));
      const got = (r.json.leads || []).map(l => ({ ...l, market: ['arab', 'west', 'east'].includes(l.market) ? l.market : (round.id === 'arab' ? 'arab' : '') }));
      found.push(...got);
      log('search', `${round.id}: ${got.length} leads, ${real.length} sources via ${r.model}`);
    } catch (e) {
      log('search', `${round.id} failed: ${e.message}`);
    }
  }

  // ---------- Step 2: Keep only real, new links ----------
  const known = [...urls.keys()];
  const hosts = new Set(known.map(host));
  const checked = [];
  const dupes = new Set();
  for (const l of found) {
    const u = clean(l.url);
    if (!u || dupes.has(u) || seen.has(u)) continue;
    if (!/^https?:\/\//.test(u) || !deep(u)) { log('verify', `dropped (no page link): ${l.title}`); continue; }
    const bad = badShape(l.url);
    if (bad) { log('verify', `dropped (${bad}): ${l.title}`); continue; }
    // 1) الرابط طالع بنتائج البحث نفسها
    let ok = urls.has(u) || known.some(k => deep(k) && (k.startsWith(u) || u.startsWith(k)));
    let why = 'in search';
    // 2) أو الصفحة بتفتح فعلاً
    // منقرأ الصفحة نفسها، عشان الحكم يشوف إذا هي فعلاً طلب شغل (مش كورس أو مقال)
    const pg = await page(l.url);
    const st = pg.st;
    l.pageText = pg.text;
    if (!ok) { ok = st >= 200 && st < 300; why = `opens (${st})`; }
    // 3) أو موقع بيسكّر على البوتات، بس شكل الرابط صفحة مشروع والبحث وصل لنفس الموقع
    if (!ok && st !== 404 && st !== 410 && PROJECT_PAGE.test(u) && hosts.has(host(u))) { ok = true; why = `project page on ${host(u)} (${st})`; }
    if (!ok) { log('verify', `dropped (${st || 'no response'}): ${l.title}`); continue; }
    log('verify', `kept [${why}]: ${l.title}`);
    dupes.add(u);
    checked.push(l);
  }
  log('verify', `${found.length} found, ${checked.length} real and new`);

  // مشاريع Freelancer جاية من المنصة نفسها، فهي حقيقية ومفتوحة
  const fl = (await freelancerFeed()).filter(l => {
    const u = clean(l.url);
    if (seen.has(u) || dupes.has(u)) return false;
    dupes.add(u);
    return true;
  }).slice(0, 22);
  fl.forEach(l => { delete l._t; checked.push(l); });
  log('verify', `${fl.length} new Freelancer projects added, ${checked.length} to judge`);

  // ---------- Step 3: Judge + write proposals ----------
  let leads = [], rejected = [], summary = { ar: '', en: '' }, judgeModel = '';
  if (checked.length) {
    const s3 = await ask(`
${ABOUT}

You are Moe's strict job agent. Below are freelance leads found today. Judge each one for Moe.
${RULES}

Leads:
${JSON.stringify(checked.map((l, i) => ({ id: i, ...l, pageText: l.pageText || '(page blocked, judge from title and summary only)' })))}

IMPORTANT: "pageText" is the real text of the page. Use it as the truth. If it shows the page is NOT a client hiring a freelancer for a project (for example a course, a training session, a tutorial, an article, a product or SaaS page, a job board or list of vacancies, a company careers page, or a freelancer's own service), REJECT it, whatever its title says. If the page shows the project is closed or expired, REJECT it. Prefer budget, posted date and proposals count from pageText when present.

For every KEPT lead (max 10, best first), write a ready-to-send proposal:
- In Arabic (Modern Standard, simple and warm) if the lead language is "ar", otherwise in English.
- 80-130 words. Start with the client's actual need, not with "Hi I am". Mention ONE relevant live app of Moe's as proof.
- Be honest: say he builds with AI-assisted development. Never promise approval by Google.
- Only mention skills from the "CAN deliver" list. Never write that he is skilled, adept, experienced or an expert in anything outside it. Never stretch an app as proof of a skill it does not show.
- If you cannot write an honest proposal without claiming a skill he does not have, REJECT the lead instead.
- Include the portfolio link once, on its own line, introduced naturally (e.g. "You can try my live apps here:" or "تقدر تجرب تطبيقاتي المنشورة من هون:").
- End with one specific question about their project.

Respond with ONLY JSON:
{
  "summary_ar": "ملخص اليوم بجملة أو جملتين",
  "summary_en": "Today's summary in 1-2 sentences",
  "kept": [
    { "id": 0, "fit": 8, "why_ar": "ليش بتناسب Moe", "why_en": "why it fits Moe", "watch_ar": "شو ينتبه له", "watch_en": "what to watch out for", "proposal": "..." }
  ],
  "rejected": [ { "id": 1, "reason_ar": "سبب الرفض", "reason_en": "reason" } ]
}
"fit" is 1-10. Use Western digits only.`);
    judgeModel = s3.model;
    const num = v => Number(String(v ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))) || 0;
    leads = (s3.json.kept || [])
      .filter(k => checked[k.id])
      .map(k => {
        const l = checked[k.id];
        return {
          title: l.title, url: l.url, platform: l.platform || '', market: l.market,
          country: l.country || '', budget: l.budget || '', posted: l.posted || '',
          proposals: l.proposals || '', language: l.language === 'ar' ? 'ar' : 'en',
          summary: l.summary || '',
          fit: Math.max(0, Math.min(10, num(k.fit))),
          why: { ar: k.why_ar || '', en: k.why_en || '' },
          watch: { ar: k.watch_ar || '', en: k.watch_en || '' },
          proposal: k.proposal || ''
        };
      })
      .sort((a, b) => b.fit - a.fit);
    // بس الفرص القوية (7 وفوق) بتطلع لـ Moe، الباقي بيروح للمرفوضة مع السبب
    const weak = leads.filter(l => l.fit < 7);
    leads = leads.filter(l => l.fit >= 7).slice(0, 10);
    rejected = (s3.json.rejected || []).filter(r => checked[r.id]).map(r => ({
      title: checked[r.id].title, url: checked[r.id].url,
      reason: { ar: r.reason_ar || '', en: r.reason_en || '' }
    }));
    rejected.push(...weak.map(l => ({
      title: l.title, url: l.url,
      reason: { ar: `تقييمها ${l.fit} من 10، أقل من الحد (7). ${l.watch.ar}`.trim(), en: `Fit ${l.fit}/10, below the 7 threshold. ${l.watch.en}`.trim() }
    })));
    summary = { ar: s3.json.summary_ar || '', en: s3.json.summary_en || '' };
    log('judge', `kept ${leads.length}, rejected ${rejected.length} via ${judgeModel}`);
  }

  // منحفظ كل اللي شفناه (المقبول والمرفوض) عشان ما يرجع يطلع
  index.dates = [today, ...index.dates.filter(d => d !== today)].slice(0, 120);
  index.seen = [...checked.map(l => clean(l.url)), ...index.seen].filter((v, i, a) => a.indexOf(v) === i).slice(0, 1500);
  fs.writeFileSync(path.join(DIR, 'jobs-index.json'), JSON.stringify(index, null, 2));

  // الجولة التانية بنفس اليوم: إذا ما في إشي جديد، منخلي تقرير الصبح زي ما هو (وما في إشعار)
  const prev = readJSON(path.join(DIR, `jobs-${today}.json`), null);
  if (!leads.length && prev) {
    console.log('No new leads this run; keeping the earlier report.');
    return;
  }

  if (!leads.length && !summary.en) {
    summary = {
      ar: 'ما لقيت فرص جديدة بتناسبك هالجولة. رح أدوّر مرة تانية.',
      en: 'No new leads that fit you this run. I will search again.'
    };
  }

  // الجديد فوق، وفرص الجولة اللي قبل تحته
  const fresh = leads.map(l => ({ ...l, fresh: true }));
  const older = (prev?.leads || []).map(l => ({ ...l, fresh: false }));
  const urlsNew = new Set(fresh.map(l => clean(l.url)));
  const allLeads = [...fresh, ...older.filter(l => !urlsNew.has(clean(l.url)))].slice(0, 14);
  const allRejected = [...rejected, ...(prev?.rejected || [])].slice(0, 15);

  // ---------- Save ----------
  const report = {
    date: today,
    generatedAt: new Date().toISOString(),
    model: judgeModel,
    summary,
    fresh: fresh.length,
    leads: allLeads,
    rejected: allRejected,
    agent: { version: 2, found: found.length, verified: checked.length, steps: trace }
  };
  fs.writeFileSync(path.join(DIR, `jobs-${today}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(DIR, 'jobs-latest.json'), JSON.stringify(report, null, 2));

  console.log(`OK ${today}: ${leads.map(l => `${l.title.slice(0, 40)}(${l.fit})`).join(' | ') || 'no leads'}`);
})().catch(e => { console.error(e.message); process.exit(1); });
