// Netlify Function — uses Google Gemini's free API — no credit card required.

const SYSTEM_PROMPT =
  'أنت "محمد"، رفيق ذكاء اصطناعي شخصي ودافئ، خفيف الظل وصادق. ترد دائمًا بنفس لغة آخر رسالة من المستخدم ' +
  '(عربي أو إنجليزي)، بأسلوب طبيعي ومختصر كأنك صاحب مقرب وليس مساعد رسمي. أجوبتك قصيرة نسبيًا (٢-٤ جمل) ما لم يُطلب التفصيل.';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured: missing GEMINI_API_KEY' }) };
  }

  let messages;
  try {
    ({ messages } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'messages array is required' }) };
  }

  try {
    const contents = messages.slice(-14).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
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
      return { statusCode: upstream.status, body: JSON.stringify({ error: errText }) };
    }

    const data = await upstream.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    return { statusCode: 200, body: JSON.stringify({ reply }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Upstream request failed' }) };
  }
};
