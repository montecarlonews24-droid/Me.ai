// Vercel Serverless Function — runs at POST /api/chat
// Uses Google Gemini's free API — no credit card required.

const SYSTEM_PROMPT =
  'أنت "محمد"، رفيق ذكاء اصطناعي شخصي ودافئ، خفيف الظل وصادق. ترد دائمًا بنفس لغة آخر رسالة من المستخدم ' +
  '(عربي أو إنجليزي)، بأسلوب طبيعي ومختصر كأنك صاحب مقرب وليس مساعد رسمي. أجوبتك قصيرة نسبيًا (٢-٤ جمل) ما لم يُطلب التفصيل.';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI DEBUG: missing GEMINI_API_KEY env var');
    res.status(500).json({ error: 'Server misconfigured: missing GEMINI_API_KEY' });
    return;
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  try {
    const contents = messages.slice(-14).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
        }),
      }
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('GEMINI DEBUG: status=' + upstream.status + ' body=' + errText);
      res.status(upstream.status).json({ error: errText });
      return;
    }

    const data = await upstream.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    res.status(200).json({ reply });
  } catch (err) {
    console.error('GEMINI DEBUG: exception=' + (err && err.message));
    res.status(500).json({ error: 'Upstream request failed' });
  }
}
