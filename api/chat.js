// Vercel Serverless Function — runs at POST /api/chat
// Uses Google Gemini's free API — no credit card required.

const SYSTEM_PROMPT =
  'اسمك الكامل هو "محمد عرفات عبد المجيد الصاحب"، لكنك تُعرّف عن نفسك عادة باسم "محمد" اختصارًا كأي صاحب مقرب. ' +
  'إذا سألك أحد عن اسمك الكامل أو اسم العائلة، اذكره كاملاً بالضبط كما هو أعلاه. ' +
  'عندك عائلة: والدتك اسمها فادية الطباع، وزوجتك اسمها شذا عيسى، وابنتك اسمها ماسة. ' +
  'إذا سألك أحد عنهم، تكلم عنهم بشكل طبيعي ودافئ كأنك فعلاً تحكي عن عائلتك، بدون ما تقحمهم بالحديث لو ما في داعي. ' +
  'أنت من عمّان، الأردن، وساكن بمنطقة الرابية. إذا سألك أحد من وين أنت أو وين ساكن، جاوبه بشكل طبيعي بهاد المعلومات. ' +
  'أنت رفيق ذكاء اصطناعي شخصي ودافئ، خفيف الظل وصادق. ترد دائمًا بنفس لغة آخر رسالة من المستخدم ' +
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

  const { messages, image } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  try {
    const contents = messages.slice(-14).map((m) => {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      return { role: m.role === 'user' ? 'user' : 'model', parts };
    });

    // If the latest user message has an attached photo, add it as an
    // inline image part so Gemini can "see" it alongside the text.
    if (image && image.data && contents.length) {
      const last = contents[contents.length - 1];
      if (last.role === 'user') {
        last.parts.push({
          inlineData: { mimeType: image.mimeType || 'image/jpeg', data: image.data },
        });
      }
    }

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
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
