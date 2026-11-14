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
  const e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(s, e + 1));
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

// بيفتح الرابط فعلياً ليتأكد إنه الصفحة موجودة
async function alive(u) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(u, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' } });
    clearTimeout(t);
    return r.status >= 200 && r.status < 300;
  } catch {
    return false;
  }
}

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
- It is not a real request from a client (articles, ads, lists of tips, freelancers advertising themselves, courses).
- It is outside what Moe can deliver (see profile).
PREFER: Android-only apps, website-to-app, AI features in an app, AI agents/automation/research bots, Google Play publishing or rejection fixes, NFC/Bluetooth apps, Arabic/RTL apps.
PREFER clients from the US, Europe, Gulf, Singapore, Japan, Australia (they usually pay more), and projects with few proposals.`;

const MARKETS = [
  {
    id: 'arab',
    label: 'Arab market',
    query: `Arabic freelance platforms and posts: mostaql.com projects (مستقل: تطوير تطبيق أندرويد، برمجة تطبيق جوال، ذكاء اصطناعي، تحويل موقع إلى تطبيق), khamsat.com requests, Arabic projects on freelancer.com, and public LinkedIn posts like "مطلوب مطور تطبيقات" or "نبحث عن مبرمج تطبيق". Clients in Saudi Arabia, UAE, Qatar, Kuwait, Jordan, Egypt.`
  },
  {
    id: 'west',
    label: 'Remote: USA & Europe',
    query: `Remote freelance or contract work from clients in the USA, UK, and Europe: Upwork jobs, freelancer.com projects, Reddit r/forhire and r/slavelabour "[Hiring]" posts, public LinkedIn posts "looking for an Android developer" / "need an app developer" / "looking for someone to build an AI agent", Contra, Wellfound freelance gigs. Topics: Android app, convert website to app, AI agent, AI automation, Google Play publishing, Play Store rejection.`
  },
  {
    id: 'east',
    label: 'Remote: Far East & Australia',
    query: `Remote freelance or contract work from clients in Singapore, Japan, Hong Kong, South Korea, Malaysia, and Australia: freelancer.com and Upwork projects, public LinkedIn posts, local freelance boards. Topics: Android app development, website to Android app, AI agent / AI automation, Google Play publishing.`
  }
];

(async () => {
  const index = readJSON(path.join(DIR, 'jobs-index.json'), { dates: [], seen: [] });
  const seen = new Set(index.seen.map(clean));
  log('memory', `${seen.size} leads seen before`);

  // ---------- Step 1: Search each market ----------
  const found = [];
  const urls = new Map(); // رابط حقيقي -> عنوان
  for (const m of MARKETS) {
    try {
      const r = await ask(`
TODAY is ${today}. Use Google Search to find REAL, CURRENTLY OPEN freelance requests posted in the last 14 days.
Market: ${m.query}

Search several times with different keywords. Only include requests where a client is looking to HIRE someone for a project.
For each, copy the exact page URL from your search results. Do not invent URLs.

