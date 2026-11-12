// scout.js — Me.ai Daily Idea Scout
// يبحث يومياً عن أفكار تطبيقات جديدة عبر Gemini + Google Search ويحفظ تقرير JSON

const fs = require('fs');
const path = require('path');

// تقدر تحط أكثر من مفتاح بالـ Secret مفصولين بفاصلة: key1,key2,key3
const KEYS = (process.env.GEMINI_API_KEY || '').split(',').map(s => s.trim()).filter(Boolean);
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
const DIR = path.join(process.cwd(), 'reports');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Amman' }); // YYYY-MM-DD

if (!KEYS.length) { console.error('❌ GEMINI_API_KEY مش موجود بالـ Secrets'); process.exit(1); }
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

const index = readJSON(path.join(DIR, 'index.json'), { dates: [], pastIdeas: [] });

const prompt = `
You are "Me.ai Idea Scout", a research agent working for Moe — an independent Android developer in Amman, Jordan.
Moe builds Android apps (native Kotlin, or hybrid with Firebase) and publishes on Google Play. He works from a phone only.

TODAY is ${today}. Use Google Search to research what is happening RIGHT NOW:
- Rising and trending apps/categories on Google Play and app charts
- Real user complaints and "I wish there was an app for..." posts (Reddit, forums, reviews)
- New APIs, AI capabilities or platform changes that open new app opportunities
- Gaps in the Arabic / Middle East market

Then propose exactly 5 NEW app ideas Moe could build in 1–3 weeks and publish on Google Play.
Do NOT repeat or closely resemble any of these previous ideas: ${index.pastIdeas.length ? index.pastIdeas.join(' | ') : 'none yet'}.

Respond with ONLY a JSON object, no markdown, no extra text, in exactly this shape.
Write all values in Arabic, except "name" which is a short catchy English app name:
{
  "summary": "ملخص اليوم بجملتين: أهم ما لاحظته بالسوق",
  "trends": ["ترند 1", "ترند 2", "ترند 3"],
  "ideas": [
    {
      "name": "AppName",
      "pitch": "وصف الفكرة بجملة واحدة",
      "problem": "المشكلة اللي بتحلها",
      "audience": "الجمهور المستهدف",
      "whyNow": "ليش هلأ؟ الدليل من البحث",
      "competition": "منخفضة أو متوسطة أو عالية",
      "monetization": "طريقة الربح",
      "buildDifficulty": "سهل أو متوسط أو صعب",
      "buildDays": 7,
      "score": 8,
      "firstStep": "أول خطوة عملية للبدء"
    }
  ]
}
"score" is 1–10 for overall opportunity. Sort ideas by score, highest first.
`;

async function callGemini() {
  for (const model of MODELS) {
    for (const [i, key] of KEYS.entries()) {
      try {
        console.log(`→ ${model} (مفتاح ${i + 1})`);
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              tools: [{ google_search: {} }],
              generationConfig: { temperature: 0.9 }
            })
          }
        );
        const data = await r.json();
        if (!r.ok) { console.log(`✗ ${data.error?.message || r.status}`); continue; }

        const cand = data.candidates?.[0];
        const text = (cand?.content?.parts || []).map(p => p.text || '').join('');
        const sources = (cand?.groundingMetadata?.groundingChunks || [])
          .map(c => c.web).filter(Boolean)
          .map(w => ({ title: w.title, url: w.uri }));

        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start < 0 || end < 0) { console.log('✗ الرد ما فيه JSON'); continue; }
        const report = JSON.parse(text.slice(start, end + 1));
        if (!Array.isArray(report.ideas) || !report.ideas.length) { console.log('✗ ما في أفكار'); continue; }

        return { model, report, sources };
      } catch (e) {
        console.log(`✗ ${e.message}`);
      }
    }
  }
  throw new Error('كل المفاتيح والموديلات فشلت');
}

(async () => {
  const { model, report, sources } = await callGemini();

  const full = {
    date: today,
    generatedAt: new Date().toISOString(),
    model,
    ...report,
    sources: sources.slice(0, 15)
  };

  fs.writeFileSync(path.join(DIR, `${today}.json`), JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(DIR, 'latest.json'), JSON.stringify(full, null, 2));

  index.dates = [today, ...index.dates.filter(d => d !== today)].slice(0, 365);
  index.pastIdeas = [...report.ideas.map(x => x.name), ...index.pastIdeas].slice(0, 100);
  fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(index, null, 2));

  console.log(`✅ تقرير ${today}: ${report.ideas.length} أفكار — ${report.ideas.map(x => x.name).join(', ')}`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
