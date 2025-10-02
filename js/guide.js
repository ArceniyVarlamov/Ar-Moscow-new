const animateAttr = (el, name, value, dur = 320) => {
  if (!el) return;
  const key = `animation__${name}`;
  try { el.removeAttribute(key); } catch (_) {}
  el.setAttribute(key, `property: ${name}; to: ${value}; dur: ${dur}; easing: easeInOutSine`);
};

const estimateSpeechMs = (text) => {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  const clamped = Math.max(2000, Math.min(14000, words * 2000));
  return clamped;
};

export function createGuideController({ guideEl, subtitlesEl, disabled = false }) {
  if (disabled) {
    // Keep entity hidden and return no-op API to avoid breaking flows
    if (guideEl) {
      try { guideEl.setAttribute('visible', 'false'); } catch (_) {}
    }
    const noop = () => {};
    const resolved = Promise.resolve();
    return {
      setState: noop,
      dockToCorner: noop,
      showSubtitles: noop,
      clearSubtitles: noop,
      setCTA: noop,
      clearCTA: noop,
      speak: () => resolved,
    };
  }
  const setState = (state) => {
    if (!guideEl) return;
    if (state === 'hidden') {
      guideEl.setAttribute('visible', 'false');
      return;
    }
    guideEl.setAttribute('visible', 'true');
    if (state === 'talk') {
      animateAttr(guideEl, 'scale', '0.6 0.6 0.6');
      animateAttr(guideEl, 'position', '0 -0.05 -1.8');
    } else if (state === 'mini') {
      animateAttr(guideEl, 'scale', '0.3 0.3 0.3');
    }
  };

  const dockToCorner = (corner = 'tl') => {
    if (!guideEl) return;
    let pos = '-0.75 0.39 -1.8';
    if (corner === 'tr') pos = '0.85 0.32 -1.8';
    if (corner === 'bl') pos = '-0.85 -0.25 -1.8';
    if (corner === 'br') pos = '0.85 -0.25 -1.8';
    animateAttr(guideEl, 'position', pos, 360);
    animateAttr(guideEl, 'scale', '0.3 0.3 0.3', 360);
  };

  const showSubtitles = (text) => {
    if (!subtitlesEl) return;
    if (!text) {
      subtitlesEl.classList.add('hidden');
      subtitlesEl.textContent = '';
      return;
    }
    subtitlesEl.textContent = text;
    subtitlesEl.classList.remove('hidden');
  };

  const clearSubtitles = () => showSubtitles('');

  const setCTA = (text) => {
    if (!subtitlesEl) return;
    subtitlesEl.textContent = text || '';
    subtitlesEl.classList.remove('hidden');
    subtitlesEl.classList.add('subtitles--cta');
  };

  const clearCTA = () => {
    if (!subtitlesEl) return;
    subtitlesEl.classList.remove('subtitles--cta');
  };

  // --- Human voice over mp3 (replaces TTS when available) ---
  const AUDIO_BASE = './assets/music/';
  const audioCache = Object.create(null);
  let currentAudio = null;

  const norm = (s='') => s.toLowerCase()
    .replace(/[.!?,;:\-"'«»()]/g, ' ')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

  // Map phrase to short key (provided spec)
  const phraseToKey = (raw='') => {
    const t = norm(raw);
    const hasGoVerb = t.includes('пойдем') || t.includes('идем');

    if (t.includes('поможем') && t.includes('зайц')) return 'helphim';
    if (t.includes('получилась') && t.includes('фотк')) return 'goodphoto';
    if (hasGoVerb && t.includes('волк')) return 'gowolf';
    if (hasGoVerb && t.includes('ген')) return 'gogena';
    if (hasGoVerb && t.includes('чебураш')) return 'gochebur';
    if (t.includes('шепокляк') || t.includes('шепок') || t.includes('шапокляк')) return 'goshepok';
    if ((t.includes('не получилось') || t.includes('не съел') || t.includes('не съела')) && t.includes('сыр')) return 'eatcheese';
    if (t.includes('парк')) return 'park';
    return null;
  };

  const ensureAudio = (key) => {
    if (!key) return null;
    if (audioCache[key]) return audioCache[key];
    try {
      const pre = document.getElementById(`mouse_${key}Audio`);
      if (pre) {
        pre.preload = 'auto';
        pre.crossOrigin = 'anonymous';
        pre.volume = 1.0;
        audioCache[key] = pre;
        return pre;
      }
      const a = new Audio(`${AUDIO_BASE}mouse_${key}.mp3`);
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      a.volume = 1.0;
      audioCache[key] = a;
      return a;
    } catch(_) { return null; }
  };

  const stopCurrentAudio = () => {
    try { if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; } } catch(_) {}
    currentAudio = null;
  };

  const speak = (text, opts = {}) => {
    clearCTA();
    if (opts && opts.ctaNow) {
      setCTA(text || '');
    } else {
      showSubtitles(text || '');
    }
    setState('talk');

    return new Promise((resolve) => {
      let finished = false;
      const complete = () => {
        if (finished) return;
        finished = true;
        resolve();
      };

      // Prefer human voiceover mp3 if mapping exists; fallback to TTS
      const key = phraseToKey(text || '');
      const audio = ensureAudio(key);
      if (audio) {
        stopCurrentAudio();
        currentAudio = audio;
        const onEnd = () => { audio.removeEventListener('ended', onEnd); complete(); };
        audio.addEventListener('ended', onEnd, { once: true });
        audio.play().catch(() => {
          // Playback denied (autoplay), fallback to TTS or timeout
          try { audio.removeEventListener('ended', onEnd); } catch(_) {}
          try {
            if ('speechSynthesis' in window && text) {
              const u = new SpeechSynthesisUtterance(text);
              u.lang = 'ru-RU'; u.rate = 0.95; u.pitch = 1.0;
              u.onerror = () => complete();
              u.onend = () => complete();
              try { window.speechSynthesis.speak(u); } catch(_) { complete(); }
            } else {
              // Fallback: resolve after an estimated duration
              setTimeout(complete, estimateSpeechMs(text||''));
            }
          } catch(_) { complete(); }
        });
        return;
      }

      // No audio mapping found — original TTS or resolve quickly
      try {
        if ('speechSynthesis' in window && text) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'ru-RU';
          utterance.rate = 0.95;
          utterance.pitch = 1.0;
          utterance.onerror = () => complete();
          utterance.onend = () => complete();
          const attemptSpeak = () => { try { window.speechSynthesis.speak(utterance); } catch (_) { complete(); } };
          const voices = window.speechSynthesis.getVoices();
          if (!voices || voices.length === 0) {
            window.speechSynthesis.onvoiceschanged = () => { attemptSpeak(); };
            attemptSpeak();
          } else {
            attemptSpeak();
          }
        } else {
          setTimeout(complete, estimateSpeechMs(text||''));
        }
      } catch(_) { complete(); }
    }).then(() => {
      if (!opts || opts.dock !== false) dockToCorner('tl');
      if (opts && opts.cta) setCTA(opts.cta);
    });
  };

  return {
    setState,
    dockToCorner,
    showSubtitles,
    clearSubtitles,
    setCTA,
    clearCTA,
    speak,
  };
}
