import React, { useEffect, useRef, useState } from 'react';
import { Mic, Send, Volume2, Loader2 } from 'lucide-react';

export default function App() {
  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);

  const isSpeakingRef = useRef(false);

  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'أهلاً، أنا محمد 👋 اكتبلي أو اضغط على 🎙️ وابلاش احكيلي — رح أرد عليك بصوتي وضل مسمعلك لحتى توقف المحادثة.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const conversationModeRef = useRef(false);
  const isThinkingRef = useRef(false);
  const [lang, setLang] = useState('ar');
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [voices, setVoices] = useState([]);
  const warnedNoArabicVoice = useRef(false);

  const detectLang = (t) => (/[\u0600-\u06FF]/.test(t) ? 'ar' : 'en');

  useEffect(() => {
    if (!window.speechSynthesis) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const pickVoice = (langCode) => {
    if (!voices.length) return null;
    if (langCode === 'ar') {
      return (
        voices.find((v) => v.lang.toLowerCase() === 'ar-sa') ||
        voices.find((v) => v.lang.toLowerCase().startsWith('ar')) ||
        null
      );
    }
    return (
      voices.find((v) => v.lang.toLowerCase() === 'en-us') ||
      voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
      null
    );
  };

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setVoiceSupported(false);
      return;
    }
    recognitionRef.current = new SR();
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = false;
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, isThinking]);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  const speak = (text, langCode) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(langCode);

    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = langCode === 'ar' ? 'ar-SA' : 'en-US';
      if (langCode === 'ar' && !voice && voices.length && !warnedNoArabicVoice.current) {
        warnedNoArabicVoice.current = true;
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: 'ملاحظة: جهازك ما فيه صوت عربي مثبّت، فرح تسمعني بلكنة إنجليزية. فيك تضيف صوت عربي من إعدادات النظام.',
          },
        ]);
      }
    }

    utter.rate = 1;
    utter.pitch = 1;
    utter.onstart = () => {
      isSpeakingRef.current = true;
      setIsSpeaking(true);
    };
    const stop = () => {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      if (conversationModeRef.current) {
        setTimeout(() => startListening(), 350);
      }
    };
    utter.onend = stop;
    utter.onerror = stop;
    window.speechSynthesis.speak(utter);
  };

  const sendMessage = async (rawText) => {
    const text = (rawText || '').trim();
    if (!text || isThinking) return;
    const detected = detectLang(text);
    const userMsg = { role: 'user', text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setIsThinking(true);

    try {
      const history = nextMessages.slice(-14).map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });

      if (!response.ok) throw new Error('backend error');

      const data = await response.json();
      const replyText =
        (data.reply || '').trim() ||
        (detected === 'ar' ? 'عذرًا، صار في خلل بسيط. جرب كمان مرة.' : 'Sorry, something went wrong — try again.');

      setMessages((m) => [...m, { role: 'assistant', text: replyText }]);
      speak(replyText, detectLang(replyText));
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: detected === 'ar' ? 'في مشكلة بالاتصال، حاول كمان مرة.' : 'Connection issue — please try again.' },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const startListening = () => {
    if (!voiceSupported || !recognitionRef.current) return;
    if (isSpeakingRef.current || isThinkingRef.current) return;

    recognitionRef.current.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
    recognitionRef.current.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      sendMessage(transcript);
    };
    recognitionRef.current.onend = () => {
      setIsListening(false);
      if (conversationModeRef.current && !isThinkingRef.current && !isSpeakingRef.current) {
        setTimeout(() => {
          if (conversationModeRef.current && !isThinkingRef.current && !isSpeakingRef.current) {
            startListening();
          }
        }, 500);
      }
    };
    recognitionRef.current.onerror = () => setIsListening(false);
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (err) {
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {}
    }
    setIsListening(false);
  };

  const toggleConversationMode = () => {
    if (!voiceSupported || !recognitionRef.current) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text:
            lang === 'ar'
              ? 'متصفحك لا يدعم التعرف على الصوت، بس فيك تكتبلي 🙂'
              : "Your browser doesn't support voice input, but you can type to me 🙂",
        },
      ]);
      return;
    }
    const next = !conversationMode;
    conversationModeRef.current = next;
    setConversationMode(next);
    if (next) {
      startListening();
    } else {
      stopListening();
      window.speechSynthesis && window.speechSynthesis.cancel();
      isSpeakingRef.current = false;
      setIsSpeaking(false);
    }
  };

  let ringClass = 'mc-ring-idle';
  let ringColor = 'rgba(125,224,211,0.45)';
  if (isListening) {
    ringClass = 'mc-ring-listen';
    ringColor = 'rgba(232,163,61,0.7)';
  } else if (isThinking) {
    ringClass = 'mc-ring-think';
    ringColor = 'rgba(232,163,61,0.7)';
  } else if (isSpeaking) {
    ringClass = 'mc-ring-speak';
    ringColor = 'rgba(125,224,211,0.85)';
  }

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="mc-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lalezar&family=Tajawal:wght@400;500;700;800&display=swap');
        * { box-sizing: border-box; }
        html, body, #root { margin:0; padding:0; height:100%; }
        .mc-root { display:flex; flex-direction:column; width:100%; height:100vh; height:100dvh; overflow:hidden; background:#000000; font-family:'Tajawal',sans-serif; color:#F2EFE6; }
        .mc-display { font-family:'Lalezar','Tajawal',sans-serif; letter-spacing:0.5px; margin:0; }
        .mc-sub { margin:2px 0 0; font-size:12px; color:#9FB3B0; }
        .mc-glass { background:rgba(18,46,49,0.55); backdrop-filter:blur(10px); border:1px solid rgba(232,163,61,0.18); }

        .mc-header { display:flex; align-items:center; justify-content:space-between; padding:16px 16px 4px; flex-shrink:0; }
        .mc-pill { display:flex; border-radius:9999px; padding:4px; flex-shrink:0; }
        .mc-pill button { padding:6px 14px; border-radius:9999px; border:none; font-size:12px; cursor:pointer; }

        .mc-stage { flex-shrink:0; min-height:30vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:12px 0; }
        .mc-avatar-wrap { position:relative; width:160px; height:160px; flex-shrink:0; }
        .mc-avatar-img { width:100%; height:100%; object-fit:cover; border-radius:50%; display:block; position:relative; z-index:2; border:3px solid rgba(125,224,211,0.35); background:#000; }
        .mc-avatar-ring { position:absolute; inset:-9px; border-radius:50%; z-index:1; border:3px solid transparent; }
        .mc-status { font-size:12px; display:flex; align-items:center; gap:5px; min-height:16px; }

        @keyframes mc-breathe { 0%,100% { box-shadow:0 0 0 0 rgba(125,224,211,0.25); } 50% { box-shadow:0 0 26px 6px rgba(125,224,211,0.35); } }
        @keyframes mc-listen-anim { 0% { box-shadow:0 0 0 0 rgba(232,163,61,0.55); } 100% { box-shadow:0 0 0 22px rgba(232,163,61,0); } }
        @keyframes mc-speak-anim { 0%,100% { transform:scale(1); } 50% { transform:scale(1.045); } }
        @keyframes mc-spin { to { transform:rotate(360deg); } }
        .mc-ring-idle { animation: mc-breathe 3.2s ease-in-out infinite; }
        .mc-ring-listen { animation: mc-listen-anim 1.3s ease-out infinite; }
        .mc-ring-speak { animation: mc-speak-anim 0.6s ease-in-out infinite; }
        .mc-ring-think { border-style:dashed; animation: mc-spin 2.2s linear infinite; }

        .mc-chatlog { flex:1; min-height:0; overflow-y:auto; padding:8px 16px; display:flex; flex-direction:column; gap:8px; }
        .mc-chatlog::-webkit-scrollbar { width:5px; }
        .mc-chatlog::-webkit-scrollbar-thumb { background:rgba(232,163,61,0.4); border-radius:10px; }
        .mc-row { display:flex; }
        .mc-row-user { justify-content:flex-end; }
        .mc-row-ai { justify-content:flex-start; }
        .mc-bubble { padding:9px 13px; border-radius:16px; font-size:14px; line-height:1.55; max-width:80%; }
        .mc-bubble-user { background:#E8A33D; color:#152325; }
        .mc-bubble-ai { background:rgba(125,224,211,0.10); color:#F2EFE6; border:1px solid rgba(125,224,211,0.22); }
        .mc-thinking { display:flex; align-items:center; gap:6px; }
        .mc-spin-icon { animation: mc-spin 1s linear infinite; }

        .mc-inputbar { display:flex; align-items:center; gap:8px; margin:0 12px 12px; padding:8px; border-radius:9999px; flex-shrink:0; }
        .mc-iconbtn { width:38px; height:38px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; border:none; cursor:pointer; position:relative; }
        .mc-input { flex:1; min-width:0; background:transparent; border:none; outline:none; font-size:14px; color:#F2EFE6; }
        .mc-input::placeholder { color:#9FB3B0; opacity:0.8; }

        @keyframes mc-mic-pulse { 0% { opacity:.55; transform:scale(1); } 100% { opacity:0; transform:scale(1.7); } }
        .mc-mic-pulse { position:absolute; inset:0; border-radius:50%; animation: mc-mic-pulse 1.6s ease-out infinite; }
      `}</style>

      <div className="mc-header">
        <div>
          <h1 className="mc-display" style={{ fontSize: 28, color: '#E8A33D', lineHeight: 1 }}>
            محمد
          </h1>
          <p className="mc-sub">{lang === 'ar' ? 'صاحبك الذكي' : 'Your AI companion'}</p>
        </div>
        <div className="mc-glass mc-pill">
          <button
            onClick={() => setLang('ar')}
            style={{ background: lang === 'ar' ? '#E8A33D' : 'transparent', color: lang === 'ar' ? '#152325' : '#9FB3B0' }}
          >
            عربي
          </button>
          <button
            onClick={() => setLang('en')}
            style={{ background: lang === 'en' ? '#E8A33D' : 'transparent', color: lang === 'en' ? '#152325' : '#9FB3B0' }}
          >
            EN
          </button>
        </div>
      </div>

      <div className="mc-stage">
        <div className="mc-avatar-wrap">
          <div className={`mc-avatar-ring ${ringClass}`} style={{ borderColor: ringColor }} />
          <img src="/avatar.png" alt="محمد" className="mc-avatar-img" />
        </div>
        <div className="mc-status" style={{ color: isListening || isThinking ? '#E8A33D' : '#7DE0D3' }}>
          {isSpeaking && <Volume2 size={14} />}
          {isListening
            ? lang === 'ar' ? '🎙️ بسمعك…' : '🎙️ listening…'
            : isThinking
            ? lang === 'ar' ? 'بفكر…' : 'thinking…'
            : isSpeaking
            ? lang === 'ar' ? 'يتحدث…' : 'speaking…'
            : conversationMode
            ? lang === 'ar' ? 'المحادثة الصوتية مفعّلة' : 'Voice conversation on'
            : ''}
        </div>
      </div>

      <div className="mc-chatlog">
        {messages.map((m, i) => (
          <div key={i} className={`mc-row ${m.role === 'user' ? 'mc-row-user' : 'mc-row-ai'}`}>
            <div className={`mc-bubble ${m.role === 'user' ? 'mc-bubble-user' : 'mc-bubble-ai'}`}>{m.text}</div>
          </div>
        ))}
        {isThinking && (
          <div className="mc-row mc-row-ai">
            <div className="mc-bubble mc-bubble-ai mc-thinking">
              <Loader2 size={14} className="mc-spin-icon" />
              {lang === 'ar' ? 'محمد يفكر…' : 'Mohammed is thinking…'}
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      <div className="mc-glass mc-inputbar">
        <button
          onClick={toggleConversationMode}
          className="mc-iconbtn"
          style={{ background: conversationMode ? '#E8A33D' : 'rgba(125,224,211,0.15)' }}
          aria-label="mic"
        >
          {(conversationMode || isListening) && <span className="mc-mic-pulse" style={{ background: '#E8A33D' }} />}
          <Mic size={16} style={{ color: conversationMode ? '#152325' : '#7DE0D3' }} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') sendMessage(input);
          }}
          placeholder={lang === 'ar' ? 'اكتب رسالتك لمحمد…' : 'Type a message to Mohammed…'}
          className="mc-input"
        />
        <button onClick={() => sendMessage(input)} className="mc-iconbtn" style={{ background: '#E8A33D' }}>
          <Send size={15} style={{ color: '#152325' }} />
        </button>
      </div>
    </div>
  );
}
