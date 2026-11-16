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
- For LinkedIn leads (platform LinkedIn): the "title" field may actually be the company or the location. Read pageText and work out the real job title, company and location; if you cannot find a real job title, REJECT it. Return the real job title in "title" for kept LinkedIn leads. Keep them only if the title clearly fits Moe (Android / mobile app / AI agent / chatbot / automation) and is NOT senior/staff/lead/principal level; give fit 7 at most and say in watch_ar/watch_en to open the post and check it is contract/freelance.
- The project text is not in English (for example Indonesian, Spanish, Hindi, Portuguese): Moe targets English-speaking clients in the USA, Europe, Far East and Australia.
- It is outside what Moe can deliver (see profile). This includes: SQL/MySQL/PHP/WordPress work, database migration or data extraction, web scraping, data entry, DevOps/servers, and anything that collects or exports people's personal data (phone numbers, emails, contacts).
- The client needs a specialist in a technology Moe does not use (e.g. Laravel, .NET, Unity, Swift, Flutter, React Native).
PREFER: Android-only apps, website-to-app, AI features in an app, AI agents/automation/research bots, Google Play publishing or rejection fixes, NFC/Bluetooth apps, Arabic/RTL apps.
IMPORTANT: an Android app, website-to-app, or AI chatbot/agent project with a budget of about 250 USD or more and fewer than 40 bids is usually a GOOD fit for Moe (fit 7-9), even with some competition. Do not reject a project only because there is competition or because Moe is new on the platform. Reject only for the reasons listed above.\nMoe is targeting clients in the USA, Europe, Far East and Australia (they pay more). Prefer those, prefer projects with few proposals, and prefer budgets of 100 USD or more.`;

const MARKETS = `1) ARAB market (label "arab"): mostaql.com projects (تطوير تطبيق أندرويد، برمجة تطبيق جوال، ذكاء اصطناعي، تحويل موقع إلى تطبيق)، khamsat.com requests، Arabic projects on freelancer.com، public LinkedIn posts "مطلوب مطور تطبيقات". Clients in Saudi Arabia, UAE, Qatar, Kuwait, Jordan, Egypt.
2) USA & EUROPE remote (label "west"): Upwork jobs, freelancer.com projects, Reddit r/forhire "[Hiring]" posts, public LinkedIn posts "looking for an Android developer" / "need an app developer" / "build an AI agent".
3) FAR EAST & AUSTRALIA remote (label "east"): clients in Singapore, Japan, Hong Kong, South Korea, Malaysia, Australia on freelancer.com, Upwork, LinkedIn.
Topics for all: Android app, website to Android app, AI features in an app, AI agent / AI automation, Google Play publishing or rejection fix.`;

// ---------- Freelancer.com: مشاريع مفتوحة هلا من الـ API العام (بدون مفتاح) ----------
const FL_QUERIES = ['android app', 'android', 'mobile app', 'ai agent', 'ai chatbot', 'chatbot', 'ai automation', 'gemini', 'website to app', 'webview app', 'google play', 'play store', 'nfc', 'kotlin', 'firebase'];
const ago = sec => {
  const h = Math.max(0, Math.round((Date.now() / 1000 - sec) / 3600));
  return h < 1 ? 'less than an hour ago' : h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
};
const WEST = ['United States', 'Canada', 'United Kingdom', 'Ireland', 'Germany', 'France', 'Netherlands', 'Belgium', 'Luxembourg', 'Switzerland', 'Austria', 'Italy', 'Spain', 'Portugal', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland', 'Poland', 'Czech Republic', 'Czechia', 'Estonia', 'Lithuania', 'Latvia', 'Slovenia', 'Malta', 'Cyprus', 'Greece'];
const EAST = ['Singapore', 'Japan', 'Hong Kong', 'South Korea', 'Korea, Republic of', 'Taiwan', 'Malaysia', 'Australia', 'New Zealand'];
const regionOf = c => WEST.includes(c) ? 'west' : EAST.includes(c) ? 'east' : '';
// عملة المشروع بتدل على بلد الزبون: هاي العملات بس منقبلها
const CUR_REGION = { USD: '', EUR: 'west', GBP: 'west', CHF: 'west', SEK: 'west', NOK: 'west', DKK: 'west', PLN: 'west', CAD: 'west', AUD: 'east', NZD: 'east', SGD: 'east', HKD: 'east', JPY: 'east' };
let skippedRegion = 0;
let skippedSkill = 0;
const RELEVANT = /android|mobile app|app develop|kotlin|java\b|firebase|play store|google play|apk|webview|website to app|web to app|\bai\b|artificial intelligence|machine learning|chat ?bot|gpt|openai|gemini|llm|ai agent|automation|nfc|bluetooth/i;
const OFF_TOPIC = /\b(logo|seo|content writ|copywrit|video edit|editor needed|marketing plan|social media|wordpress|shopify|data entry|translation|voice ?over|thumbnail|illustrat|branding|name creation)\b/i;

async function freelancerFeed() {
  const out = new Map();
  for (const q of FL_QUERIES) {
    try {
      const u = `https://www.freelancer.com/api/projects/0.1/projects/active/?query=${encodeURIComponent(q)}&limit=40&full_description=true&job_details=true&user_details=true&user_country_details=true`;
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', Accept: 'application/json' } });
      if (!r.ok) { log('freelancer', `${q}: HTTP ${r.status}`); continue; }
      const d = await r.json();
      const users = d?.result?.users || {};
      for (const p of d?.result?.projects || []) {
        if (!p?.seo_url || out.has(p.id)) continue;
        // بلد صاحب المشروع: بنخلّي بس أمريكا وأوروبا والشرق الأقصى وأستراليا
        const owner = users[p.owner_id] || users[String(p.owner_id)] || {};
        const country = owner?.location?.country?.name || '';
        const region = regionOf(country);
        if (country && !region) { skippedRegion++; continue; }
        const curCode = p.currency?.code || 'USD';
        if (!(curCode in CUR_REGION)) { skippedRegion++; continue; }   // INR, IDR, PKR, ...
        const guessedRegion = region || CUR_REGION[curCode];
        const age = Date.now() / 1000 - (p.time_submitted || 0);
        if (age > 5 * 86400) continue;                       // آخر 5 أيام بس
        const bids = p.bid_stats?.bid_count ?? 0;
        if (bids > 80) continue;                              // زحمة كثير
        const cur = p.currency?.code || 'USD';
        const b = p.budget || {};
        const budget = b.minimum ? `${b.minimum}${b.maximum ? '-' + b.maximum : '+'} ${cur}${p.type === 'hourly' ? '/hr' : ''}` : '';
        const text = String(p.description || p.preview_description || '').replace(/\s+/g, ' ').trim();
        // فلتر المهارات: بس مشاريع تطبيقات وAI، مش كتابة وتسويق ومونتاج
        const skills = (p.jobs || []).map(j => j.name).join(', ');
        if (!RELEVANT.test(`${p.title} ${skills}`) || OFF_TOPIC.test(p.title || '')) { skippedSkill++; continue; }
        out.set(p.id, {
          title: p.title || '',
          url: `https://www.freelancer.com/projects/${p.seo_url}`,
          market: guessedRegion,
          platform: 'Freelancer',
          country,
          budget,
          posted: ago(p.time_submitted || 0),
          proposals: String(bids),
          language: /[؀-ۿ]/.test(p.title + text) ? 'ar' : 'en',
          summary: text.slice(0, 220),
          pageText: `${(p.jobs || []).map(j => j.name).join(', ')} | ${text}`.slice(0, 1000),
          _bids: bids,
          _t: p.time_submitted || 0
        });
      }
    } catch (e) {
      log('freelancer', `${q}: ${e.message}`);
    }
  }
  const list = [...out.values()].sort((a, b) => (a._bids - b._bids) || (b._t - a._t));
  log('freelancer', `${list.length} open projects from the last 5 days in US/Europe/Far East (${skippedRegion} skipped: other countries or currencies, ${skippedSkill} skipped: not app/AI work)`);
  return list;
}

