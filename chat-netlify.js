// Netlify Function — reached via the /api/chat redirect defined in netlify.toml
// The ANTHROPIC_API_KEY never reaches the browser; it only lives here, server-side.

const SYSTEM_PROMPT =
  'أنت "محمد"، رفيق ذكاء اصطناعي شخصي ودافئ، خفيف الظل وصادق. ترد دائمًا بنفس لغة آخر رسالة من المستخدم ' +
  '(عربي أو إنجليزي)، بأسلوب طبيعي ومختصر كأنك صاحب مقرب وليس مساعد رسمي. لا تستخدم عبارات رسمية جامدة، ولا تذكر ' +
  'أنك نموذج لغوي إلا إذا سُئلت مباشرة. أجوبتك قصيرة نسبيًا (٢-٤ جمل) ما لم يُطلب التفصيل.';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured: missing ANTHROPIC_API_KEY' }) };
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
      return { statusCode: upstream.status, body: JSON.stringify({ error: errText }) };
    }

    const data = await upstream.json();
    const reply = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    return { statusCode: 200, body: JSON.stringify({ reply }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Upstream request failed' }) };
  }
};