Respond with ONLY JSON:
{
  "leads": [
    {
      "title": "project title as written",
      "url": "exact URL from search results",
      "platform": "Mostaql / Upwork / Freelancer / LinkedIn / Reddit / other",
      "country": "client country if known, else empty",
      "budget": "budget as written, else empty",
      "posted": "when it was posted, as written",
      "proposals": "number of proposals/bids if shown, else empty",
      "language": "ar or en",
      "summary": "what the client wants, 1-2 sentences, in English"
    }
  ]
}`, { search: true });
      const real = await Promise.all(r.sources.map(async s => ({ ...s, url: await realUrl(s.url) })));
      real.forEach(s => urls.set(clean(s.url), s));
      const leads = (r.json.leads || []).map(l => ({ ...l, market: m.id }));
      found.push(...leads);
      log('search', `${m.label}: ${leads.length} leads, ${real.length} sources via ${r.model}`);
    } catch (e) {
      log('search', `${m.label} failed: ${e.message}`);
    }
  }

  // ---------- Step 2: Keep only real, new links ----------
  const known = [...urls.keys()];
  const checked = [];
  const dupes = new Set();
  for (const l of found) {
    const u = clean(l.url);
    if (!u || dupes.has(u)) continue;
    // الرابط لازم يكون طالع بنتائج البحث نفسها، أو على الأقل نفس الصفحة
    if (seen.has(u)) continue;
    if (!/^https?:\/\//.test(u) || !deep(u)) { log('verify', `dropped (no page link): ${l.title}`); continue; }
    // الرابط لازم يكون طالع بنتائج البحث نفسها، أو الصفحة تفتح فعلاً
    const inSearch = urls.has(u) || known.some(k => deep(k) && (k.startsWith(u) || u.startsWith(k)));
    if (!inSearch && !(await alive(l.url))) { log('verify', `dropped (link not verified): ${l.title}`); continue; }
    dupes.add(u);
    checked.push(l);
  }
  log('verify', `${found.length} found, ${checked.length} real and new`);

  // ---------- Step 3: Judge + write proposals ----------
  let leads = [], rejected = [], summary = { ar: '', en: '' }, judgeModel = '';
  if (checked.length) {
    const s3 = await ask(`
${ABOUT}

You are Moe's strict job agent. Below are freelance leads found today. Judge each one for Moe.
${RULES}

Leads:
${JSON.stringify(checked.map((l, i) => ({ id: i, ...l })))}

For every KEPT lead (max 8, best first), write a ready-to-send proposal:
- In Arabic (Modern Standard, simple and warm) if the lead language is "ar", otherwise in English.
- 80-130 words. Start with the client's actual need, not with "Hi I am". Mention ONE relevant live app of Moe's as proof.
- Be honest: say he builds with AI-assisted development. Never claim skills he does not have. Never promise approval by Google.
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
      .sort((a, b) => b.fit - a.fit)
      .slice(0, 8);
    rejected = (s3.json.rejected || []).filter(r => checked[r.id]).map(r => ({
      title: checked[r.id].title, url: checked[r.id].url,
      reason: { ar: r.reason_ar || '', en: r.reason_en || '' }
    }));
    summary = { ar: s3.json.summary_ar || '', en: s3.json.summary_en || '' };
    log('judge', `kept ${leads.length}, rejected ${rejected.length} via ${judgeModel}`);
  }

  // إذا انشغّل مرتين بنفس اليوم وما لقى إشي جديد: منخلي فرص الصبح زي ما هي
  const prev = readJSON(path.join(DIR, `jobs-${today}.json`), null);
  if (!leads.length && prev?.leads?.length) {
    console.log('No new leads; keeping this morning\'s report.');
    return;
  }

  if (!leads.length && !summary.en) {
    summary = {
      ar: 'ما لقيت فرص جديدة بتناسبك اليوم. رح أدوّر مرة تانية بكرة.',
      en: 'No new leads that fit you today. I will search again tomorrow.'
    };
  }

  // ---------- Save ----------
  const report = {
    date: today,
    generatedAt: new Date().toISOString(),
    model: judgeModel,
    summary,
    leads,
    rejected,
    agent: { version: 1, found: found.length, verified: checked.length, steps: trace }
  };
  fs.writeFileSync(path.join(DIR, `jobs-${today}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(DIR, 'jobs-latest.json'), JSON.stringify(report, null, 2));

  index.dates = [today, ...index.dates.filter(d => d !== today)].slice(0, 120);
  // منحفظ كل اللي شفناه (المقبول والمرفوض) عشان ما يرجع يطلع
  index.seen = [...checked.map(l => clean(l.url)), ...index.seen].filter((v, i, a) => a.indexOf(v) === i).slice(0, 1500);
  fs.writeFileSync(path.join(DIR, 'jobs-index.json'), JSON.stringify(index, null, 2));

  console.log(`OK ${today}: ${leads.map(l => `${l.title.slice(0, 40)}(${l.fit})`).join(' | ') || 'no leads'}`);
})().catch(e => { console.error(e.message); process.exit(1); });
