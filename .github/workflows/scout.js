// Me.ai Idea Scout v2 — Multi-step Agent
// الخطوة 1: يبحث ويقترح 8 أفكار
// الخطوة 2: يفحص المنافسين لكل فكرة على Google Play
// الخطوة 3: يحكم بصرامة، يرفض الضعيف، ويختار أقوى 5
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

// تقييمات Moe (👍/👎) — بتنضاف بالمرحلة الجاية من التطبيق
async function loadFeedback() {
  const url = process.env.FEEDBACK_URL;
  if (!url) return { liked: [], disliked: [] };
  try {
    const d = (await (await fetch(url)).json()) || {};
    const liked = [], disliked = [];
    for (const v of Object.values(d)) {
      const vote = typeof v === 'string' ? v : v?.vote;
      const name = typeof v === 'object' ? (v.name || '') + (v.pitch ? ` (${v.pitch})` : '') : '';
      if (!name) continue;
      (vote === 'up' ? liked : disliked).push(name);
    }
    return { liked: liked.slice(-30), disliked: disliked.slice(-30) };
  } catch {
    return { liked: [], disliked: [] };
  }
}


// بيترجم أي نص عربي بالـ JSON للإنجليزي، وبيحافظ على نفس الشكل
async function translate(obj) {
  const r = await ask(`Translate every Arabic text value in this JSON into natural, clear English.
Keep exactly the same keys and structure. Keep app names, product names, numbers and URLs unchanged.
Do not use markdown (no ** or bullet symbols inside values).
Return ONLY the JSON.

${JSON.stringify(obj)}`);
  return r.json;
}

const ABOUT = `Moe is an independent Android developer in Amman, Jordan. He builds Android apps (native Kotlin, or hybrid with Firebase) and publishes on Google Play. He works from a phone only and ships with AI help, so ideas must be buildable by one person in 1-3 weeks.`;