// ---------- Reddit r/forhire: بيوصل من موبايل Moe عن طريق Firebase ----------
// Reddit بيسكّر على سيرفرات GitHub، فتطبيق Me.ai على الموبايل بيقرأ الـ RSS وبيرفع بوستات [Hiring] لـ /reddit
const FIREBASE = (process.env.FIREBASE_DB || 'https://meai-agent-ee448-default-rtdb.europe-west1.firebasedatabase.app').replace(/\/$/, '');
async function redditFeed() {
  const list = [];
  try {
    const r = await fetch(`${FIREBASE}/reddit.json`);
    if (!r.ok) { log('reddit', `firebase HTTP ${r.status}`); return list; }
    const d = (await r.json()) || {};
    const now = Date.now() / 1000;
    for (const [id, p] of Object.entries(d)) {
      if (!p?.url || !p?.title) continue;
      const age = now - (Number(p.created) || now);
      if (age > 7 * 86400) {
        // قديم: منشيله من Firebase عشان ما تكبر
        fetch(`${FIREBASE}/reddit/${encodeURIComponent(id)}.json`, { method: 'DELETE' }).catch(() => {});
        continue;
      }
      if (age > 5 * 86400) continue;
      const text = String(p.text || '');
      list.push({
        title: String(p.title).replace(/^\s*\[hiring\]\s*/i, ''),
        url: p.url,
        market: 'west', platform: 'Reddit', country: '', budget: '',
        posted: ago(Number(p.created) || now), proposals: '',
        language: 'en', summary: text.slice(0, 220), pageText: text.slice(0, 1800),
        _t: Number(p.created) || 0
      });
    }
    list.sort((a, b) => b._t - a._t);
    list.forEach(l => delete l._t);
    log('reddit', `${list.length} [Hiring] posts from the phone relay (last 5 days)`);
  } catch (e) {
    log('reddit', e.message);
  }
  return list;
}

