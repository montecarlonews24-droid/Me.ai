// Me.ai Build Planner — Agent التنفيذ
// بيقرأ طلبات "ابنيها" من Firebase، وبيبحث، وبيكتب خطة بناء كاملة لكل فكرة
import fs from 'fs';
import path from 'path';

const KEYS = (process.env.GEMINI_API_KEY || '').split(',').map(s => s.trim()).filter(Boolean);
const MODELS = ['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-4-hydrogen'];
const DB = (process.env.FIREBASE_DB || '').replace(/\/$/, '');
const PLANS = path.join(process.cwd(), 'plans');
const REPORTS = path.join(process.cwd(), 'reports');

if (!KEYS.length || !DB) { console.error('GEMINI_API_KEY or FIREBASE_DB missing'); process.exit(1); }

function extractJSON(text) {
  text = text.replace(/```json|```/g, '');
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(s, e + 1));
}

async function ask(prompt, { search = false } = {}) {
  let lastErr = '';
  for (const model of MODELS) {
    for (const [i, key] of KEYS.entries()) {
      try {
        const body = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: search ? 0.7 : 0.4 }
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

// بيدوّر على الفكرة بالتقارير القديمة عشان ياخد المنافسين والتفاصيل
function findIdea(name) {
  if (!fs.existsSync(REPORTS)) return null;
  const files = fs.readdirSync(REPORTS).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(REPORTS, f), 'utf8'));
      const hit = (r.ideas || []).find(x => x.name === name);
      if (hit) return hit;
    } catch {}
  }
  return null;
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

const ABOUT = `Moe is an independent Android developer in Amman, Jordan. He does not write code himself: he gives the idea to Claude, Claude produces complete files, and Moe uploads them to GitHub from his phone. His proven setup: a native Kotlin Android app built by GitHub Actions from a single patch.pkg zip (the same way his Me.ai app is built). He has Firebase and Gemini API keys available. One person, phone only.`;

async function makePlan(req) {
  const known = findIdea(req.name) || {};
  const idea = { ...known, ...req };
  console.log(`[plan] ${idea.name}`);

  // ---------- Step 1: Research ----------
  const s1 = await ask(`
Research this Android app idea using Google Search:
Name: ${idea.name}
Pitch: ${idea.pitch || ''}
Problem: ${idea.problem || ''}
Audience: ${idea.audience || ''}
Known competitors: ${(idea.competitors || []).join(', ') || 'unknown'}

Find:
1. FREE or cheap APIs / data sources that this app could use (real names, with what they provide).
2. The top competitor apps on Google Play and what users COMPLAIN about in their reviews.
3. Anything legal/regulatory to watch in Jordan for this kind of app.

Respond with ONLY JSON. Values in Arabic except proper names:
{
  "apis": [ { "name": "API name", "free": true, "use": "شو بنستعمل منه" } ],
  "competitors": [ { "name": "App", "complaints": "شو بيشتكوا المستخدمين" } ],
  "legal": "ملاحظات قانونية إن وجدت"
}`, { search: true });
  console.log(`  research: ${(s1.json.apis || []).length} apis, ${(s1.json.competitors || []).length} competitors`);

  // ---------- Step 2: Plan ----------
  const s2 = await ask(`
${ABOUT}

Write a complete, realistic build plan for this app. Keep the first version (MVP) small enough to ship in about ${idea.buildDays || 14} days.

Idea: ${JSON.stringify(idea)}
Research: ${JSON.stringify(s1.json)}

Do not use markdown inside values (no ** and no bullet symbols).
Respond with ONLY JSON. Values in Arabic except proper names, code names, and the Play Store fields (write those in the language that fits the audience, Arabic if the audience is Arabic):
{
  "summary": "الخطة بجملتين",
  "mvpFeatures": ["ميزة", "ميزة"],
  "laterFeatures": ["ميزة للنسخ الجاية"],
  "screens": [ { "name": "اسم الشاشة", "purpose": "شو بتعمل" } ],
  "dataSources": [ { "name": "API", "free": true, "notes": "ملاحظة" } ],
  "techStack": "Kotlin، وشو بنستعمل بالزبط وليش",
  "buildSteps": [ { "day": "1-2", "task": "المهمة" } ],
  "beatCompetitors": "كيف نتفوق على المنافسين بناءً على شكاوي مستخدمينهم",
  "monetization": "طريقة الربح بالتفصيل",
  "risks": ["خطر وكيف نتجنبه"],
  "playStore": {
    "title": "max 30 chars",
    "shortDescription": "max 80 chars",
    "fullDescription": "3-5 short paragraphs",
    "keywords": ["keyword"]
  },
  "firstPrompt": "رسالة جاهزة بالعامية الأردنية يلصقها Moe لـ Claude عشان يبلّش البناء: اسم التطبيق، شو بيعمل، ميزات النسخة الأولى، الشاشات، مصادر البيانات، وإنه بدو تطبيق Kotlin أصلي بنفس طريقة Me.ai (ملف build.yml وملف patch.pkg جاهزين للرفع على GitHub)"
}`);
  console.log(`  plan via ${s2.model}`);

  let en = null;
  try {
    const { firstPrompt, ...rest } = s2.json;
    en = await translate(rest);
    console.log('  English version ready');
  } catch (e) {
    console.log('  translate skipped: ' + e.message);
  }

  return {
    name: idea.name,
    pitch: idea.pitch || '',
    generatedAt: new Date().toISOString(),
    model: s2.model,
    ...s2.json,
    en,
    research: s1.json,
    sources: s1.sources.slice(0, 12)
  };
}

(async () => {
  const reqs = (await (await fetch(`${DB}/builds.json`)).json()) || {};
  if (!fs.existsSync(PLANS)) fs.mkdirSync(PLANS, { recursive: true });

  const todo = Object.entries(reqs)
    .filter(([k, v]) => v && v.name && !fs.existsSync(path.join(PLANS, `${k}.json`)))
    .slice(0, 3);

  if (!todo.length) { console.log('No new build requests.'); return; }

  for (const [k, v] of todo) {
    try {
      const plan = await makePlan(v);
      fs.writeFileSync(path.join(PLANS, `${k}.json`), JSON.stringify(plan, null, 2));
      console.log(`OK plan saved: ${k}`);
    } catch (e) {
      console.log(`FAILED ${k}: ${e.message}`);
    }
  }
})().catch(e => { console.error(e.message); process.exit(1); });