(async () => {
  const index = readJSON(path.join(DIR, 'index.json'), { dates: [], pastIdeas: [] });
  const fb = await loadFeedback();
  log('memory', `${index.pastIdeas.length} past ideas, ${fb.liked.length} liked, ${fb.disliked.length} disliked`);

  const prefs = `
Previous ideas (do NOT repeat or closely resemble): ${index.pastIdeas.join(' | ') || 'none'}
Ideas Moe LIKED (lean toward similar themes): ${fb.liked.join(' | ') || 'none yet'}
Ideas Moe DISLIKED (avoid these directions): ${fb.disliked.join(' | ') || 'none yet'}`;

  // ---------- Step 1: Scout ----------
  const s1 = await ask(`
${ABOUT}
TODAY is ${today}. Use Google Search to research what is happening RIGHT NOW: trending app categories on Google Play, real user complaints ("I wish there was an app..."), new APIs/AI capabilities, and gaps in the Arabic and Middle East market.
${prefs}

Propose 8 candidate app ideas. Respond with ONLY JSON. Values in Arabic except "name" (short English app name):
{
  "marketNotes": "ملاحظات السوق اليوم",
  "trends": ["ترند", "ترند", "ترند"],
  "candidates": [
    { "name": "AppName", "pitch": "جملة", "problem": "المشكلة", "audience": "الجمهور", "whyNow": "ليش هلأ مع الدليل" }
  ]
}`, { search: true });
  const candidates = s1.json.candidates || [];
  if (!candidates.length) throw new Error('Step 1 returned no candidates');
  log('scout', `${candidates.length} candidates via ${s1.model}: ${candidates.map(c => c.name).join(', ')}`);

  // ---------- Step 2: Competition check ----------
  const s2 = await ask(`
For each candidate app below, search Google Play and the web for EXISTING apps that already do the same thing. Be honest and specific: name real apps. If strong competitors exist, say so.

Candidates:
${candidates.map(c => `- ${c.name}: ${c.pitch}`).join('\n')}

Respond with ONLY JSON. Values in Arabic except app names:
{
  "checks": [
    {
      "name": "CandidateName",
      "competitors": [ { "name": "Real App Name", "note": "شو بيعمل ونقطة ضعفه" } ],
      "saturation": "low or medium or high",
      "gap": "الفجوة اللي ما حدا مغطيها"
    }
  ]
}`, { search: true });
  const checks = s2.json.checks || [];
  log('compete', `checked ${checks.length} candidates via ${s2.model}`);

  // ---------- Step 3: Judge ----------
  const s3 = await ask(`
${ABOUT}
You are a strict product judge. Below are candidate ideas and a competition check for each.
${prefs}

Rules:
- REJECT ideas with high saturation and no clear gap.
- REJECT ideas too big for one person in 3 weeks.
- Prefer ideas with a clear way to make money and a real, specific gap.
- Pick the best 5 (fewer if fewer deserve it). Score honestly 1-10.

Candidates:
${JSON.stringify(candidates)}

Competition check:
${JSON.stringify(checks)}

Respond with ONLY JSON. Values in Arabic except app names:
{
  "summary": "ملخص اليوم بجملتين",
  "trends": ["ترند", "ترند", "ترند"],
  "ideas": [
    {
      "name": "AppName",
      "pitch": "جملة",
      "problem": "المشكلة",
      "audience": "الجمهور",
      "whyNow": "ليش هلأ",
      "competition": "منخفضة أو متوسطة أو عالية",
      "competitors": ["App 1", "App 2"],
      "edge": "كيف نتفوق على المنافسين",
      "monetization": "طريقة الربح",
      "buildDifficulty": "سهل أو متوسط أو صعب",
      "buildDays": 10,
      "score": 8,
      "firstStep": "أول خطوة"
    }
  ],
  "rejected": [ { "name": "AppName", "reason": "ليش انرفضت" } ]
}
"score" and "buildDays" MUST be plain JSON numbers using Western digits 0-9 (e.g. 8 or 7.5), never text and never Arabic-Indic digits.
Sort ideas by score, highest first.`);
  const final = s3.json;
  if (!Array.isArray(final.ideas) || !final.ideas.length) throw new Error('Judge returned no ideas');

  // الأرقام لازم تكون أرقام عادية: بنحوّل ٨ أو "8/10" أو "8.5" لرقم
  const toNum = v => {
    if (typeof v === 'number') return v;
    const s = String(v ?? '')
      .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace('٫', '.');
    const m = s.match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : 0;
  };
  final.ideas = final.ideas
    .map(x => ({
      ...x,
      score: Math.max(0, Math.min(10, toNum(x.score ?? x.Score ?? x.rating))),
      buildDays: toNum(x.buildDays)
    }))
    .sort((a, b) => b.score - a.score);
  if (final.ideas.every(x => !x.score)) log('warn', 'all scores are 0, check judge output');
  log('judge', `kept ${final.ideas.length}, rejected ${(final.rejected || []).length} via ${s3.model}`);

  // ---------- English version ----------
  let en = null;
  try {
    en = await translate({ summary: final.summary, trends: final.trends || [], ideas: final.ideas, rejected: final.rejected || [] });
    (en.ideas || []).forEach((x, i) => {
      if (final.ideas[i]) { x.name = final.ideas[i].name; x.score = final.ideas[i].score; x.buildDays = final.ideas[i].buildDays; }
    });
    log('translate', 'English version ready');
  } catch (e) {
    log('translate', 'skipped: ' + e.message);
  }

  // ---------- Save ----------
  const seen = new Set();
  const sources = [...s1.sources, ...s2.sources].filter(s => !seen.has(s.url) && seen.add(s.url)).slice(0, 20);

  const report = {
    date: today,
    generatedAt: new Date().toISOString(),
    model: s3.model,
    summary: final.summary,
    trends: final.trends?.length ? final.trends : s1.json.trends,
    ideas: final.ideas,
    rejected: final.rejected || [],
    en,
    agent: { version: 3, candidates: candidates.length, steps: trace },
    sources
  };

  fs.writeFileSync(path.join(DIR, `${today}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(DIR, 'latest.json'), JSON.stringify(report, null, 2));

  index.dates = [today, ...index.dates.filter(d => d !== today)].slice(0, 365);
  index.pastIdeas = [...final.ideas.map(x => x.name), ...index.pastIdeas.filter(n => !final.ideas.some(x => x.name === n))].slice(0, 100);
  fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(index, null, 2));

  console.log(`OK ${today}: ${final.ideas.map(x => `${x.name}(${x.score})`).join(', ')}`);
})().catch(e => { console.error(e.message); process.exit(1); });