// ---------- LinkedIn Job Alerts: بتوصل من Gmail تبع Moe عن طريق Firebase ----------
// سكريبت Google Apps Script جوا Gmail بيقرأ إيميلات التنبيهات وبيرفع الوظائف لـ /linkedin
const regionFromPlace = p => {
  const t = String(p || '');
  if (/united states|\b(usa|us)\b|, [A-Z]{2}\b|canada/i.test(t)) return 'west';
  if (/united kingdom|\buk\b|england|london|european|germany|france|netherlands|ireland|spain|italy|portugal|sweden|norway|denmark|finland|poland|switzerland|austria|belgium|europe/i.test(t)) return 'west';
  if (/singapore|australia|japan|hong kong|korea|taiwan|malaysia|new zealand/i.test(t)) return 'east';
  return '';
};
async function linkedinFeed() {
  const list = [];
  try {
    const r = await fetch(`${FIREBASE}/linkedin.json`);
    if (!r.ok) { log('linkedin', `firebase HTTP ${r.status}`); return list; }
    const d = (await r.json()) || {};
    const now = Date.now() / 1000;
    for (const [id, p] of Object.entries(d)) {
      if (!p?.url || !p?.title) continue;
      const age = now - (Number(p.created) || now);
      if (age > 7 * 86400) {
        fetch(`${FIREBASE}/linkedin/${encodeURIComponent(id)}.json`, { method: 'DELETE' }).catch(() => {});
        continue;
      }
      if (age > 5 * 86400) continue;
      const info = p.raw ? String(p.raw) : [p.title, p.company, p.location].filter(Boolean).join(' | ');
      list.push({
        title: String(p.title), url: p.url,
        market: regionFromPlace(p.location), platform: 'LinkedIn',
        country: String(p.location || ''), budget: '',
        posted: ago(Number(p.created) || now), proposals: '',
        language: 'en',
        summary: [p.company, p.location].filter(Boolean).join(' · '),
        pageText: `LinkedIn job alert. The full post is behind LinkedIn login; this is the text from the alert email, in no fixed order (job title, company, location): ${info}`,
        _t: Number(p.created) || 0
      });
    }
    list.sort((a, b) => b._t - a._t);
    list.forEach(l => delete l._t);
    log('linkedin', `${list.length} jobs from Gmail alerts (last 5 days)`);
  } catch (e) {
    log('linkedin', e.message);
  }
  return list;
}

