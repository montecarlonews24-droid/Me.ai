import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Mic, Send, Volume2, Loader2 } from 'lucide-react';

export default function App() {
  const mountRef = useRef(null);
  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);

  const three = useRef({});
  const isSpeakingRef = useRef(false);
  const drag = useRef({ dragging: false, startX: 0, startY: 0, rotY: 0, rotX: 0, targetRotY: 0, targetRotX: 0 });

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

  // ---------- load available system/browser TTS voices ----------
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

  // ---------- THREE.JS SCENE SETUP ----------
  useEffect(() => {
    const mount = mountRef.current;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
    camera.position.set(0, 0.05, 5.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x9fd8d0, 0.55));
    const key = new THREE.DirectionalLight(0xffe3b0, 1.15);
    key.position.set(3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7de0d3, 0.9);
    rim.position.set(-4, -1.5, -3);
    scene.add(rim);

    const headGroup = new THREE.Group();
    scene.add(headGroup);

    const headGeo = new THREE.SphereGeometry(1.15, 48, 48);
    headGeo.scale(1, 1.06, 0.9);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x1c4a4f, roughness: 0.35, metalness: 0.55 });
    const head = new THREE.Mesh(headGeo, headMat);
    headGroup.add(head);

    const earMat = new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.3, metalness: 0.6 });
    const earGeo = new THREE.TorusGeometry(0.22, 0.05, 12, 24, Math.PI * 1.3);
    const earL = new THREE.Mesh(earGeo, earMat);
    earL.position.set(-1.12, 0, 0);
    earL.rotation.y = Math.PI / 2;
    const earR = earL.clone();
    earR.position.x = 1.12;
    headGroup.add(earL, earR);

    const eyeGeo = new THREE.SphereGeometry(0.13, 24, 24);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x7de0d3, emissive: 0x7de0d3, emissiveIntensity: 1.3, roughness: 0.2 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.37, 0.14, 0.97);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.37;
    headGroup.add(eyeL, eyeR);

    const mouthGeo = new THREE.BoxGeometry(0.42, 0.1, 0.1);
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0xe8a33d, emissive: 0xe8a33d, emissiveIntensity: 0.6, roughness: 0.4 });
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.position.set(0, -0.42, 1.0);
    headGroup.add(mouth);

    const haloGroup = new THREE.Group();
    const starMat = new THREE.MeshStandardMaterial({ color: 0xe8a33d, emissive: 0xe8a33d, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.3 });
    const starGeo = new THREE.OctahedronGeometry(0.08);
    const starCount = 10;
    for (let i = 0; i < starCount; i++) {
      const star = new THREE.Mesh(starGeo, starMat);
      const angle = (i / starCount) * Math.PI * 2;
      star.position.set(Math.cos(angle) * 1.9, Math.sin(angle) * 1.9, -0.6);
      haloGroup.add(star);
    }
    const ringGeo = new THREE.TorusGeometry(1.9, 0.008, 8, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x7de0d3, transparent: true, opacity: 0.3 });
    haloGroup.add(new THREE.Mesh(ringGeo, ringMat));
    scene.add(haloGroup);

    three.current = { scene, camera, renderer, headGroup, haloGroup, mouth, eyeL, eyeR, mount };

    let raf;
    let blinkTimer = 0;
    let nextBlinkAt = 2 + Math.random() * 3;
    const clock = new THREE.Clock();

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const dt = clock.getDelta();

      const idleY = Math.sin(t * 0.35) * 0.12;
      const idleBob = Math.sin(t * 1.1) * 0.035;
      headGroup.rotation.y = idleY + drag.current.targetRotY;
      headGroup.rotation.x = drag.current.targetRotX;
      headGroup.position.y = idleBob;

      haloGroup.rotation.z += dt * 0.15;

      blinkTimer += dt;
      if (blinkTimer > nextBlinkAt) {
        blinkTimer = 0;
        nextBlinkAt = 2.5 + Math.random() * 3.5;
      }
      const blinking = blinkTimer < 0.12;
      const eyeScale = blinking ? Math.max(0.1, 1 - blinkTimer / 0.06) : 1;
      eyeL.scale.y = eyeScale;
      eyeR.scale.y = eyeScale;

      if (isSpeakingRef.current) {
        const open = 1 + Math.abs(Math.sin(t * 16)) * 3.2;
        mouth.scale.y += (open - mouth.scale.y) * 0.4;
      } else {
        mouth.scale.y += (1 - mouth.scale.y) * 0.2;
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    const onPointerDown = (e) => {
      const p = e.touches ? e.touches[0] : e;
      drag.current.dragging = true;
      drag.current.startX = p.clientX;
      drag.current.startY = p.clientY;
      drag.current.rotY = drag.current.targetRotY;
      drag.current.rotX = drag.current.targetRotX;
    };
    const onPointerMove = (e) => {
      if (!drag.current.dragging) return;
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - drag.current.startX;
      const dy = p.clientY - drag.current.startY;
      drag.current.targetRotY = drag.current.rotY + dx * 0.006;
      drag.current.targetRotX = Math.max(-0.35, Math.min(0.35, drag.current.rotX + dy * 0.006));
    };
    const onPointerUp = () => {
      drag.current.dragging = false;
    };
    mount.addEventListener('mousedown', onPointerDown);
    mount.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleResize);
      mount.removeEventListener('mousedown', onPointerDown);
      mount.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      window.removeEventListener('touchend', onPointerUp);
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

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
            text: 'ملاحظة: جهازك ما فيه صوت عربي مثبّت، فرح تسمعني بلكنة إنجليزية. فيك تضيف صوت عربي من إعدادات النظام (Text-to-Speech).',
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
        // give the mic a beat to avoid picking up the tail end of Mohammed's own voice
        setTimeout(() => startListening(), 350);
      }
    };
    utter.onend = stop;
    utter.onerror = stop;
    window.speechSynthesis.speak(utter);
  };

  // ---------- calls OUR backend (/api/chat), never Anthropic directly ----------
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
    if (isSpeakingRef.current || isThinkingRef.current) return; // don't listen over himself or mid-reply

    recognitionRef.current.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
    recognitionRef.current.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      sendMessage(transcript);
    };
    recognitionRef.current.onend = () => {
      setIsListening(false);
      // no speech was captured (silence/timeout) — if we're still in conversation mode
      // and not busy, keep listening so the conversation doesn't just stop
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
      } catch (err) {
        /* already stopped */
      }
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

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="mc-root w-full h-screen flex flex-col overflow-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lalezar&family=Tajawal:wght@400;500;700;800&display=swap');
        .mc-root { background: radial-gradient(ellipse at 50% -10%, #1c4a4f 0%, #0d2427 45%, #081619 100%); font-family: 'Tajawal', sans-serif; color: #F2EFE6; }
        .mc-display { font-family: 'Lalezar', 'Tajawal', sans-serif; letter-spacing: 0.5px; }
        .mc-glass { background: rgba(18,46,49,0.55); backdrop-filter: blur(10px); border: 1px solid rgba(232,163,61,0.18); }
        .mc-bubble-user { background: #E8A33D; color: #152325; }
        .mc-bubble-ai { background: rgba(125,224,211,0.10); color: #F2EFE6; border: 1px solid rgba(125,224,211,0.22); }
        .mc-scroll::-webkit-scrollbar { width: 5px; }
        .mc-scroll::-webkit-scrollbar-thumb { background: rgba(232,163,61,0.4); border-radius: 10px; }
        .mc-canvas-wrap { touch-action: none; cursor: grab; }
        @keyframes mc-pulse { 0% { opacity: .55; transform: scale(1); } 100% { opacity: 0; transform: scale(1.7); } }
        .mc-pulse { animation: mc-pulse 1.6s ease-out infinite; }
        .mc-input::placeholder { color: #9FB3B0; opacity: 0.8; }
      `}</style>

      <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
        <div>
          <h1 className="mc-display text-3xl" style={{ color: '#E8A33D', lineHeight: 1 }}>
            محمد
          </h1>
          <p className="text-xs" style={{ color: '#9FB3B0' }}>
            {lang === 'ar' ? 'صاحبك الذكي' : 'Your AI companion'}
          </p>
        </div>
        <div className="flex rounded-full mc-glass p-1 text-xs">
          <button
            onClick={() => setLang('ar')}
            className="px-3 py-1 rounded-full transition-colors"
            style={{ background: lang === 'ar' ? '#E8A33D' : 'transparent', color: lang === 'ar' ? '#152325' : '#9FB3B0' }}
          >
            عربي
          </button>
          <button
            onClick={() => setLang('en')}
            className="px-3 py-1 rounded-full transition-colors"
            style={{ background: lang === 'en' ? '#E8A33D' : 'transparent', color: lang === 'en' ? '#152325' : '#9FB3B0' }}
          >
            EN
          </button>
        </div>
      </div>

      <div className="relative flex-shrink-0" style={{ height: '38vh' }}>
        <div ref={mountRef} className="mc-canvas-wrap w-full h-full" />
        {(isListening || isThinking || isSpeaking) && (
          <div
            className="absolute bottom-2 flex items-center gap-1 text-xs"
            style={{
              left: '50%',
              transform: 'translateX(-50%)',
              color: isListening ? '#E8A33D' : isThinking ? '#E8A33D' : '#7DE0D3',
            }}
          >
            {isSpeaking && <Volume2 size={14} />}
            {isListening
              ? lang === 'ar'
                ? '🎙️ بسمعك…'
                : '🎙️ listening…'
              : isThinking
              ? lang === 'ar'
                ? 'بفكر…'
                : 'thinking…'
              : lang === 'ar'
              ? 'يتحدث…'
              : 'speaking…'}
          </div>
        )}
        {conversationMode && !isListening && !isThinking && !isSpeaking && (
          <div
            className="absolute bottom-2 text-xs"
            style={{ left: '50%', transform: 'translateX(-50%)', color: '#9FB3B0' }}
          >
            {lang === 'ar' ? 'المحادثة الصوتية مفعّلة' : 'Voice conversation on'}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto mc-scroll px-4 py-2 space-y-2">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${m.role === 'user' ? 'mc-bubble-user' : 'mc-bubble-ai'}`}
              style={{ maxWidth: '80%' }}
            >
              {m.text}
            </div>
          </div>
        ))}
        {isThinking && (
          <div className="flex justify-start">
            <div className="mc-bubble-ai px-3 py-2 rounded-2xl text-sm flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              {lang === 'ar' ? 'محمد يفكر…' : 'Mohammed is thinking…'}
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      <div className="mc-glass mx-3 mb-3 rounded-full flex items-center gap-2 px-2 py-2 flex-shrink-0">
        <button
          onClick={toggleConversationMode}
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 relative"
          style={{ background: conversationMode ? '#E8A33D' : 'rgba(125,224,211,0.15)' }}
          aria-label={lang === 'ar' ? 'ابدأ/أوقف المحادثة الصوتية' : 'Start/stop voice conversation'}
        >
          {(conversationMode || isListening) && (
            <span className="absolute inset-0 rounded-full mc-pulse" style={{ background: '#E8A33D' }} />
          )}
          <Mic size={16} style={{ color: conversationMode ? '#152325' : '#7DE0D3' }} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') sendMessage(input);
          }}
          placeholder={lang === 'ar' ? 'اكتب رسالتك لمحمد…' : 'Type a message to Mohammed…'}
          className="mc-input flex-1 bg-transparent outline-none text-sm"
          style={{ color: '#F2EFE6' }}
        />
        <button
          onClick={() => sendMessage(input)}
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: '#E8A33D' }}
        >
          <Send size={15} style={{ color: '#152325' }} />
        </button>
      </div>
    </div>
  );
}
