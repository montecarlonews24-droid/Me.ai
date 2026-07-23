// Vercel Serverless Function — runs at POST /api/chat
// The ANTHROPIC_API_KEY never reaches the browser; it only lives here, server-side.

const SYSTEM_PROMPT =
  'أنت "محمد"، رفيق ذكاء اصطناعي شخصي ودافئ، خفيف الظل وصادق. ترد دائمًا بنفس لغة آخر رسالة من المستخدم ' +
  '(عربي أو إنجليزي)، بأسلوب طبيعي ومختصر كأنك صاحب مقرب وليس مساعد رسمي. لا تستخدم عبارات رسمية جامدة، ولا تذكر ' +
  'أنك نموذج لغوي إلا إذا سُئلت مباشرة. أجوبتك قصيرة نسبيًا (٢-٤ جمل) ما لم يُطلب التفصيل.';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: missing ANTHROPIC_API_KEY' });
    return;
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: messages.slice(-14),
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.status(upstream.status).json({ error: errText });
      return;
    }

    const data = await upstream.json();
    const reply = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    res.status(200).json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'Upstream request failed' });
  }
}