// أي جملة بالعرض فيها مبالغة عن مهاراته بتنشال، حتى لو الموديل تجاهل التعليمات
const BRAG = /\b(adept|expert|expertise|specializ\w*|specialis\w*|specialist|focus(?:ed|es)? on|skilled|seasoned|proficient|extensive experience|years of experience)\b/i;
function honest(p) {
  const lines = String(p).split(/\n/).map(line =>
    line.split(/(?<=[.!?])\s+/).filter(s => !BRAG.test(s)).join(' ')
  );
  // إذا انشالت الجملة اللي بتحكي إنه بيشتغل بمساعدة AI، منرجّعها
  if (/AI-assisted/i.test(p) && !lines.some(l => /AI-assisted/i.test(l))) {
    lines[0] = (lines[0] + ' I build with AI-assisted development: I design, plan and test, and AI tools help write the code.').trim();
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// صفحة LinkedIn العامة (بدون تسجيل دخول) لإعلان وظيفة
const strip = h => String(h || '').replace(/<(br|\/p|\/li|\/div|\/h\d)[^>]*>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
async function linkedinPost(url) {
  const id = (String(url).match(/jobs\/view\/(\d+)/) || [])[1];
  if (!id) return null;
  try {
    const r = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) { log('linkedin', `post ${id}: HTTP ${r.status}`); return null; }
    const h = await r.text();
    const desc = (h.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/) || [])[1];
    if (!desc) return null;
    const crit = {};
    for (const m of h.matchAll(/description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>[\s\S]*?description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/g)) {
      crit[strip(m[1]).toLowerCase()] = strip(m[2]);
    }
    return {
      title: strip((h.match(/top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/) || [])[1]),
      company: strip((h.match(/topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/) || [])[1]),
      type: crit['employment type'] || '',
      level: crit['seniority level'] || '',
      closed: /no longer accepting applications|closed-job/i.test(h),
      text: strip(desc).slice(0, 3500)
    };
  } catch (e) {
    log('linkedin', `post ${id}: ${e.message}`);
    return null;
  }
}
// أسباب واضحة نشيل فيها الإعلان بدون ما نصرف على الحكم
function linkedinBlock(p) {
  if (p.closed) return 'closed';
  if (/full-time/i.test(p.type)) return 'full-time';
  if (/director|executive/i.test(p.level)) return p.level;
  const yrs = [...p.text.matchAll(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?/gi)].map(m => Number(m[1])).filter(n => n >= 3 && n <= 20);
  if (yrs.length) return `${Math.max(...yrs)}+ years required`;
  if (/\bsenior\b|\bstaff engineer\b|\blead\b/i.test(p.title)) return 'senior title';
  return '';
}

(async () => {
  const index = readJSON(path.join(DIR, 'jobs-index.json'), { dates: [], seen: [] });
  const seen = new Set(index.seen.map(clean));
  log('memory', `${seen.size} leads seen before`);

  // ---------- Step 1: Google search, جولتين: عربي وعالمي ----------
  let found = [];
  const urls = new Map(); // رابط حقيقي -> عنوان
  // بحث Google انشال: ما كان يجيب روابط حقيقية، وكان يصرف من الـ quota

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
  }).slice(0, 40);
  fl.forEach(l => { delete l._t; delete l._bids; checked.push(l); });
  const rd = (await redditFeed()).filter(l => {
    const u = clean(l.url);
    if (seen.has(u) || dupes.has(u)) return false;
    dupes.add(u);
    return true;
  }).slice(0, 12);
  rd.forEach(l => checked.push(l));
  const li = (await linkedinFeed()).filter(l => {
    const u = clean(l.url);
    if (seen.has(u) || dupes.has(u)) return false;
    dupes.add(u);
    return true;
  }).slice(0, 40);
  // منقرأ الإعلان الكامل من صفحة LinkedIn العامة، ومنشيل الدوام الكامل والخبرة الطويلة قبل الحكم
  let liKept = 0;
  const skipped = [];
  for (const l of li) {
    const full = await linkedinPost(l.url);
    if (full) {
      const why = linkedinBlock(full);
      if (why) { log('linkedin', `skipped (${why}): ${full.title || l.title}`); skipped.push(clean(l.url)); continue; }
      if (full.title) l.title = full.title;
      if (full.company) l.summary = [full.company, l.country].filter(Boolean).join(' · ');
      l.pageText = `LinkedIn job post. Employment type: ${full.type || 'unknown'}. Seniority: ${full.level || 'unknown'}.\n${full.text}`;
    }
    checked.push(l);
    liKept++;
    await new Promise(r => setTimeout(r, 400));
  }
  log('verify', `${liKept} of ${li.length} new LinkedIn jobs added`);
  log('verify', `${rd.length} new Reddit posts added`);
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
- Never write "I specialize in", "I focus on", "specialist", "expert", "expertise" or "my experience in". Describe what he has built, not what he is. His 4 live apps are hybrid (WebView + Firebase); native Kotlin is new for him (Flicker, still in testing). If Kotlin matters to the client, say plainly: "my newest app, Flicker, is native Kotlin and is in testing on Google Play". Never present native Kotlin as his main experience.
- Only mention skills from the "CAN deliver" list. Never write that he is skilled, adept, experienced or an expert in anything outside it. Never stretch an app as proof of a skill it does not show.
- If you cannot write an honest proposal without claiming a skill he does not have, REJECT the lead instead.
- Include the portfolio link once, on its own line, introduced naturally (e.g. "You can try my live apps here:" or "تقدر تجرب تطبيقاتي المنشورة من هون:").
- End with one specific question about their project.

Respond with ONLY JSON:
{
  "summary_ar": "ملخص اليوم بجملة أو جملتين",
  "summary_en": "Today's summary in 1-2 sentences",
  "kept": [
    { "id": 0, "title": "real job title (LinkedIn only, else omit)", "fit": 8, "why_ar": "ليش بتناسب Moe", "why_en": "why it fits Moe", "watch_ar": "شو ينتبه له", "watch_en": "what to watch out for", "proposal": "..." }
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
          title: (l.platform === 'LinkedIn' && k.title && !/real job title/i.test(k.title)) ? String(k.title).slice(0, 200) : l.title, url: l.url, platform: l.platform || '', market: l.market,
          country: l.country || '', budget: l.budget || '', posted: l.posted || '',
          proposals: l.proposals || '', language: l.language === 'ar' ? 'ar' : 'en',
          summary: l.summary || '',
          fit: Math.max(0, Math.min(10, num(k.fit))),
          why: { ar: k.why_ar || '', en: k.why_en || '' },
          watch: { ar: k.watch_ar || '', en: k.watch_en || '' },
          proposal: honest(k.proposal || '')
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
    rejected.slice(0, 10).forEach(r => console.log(`  - rejected: ${r.title.slice(0, 60)} => ${(r.reason.en || '').slice(0, 140)}`));
  }

  // منحفظ كل اللي شفناه (المقبول والمرفوض) عشان ما يرجع يطلع
  index.dates = [today, ...index.dates.filter(d => d !== today)].slice(0, 120);
  index.seen = [...checked.map(l => clean(l.url)), ...skipped, ...index.seen].filter((v, i, a) => a.indexOf(v) === i).slice(0, 1500);
  fs.writeFileSync(path.join(DIR, 'jobs-index.json'), JSON.stringify(index, null, 2));

  // الجولة التانية بنفس اليوم: إذا ما في إشي جديد، منخلي تقرير الصبح زي ما هو (وما في إشعار)
  const prev = readJSON(path.join(DIR, `jobs-${today}.json`), null);
  // ما في فرص جديدة؟ منكمّل ومنحفظ أسباب الرفض، بس fresh = 0 فما في إشعار
  if (!leads.length && prev) console.log('No new leads this run; keeping earlier leads and saving rejection reasons.');

  if (!leads.length && !summary.en) {
    summary = {
      ar: 'ما لقيت فرص جديدة بتناسبك هالجولة. رح أدوّر مرة تانية.',
      en: 'No new leads that fit you this run. I will search again.'
    };
  }

  // الجديد فوق، وفرص الجولة اللي قبل تحته
  const fresh = leads.map(l => ({ ...l, fresh: true }));
  const older = (prev?.leads || []).map(l => ({ ...l, proposal: honest(l.proposal || ""), fresh: false }));
  const urlsNew = new Set(fresh.map(l => clean(l.url)));
  const allLeads = [...fresh, ...older.filter(l => !urlsNew.has(clean(l.url)))].slice(0, 14);
  const allRejected = [...rejected, ...(prev?.rejected || [])].slice(0, 30);

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

  // إشعار على الموبايل من السيرفر نفسه (تطبيق ntfy)، ما بيعتمد على إنه الموبايل صاحي
  const topic = (process.env.NTFY_TOPIC || '').trim();
  if (topic && fresh.length) {
    const top = fresh[0];
    try {
      const r = await fetch('https://ntfy.sh/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          title: `💼 ${fresh.length} فرص شغل جديدة`,
          message: fresh.slice(0, 3).map(l => `• ${l.title} (${l.fit}/10) · ${l.platform}${l.budget ? ' · ' + l.budget : ''}`).join('\n'),
          click: top.url,
          priority: 4
        }),
        signal: AbortSignal.timeout(15000)
      });
      log('notify', `ntfy ${r.status}`);
    } catch (e) {
      log('notify', e.message);
    }
  }

  console.log(`OK ${today}: ${leads.map(l => `${l.title.slice(0, 40)}(${l.fit})`).join(' | ') || 'no leads'}`);
})().catch(e => { console.error(e.message); process.exit(1); });
