const animateAttr = (el, name, value, dur = 320) => {
  if (!el) return;
  const key = `animation__${name}`;
  try { el.removeAttribute(key); } catch (_) {}
  el.setAttribute(key, `property: ${name}; to: ${value}; dur: ${dur}; easing: easeInOutSine`);
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const vecToString = (values) => values.map((v) => Number(v.toFixed(4))).join(' ');

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
      refreshLayout: noop,
    };
  }

  const baseDistance = 1.8;
  let currentState = 'hidden';
  let currentCorner = 'tl';

  const computeLayout = () => {
    const widthPx = Math.max(320, window.innerWidth || window.outerWidth || 1280);
    const heightPx = Math.max(320, window.innerHeight || window.outerHeight || 720);
    const scene = guideEl?.sceneEl || null;
    const camera = scene?.camera || null;
    const fovDeg = (camera && typeof camera.fov === 'number') ? camera.fov : 75;
    const aspect = (camera && typeof camera.aspect === 'number' && camera.aspect > 0)
      ? camera.aspect
      : (widthPx / Math.max(1, heightPx));
    const distance = Math.max(0.1, Math.abs(baseDistance));
    const fovRad = (fovDeg * Math.PI) / 180;
    const rawVisibleHeight = 2 * distance * Math.tan(fovRad / 2);
    const visibleHeight = (Number.isFinite(rawVisibleHeight) && rawVisibleHeight > 0) ? rawVisibleHeight : 2.4;
    const rawVisibleWidth = visibleHeight * aspect;
    const visibleWidth = (Number.isFinite(rawVisibleWidth) && rawVisibleWidth > 0) ? rawVisibleWidth : visibleHeight * 1.6;

    const minDimPx = Math.max(320, Math.min(widthPx, heightPx));
    const sizeRatio = clamp(minDimPx / 540, 0.5, 1.0);
    const talkScaleVal = 0.6 * sizeRatio;
    const miniScaleVal = Math.max(0.18, talkScaleVal * 0.5);

    const halfW = visibleWidth / 2;
    const halfH = visibleHeight / 2;
    const marginX = visibleWidth * 0.12;
    const marginTop = visibleHeight * 0.18;
    const marginBottom = visibleHeight * 0.14;

    const xOffset = clamp(halfW - marginX, visibleWidth * 0.12, halfW - visibleWidth * 0.04);
    const yOffsetTop = clamp(halfH - marginTop, visibleHeight * 0.12, halfH - visibleHeight * 0.05);
    const yOffsetBottom = clamp(halfH - marginBottom, visibleHeight * 0.10, halfH - visibleHeight * 0.04);

    const talkPosition = vecToString([0, -0.05, -distance]);
    const talkScale = vecToString([talkScaleVal, talkScaleVal, talkScaleVal]);
    const miniPosition = talkPosition;
    const miniScale = vecToString([miniScaleVal, miniScaleVal, miniScaleVal]);
    const cornerScale = miniScale;

    return {
      states: {
        talk: { position: talkPosition, scale: talkScale },
        mini: { position: miniPosition, scale: miniScale },
      },
      corners: {
        tl: { position: vecToString([-xOffset, yOffsetTop, -distance]), scale: cornerScale },
        tr: { position: vecToString([xOffset, yOffsetTop, -distance]), scale: cornerScale },
        bl: { position: vecToString([-xOffset, -yOffsetBottom, -distance]), scale: cornerScale },
        br: { position: vecToString([xOffset, -yOffsetBottom, -distance]), scale: cornerScale },
      },
    };
  };

  const applyLayout = (opts = {}) => {
    if (!guideEl || currentState === 'hidden') return;
    const layout = computeLayout();
    const duration = typeof opts.duration === 'number' ? opts.duration : 320;
    const immediate = opts.immediate === true || duration === 0;
    const apply = (name, value) => {
      if (immediate) {
        try { guideEl.setAttribute(name, value); } catch (_) {}
      } else {
        animateAttr(guideEl, name, value, duration);
      }
    };

    if (currentState === 'talk') {
      apply('scale', layout.states.talk.scale);
      apply('position', layout.states.talk.position);
    } else if (currentState === 'mini') {
      apply('scale', layout.states.mini.scale);
      apply('position', layout.states.mini.position);
    } else if (currentState === 'corner') {
      const cornerKey = layout.corners[currentCorner] ? currentCorner : 'tl';
      const cfg = layout.corners[cornerKey];
      apply('position', cfg.position);
      apply('scale', cfg.scale);
    }
  };

  const setState = (state) => {
    if (!guideEl) return;
    if (state === 'hidden') {
      guideEl.setAttribute('visible', 'false');
      currentState = 'hidden';
      currentCorner = 'tl';
      return;
    }
    guideEl.setAttribute('visible', 'true');
    const normalized = state === 'mini' ? 'mini' : 'talk';
    currentState = normalized;
    currentCorner = 'tl';
    applyLayout();
  };

  const dockToCorner = (corner = 'tl') => {
    if (!guideEl) return;
    guideEl.setAttribute('visible', 'true');
    const key = (corner || 'tl').toString().toLowerCase();
    if (key === 'tr' || key === 'bl' || key === 'br') {
      currentCorner = key;
    } else {
      currentCorner = 'tl';
    }
    currentState = 'corner';
    applyLayout({ duration: 360 });
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

  const refreshLayout = (opts = {}) => {
    if (!guideEl) return;
    applyLayout({
      immediate: opts.immediate === true,
      duration: typeof opts.duration === 'number' ? opts.duration : (opts.immediate ? 0 : 240),
    });
  };

  // Human voiceover via mp3 (preferred). TTS removed per request.
  const AUDIO_BASE = './assets/music/';
  const audioCache = Object.create(null);
  let currentAudio = null;

  const norm = (s='') => s.toLowerCase()
    .replace(/[.!?,;:\-\"'«»()]/g, ' ')
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

      // Prefer human voiceover mp3 if mapping exists; no TTS fallback
      const key = phraseToKey(text || '');
      const audio = ensureAudio(key);
      if (audio) {
        stopCurrentAudio();
        currentAudio = audio;
        const onEnd = () => { try { audio.removeEventListener('ended', onEnd); } catch(_) {}; complete(); };
        audio.addEventListener('ended', onEnd, { once: true });
        audio.play().catch((error) => {
          console.warn('[Guide] voice playback blocked', { key, error });
          try { audio.removeEventListener('ended', onEnd); } catch(_) {}
          setTimeout(complete, estimateSpeechMs(text||''));
        });
        return;
      }

      // No mapping — resolve after estimated duration
      setTimeout(complete, estimateSpeechMs(text || ''));
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
    refreshLayout,
  };
}
