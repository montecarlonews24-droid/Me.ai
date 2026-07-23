// Vercel Serverless Function — runs at POST /api/tts
// Uses Gemini's text-to-speech model to generate natural audio.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('TTS DEBUG: missing GEMINI_API_KEY env var');
    res.status(500).json({ error: 'Server misconfigured: missing GEMINI_API_KEY' });
    return;
  }

  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
            },
          },
        }),
      }
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('TTS DEBUG: status=' + upstream.status + ' body=' + errText);
      res.status(upstream.status).json({ error: errText });
      return;
    }

    const data = await upstream.json();
    const part = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!part?.data) {
      console.error('TTS DEBUG: no inlineData in response: ' + JSON.stringify(data).slice(0, 500));
      res.status(500).json({ error: 'No audio returned' });
      return;
    }

    // Gemini returns raw 16-bit PCM mono audio at 24kHz — wrap it in a WAV header
    // so the browser's <audio> element can play it directly.
    const pcm = Buffer.from(part.data, 'base64');
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    const wav = Buffer.concat([header, pcm]);

    res.status(200).json({ audio: 'data:audio/wav;base64,' + wav.toString('base64') });
  } catch (err) {
    console.error('TTS DEBUG: exception=' + (err && err.message));
    res.status(500).json({ error: 'TTS request failed' });
  }
}
