// Me.ai Idea Scout v2 — Multi-step Agent
// الخطوة 1: يبحث ويقترح 8 أفكار
// الخطوة 2: يفحص المنافسين لكل فكرة على Google Play
// الخطوة 3: يحكم بصرامة، يرفض الضعيف، ويختار أقوى 5
import fs from 'fs';
import path from 'path';

const KEYS = (process.env.GEMINI_API_KEY || '').split(',').map(s => s.trim()).filter(Boolean);
// كل سكريبت بيبلّش بمفتاح مختلف، عشان ما يخلّصوا حصة نفس المشروع مع بعض (Idea Scout يبلّش بآخر مفتاح (الأحدث))
const START = Math.max(0, KEYS.length - 1) % Math.max(1, KEYS.length);
const ORDERED = KEYS.map((k, i) => [ (i + START) % KEYS.length + 1, KEYS[(i + START) % KEYS.length] ]);
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
    for (const [num, key] of ORDERED) {
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
        if (!r.ok) { lastErr = data.error?.message || r.status; console.log(`  x ${model} key${num}: ${lastErr}`); continue; }
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
        console.log(`  x ${model} key${num}: ${e.message}`);
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

  // ---------- Step 0: World scan ----------
  // الـ Agent ما بيبدأ من سوق التطبيقات: بيدرس شو عم يتغير بالعالم كله أول (الأرض، الفضاء، الشمس، الناس، الاقتصاد، القوانين...)
  // وبعدين الأفكار بتطلع من هالتغيرات، مش من نسخ تطبيقات موجودة
  const s0 = await ask(`
TODAY is ${today}. You are a world-change researcher. Use Google Search to find what is changing RIGHT NOW (last weeks and coming months) that affects ordinary people's daily lives anywhere in the world. Look at ALL of these areas, not only technology:
1) SPACE & SUN: solar activity and storms, auroras, radiation and UV levels, satellites and launches, eclipses, meteor showers, the Moon, space weather effects on GPS, radio and power grids.
2) EARTH & CLIMATE: heat waves, wildfires and smoke, air quality, floods, droughts, pollen seasons, earthquakes, oceans, insects and animal migrations.
3) BODY & DAILY LIFE: sleep, daylight and seasons, noise, screen time, ageing populations, loneliness, pets, food prices and habits (no medical treatment advice).
4) MONEY & WORK: prices, energy bills, remote work, side incomes, new consumer behaviours.
5) TECHNOLOGY: new phone sensors and Android features, satellite messaging, new AI abilities, wearables, smart home.
6) RULES & SOCIETY: new laws (EU, USA, others) that force people or businesses to change what they do, big events, cultural shifts.
7) CONNECTIONS: changes in one area that affect another (for example sun activity -> GPS errors -> farmers and drivers; heat -> sleep -> work).
Prefer concrete, recent, checkable changes with a source over general topics.

Respond with ONLY JSON. Values in Arabic:
{
  "signals": [
    { "area": "الفضاء والشمس", "change": "شو عم يتغير بالضبط", "who": "مين بيتأثر وكيف", "evidence": "الدليل: مصدر أو رقم أو تاريخ" }
  ],
  "links": ["ربط بين مجالين: تغيير بمجال بيأثر على مجال ثاني"]
}
Give 12-16 signals covering at least 6 different areas, and 3-5 links.`, { search: true });
  const signals = s0.json.signals || [];
  const links = s0.json.links || [];
  log('world', `${signals.length} world changes, ${links.length} cross-links via ${s0.model}: ${[...new Set(signals.map(x => x.area))].join(', ')}`);
  const world = `
WORLD CHANGES FOUND TODAY (build ideas from THESE, not from copying existing apps):
${signals.map((x, i) => `${i + 1}. [${x.area}] ${x.change} | who: ${x.who} | evidence: ${x.evidence}`).join('\n')}
CROSS-LINKS: ${links.join(' | ') || 'none'}`;

  // ---------- Step 1: Scout ----------
  const s1 = await ask(`
${ABOUT}
TODAY is ${today}.
${world}

Turn these world changes into app ideas. Each idea MUST start from one or two of the changes above (say which), ideally connecting two different areas (for example Earth and space, climate and sleep, a new law and money). Use Google Search only to check details and real user needs; do NOT start from "what apps are trending on Google Play".
TARGET MARKET: GLOBAL ONLY. Every idea must be an English app for users worldwide (USA, Europe, Australia and other high-paying countries).
- Do NOT propose regional apps: nothing built for the Arab world, the Gulf, Jordan or any single country, and no "X for Arabs" / "Arabic version of an existing app".
NOVELTY: Moe wants only NEW KINDS of apps that do not exist yet on Google Play.
- Do NOT propose a better/cheaper/AI version of an app category that already exists (no AI document simplifier, no AI nutrition scanner, no habit tracker, no AI tutor, no AI chat assistant, no budget app, etc.).
- Every idea MUST be a phone app that a person installs from Google Play and uses on an Android phone (screens, buttons, the phone's own sensors/camera/GPS/notifications, AI inside the app). NOT an autonomous AI agent, NOT a smart-home or IoT system, NOT hardware, NOT a web platform, NOT a B2B service or automation.
- Each idea needs a core function that no popular app offers today: a new use of a phone sensor, a new AI capability, a new behaviour or trend from the last few months, or two things nobody has combined.
${prefs}

Propose 8 candidate app ideas. Respond with ONLY JSON. Values in Arabic except "name" (short English app name):
{
  "marketNotes": "ملاحظات السوق اليوم",
  "trends": ["ترند", "ترند", "ترند"],
  "candidates": [
    { "name": "AppName", "signal": "التغيير بالعالم اللي طلعت منه الفكرة", "pitch": "جملة", "problem": "المشكلة", "audience": "الجمهور", "whyNow": "ليش هلأ مع الدليل" }
  ]
}`, { search: true });
  const candidates = s1.json.candidates || [];
  if (!candidates.length) throw new Error('Step 1 returned no candidates');
  log('scout', `${candidates.length} candidates via ${s1.model}: ${candidates.map(c => c.name).join(', ')}`);

  // ---------- Step 2: Competition check ----------
  const s2 = await ask(`
For each candidate app below, search Google Play and the web for EXISTING apps that already do the same thing or the same core function. Be honest and specific: name real apps. Mark saturation "low" if there are no competitors or only a few weak/small ones that leave a clear gap, "medium" if there are several decent apps, "high" if the space is crowded with strong popular apps.

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
- REJECT any idea that is regional (Arab world, Gulf, one country) or Arabic-only. Moe wants global English apps only.
- REJECT ideas with saturation "high" (crowded with strong popular apps).
- Ideas with weak or few competitors are OK when there is a clear, specific gap they miss: write that gap in "edge". REJECT a "medium" idea if you cannot name a real gap.
- REJECT ideas that are not built on a real world change from the list below, or whose link to that change is weak or invented.
- Prefer ideas that connect two different areas (Earth and space, climate and daily life, a new law and money).
- REJECT ideas too big for one person in 3 weeks.
- REJECT any idea that is not a phone app the user installs and uses on Android: autonomous AI agents, smart-home/IoT control systems, hardware, web platforms, B2B services or automation.
- Prefer ideas with a clear way to make money and a real, specific gap.
- Pick the best 5 (fewer if fewer deserve it). Score honestly 1-10.

${world}

Candidates:
${JSON.stringify(candidates)}

Competition check:
${JSON.stringify(checks)}

Respond with ONLY JSON. Values in Arabic except app names:
{
  "summary": "ملخص اليوم بجملتين",
  "trends": ["أهم 3-5 تغييرات بالعالم اللي طلعت منها أفكار اليوم، كل واحد بجملة قصيرة"],
  "ideas": [
    {
      "name": "AppName",
      "signal": "التغيير بالعالم اللي طلعت منه الفكرة",
      "pitch": "جملة",
      "problem": "المشكلة",
      "audience": "الجمهور",
      "whyNow": "ليش هلأ",
      "novelty": "شو الجديد فيها اللي ما في تطبيق بيعمله",
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
  if (!Array.isArray(final.ideas)) throw new Error('Judge returned no ideas list');

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
  // الحكم أحياناً بيتساهل: أي فكرة إلها منافسة متوسطة أو عالية، أو فحص المنافسين لقى إلها منافسين مباشرين، بتنشال هون بالكود
  final.rejected = final.rejected || [];
  final.ideas = final.ideas.filter(x => {
    const chk = checks.find(c => String(c.name || '').trim().toLowerCase() === String(x.name || '').trim().toLowerCase());
    const sat = String(chk?.saturation || '').toLowerCase();
    const comp = String(x.competition || '');
    // منافسة عالية = بتنشال. متوسطة = بتضل بس إذا في فجوة واضحة (edge). قليلة = بتضل
    const high = /عالي|high/i.test(comp) || /high/.test(sat);
    const medium = /متوسط|medium/i.test(comp) || /medium/.test(sat);
    if (high || (medium && String(x.edge || '').trim().length < 15)) {
      final.rejected.push({ name: x.name, reason: `في تطبيقات بتعمل نفس الشي (${(x.competitors || []).slice(0, 3).join('، ') || 'منافسين موجودين'})، وMoe بده أفكار جديدة من نوعها بس.` });
      log('judge', `removed (competitors exist): ${x.name}`);
      return false;
    }
    return true;
  });
  if (!final.ideas.length) {
    final.summary = 'ما لقيت اليوم فكرة جديدة من نوعها فعلاً: كل الأفكار كان إلها تطبيقات بتعمل نفس الشي. هاي التغييرات اللي درستها بالعالم، ورح أدوّر مرة تانية بالجولة الجاية.';
    log('judge', 'no truly new idea today');
  }
  if (final.ideas.length && final.ideas.every(x => !x.score)) log('warn', 'all scores are 0, check judge output');
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
  const sources = [...s0.sources, ...s1.sources, ...s2.sources].filter(s => !seen.has(s.url) && seen.add(s.url)).slice(0, 30);

  const report = {
    date: today,
    generatedAt: new Date().toISOString(),
    model: s3.model,
    summary: final.summary,
    trends: final.trends?.length ? final.trends : s1.json.trends,
    world: { signals, links },
    ideas: final.ideas,
    rejected: final.rejected || [],
    en,
    agent: { version: 4, candidates: candidates.length, steps: trace },
    sources
  };

  fs.writeFileSync(path.join(DIR, `${today}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(DIR, 'latest.json'), JSON.stringify(report, null, 2));

  index.dates = [today, ...index.dates.filter(d => d !== today)].slice(0, 365);
  index.pastIdeas = [...final.ideas.map(x => x.name), ...index.pastIdeas.filter(n => !final.ideas.some(x => x.name === n))].slice(0, 100);
  fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(index, null, 2));

  console.log(`OK ${today}: ${final.ideas.map(x => `${x.name}(${x.score})`).join(', ')}`);
})().catch(e => { console.error(e.message); process.exit(1); });
