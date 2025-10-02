const WOLF_MIND = './assets/targets/wolf.mind';

const CAMERA_PERMISSION_CONSTRAINTS = {
  audio: false,
  video: { facingMode: { ideal: 'environment' } },
};

export function createARController({
  sceneEl,
  anchors = [],
  arWrapper,
  ui,
  guide,
  quest,
  state,
  simpleWolfOnly = false,
  applySceneConfig = () => {},
  assetPreloader = null,
}) {
  if (!sceneEl) throw new Error('AR scene element is required');

  const urlParams = new URLSearchParams(location.search);
  const DEBUG_AR = urlParams.has('debug') || ['1','true','yes','on'].includes((urlParams.get('debug')||'').toLowerCase());
  const dlog = (...args) => { if (DEBUG_AR) console.log('[AR][DEBUG]', ...args); };

  const ensureAssetsForHero = (heroKey) => {
    if (!assetPreloader) return Promise.resolve();
    try {
      return assetPreloader.ensureForHero(heroKey);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const ensureAssetsForStep = (step) => {
    if (!assetPreloader) return Promise.resolve();
    const targetStep = step || 'intro';
    try {
      return assetPreloader.ensureForStep(targetStep);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  let sceneReady = sceneEl.hasLoaded ?? false;
  let storedSceneConfig = null;

  const sceneReadyWaiters = [];
  const resolveSceneReadyWaiters = () => {
    while (sceneReadyWaiters.length > 0) {
      const resolve = sceneReadyWaiters.shift();
      try { resolve(); } catch (_) {}
    }
  };

  const waitForSceneReady = () => {
    if (sceneReady) return Promise.resolve();
    return new Promise((resolve) => {
      sceneReadyWaiters.push(resolve);
    });
  };

  let selfieVideo = null;
  let selfieStream = null;
  let selfieMode = false;
  let cameraAccessGranted = false;
  // Trio (мультитаргеты) активен после фото с Шапокляк
  let trioModeActive = false;
  // No timeout-based warmups; rely on events

  // Audio for Gena step
  let genaAudio = null;
  const ensureGenaAudio = () => {
    if (genaAudio) return genaAudio;
    try {
      const el = document.getElementById('genaAudio');
      if (el) {
        el.loop = true;
        el.crossOrigin = 'anonymous';
        el.volume = 0.85;
        el.load?.();
        genaAudio = el;
      } else {
        const a = new Audio('./assets/music/gena.mp3');
        a.loop = true;
        a.preload = 'auto';
        a.crossOrigin = 'anonymous';
        a.volume = 0.85;
        a.load?.();
        genaAudio = a;
      }
    } catch (_) {}
    return genaAudio;
  };
  const playGenaAudio = async () => {
    try {
      const a = ensureGenaAudio();
      if (!a) return;
      if (a.paused) await a.play();
    } catch (e) {
      console.warn('[AR][AUDIO] play failed (likely autoplay policy). Will require user gesture.', e);
    }
  };
  const stopGenaAudio = () => { try { genaAudio && (genaAudio.pause(), genaAudio.currentTime = 0); } catch (_) {} };

  // Shapoklyak voice: says "Нельзя" when mouse reaches cheese
  let shapAudio = null;
  const ensureShapAudio = () => {
    if (shapAudio) return shapAudio;
    try {
      const el = document.getElementById('lariskaAudio');
      if (el) {
        el.crossOrigin = 'anonymous';
        el.volume = 1.0;
        el.load?.();
        shapAudio = el;
      } else {
        const a = new Audio('./assets/music/lariska.mp3');
        a.preload = 'auto';
        a.crossOrigin = 'anonymous';
        a.volume = 1.0;
        shapAudio = a;
      }
    } catch (_) {}
    return shapAudio;
  };
  const playShapAudio = async () => {
    try {
      const a = ensureShapAudio();
      if (!a) return;
      // restart from start each time
      try { a.pause(); a.currentTime = 0; } catch (_) {}
      await a.play();
    } catch (e) {
      console.warn('[AR][AUDIO] shap voice play failed (needs gesture?)', e);
    }
  };
  const stopShapAudio = () => { try { shapAudio && (shapAudio.pause(), shapAudio.currentTime = 0); } catch (_) {} };

  // Wolf big-jump audios (wolf_2 -> wolf_3)
  let wolf2Audio = null;
  let wolf3Audio = null;
  let wolfBigJumpActive = false;
  const ensureWolfAudios = () => {
    try {
      if (!wolf2Audio) {
        wolf2Audio = document.getElementById('wolf2Audio') || new Audio('./assets/music/wolf_2.mp3');
        wolf2Audio.preload = 'auto';
        wolf2Audio.crossOrigin = 'anonymous';
      }
      if (!wolf3Audio) {
        wolf3Audio = document.getElementById('wolf3Audio') || new Audio('./assets/music/wolf_3.mp3');
        wolf3Audio.preload = 'auto';
        wolf3Audio.crossOrigin = 'anonymous';
      }
    } catch (_) {}
  };
  const playWolfBigJumpAudio = async () => {
    ensureWolfAudios();
    // Reset positions
    try { if (wolf2Audio) { wolf2Audio.pause(); wolf2Audio.currentTime = 0; } } catch(_) {}
    try { if (wolf3Audio) { wolf3Audio.pause(); wolf3Audio.currentTime = 0; } } catch(_) {}
    return new Promise((resolve) => {
      try {
        if (!wolf2Audio) return resolve(false);
        // Chain: wolf_2 finishes -> play wolf_3 -> resolve after wolf_3 finishes
        wolf2Audio.onended = () => {
          try {
            if (wolf3Audio) {
              wolf3Audio.onended = () => resolve(true);
              wolf3Audio.play().catch(() => resolve(true)); // resolve when playback attempt done
            } else {
              resolve(true);
            }
          } catch(_) { resolve(true); }
        };
        wolf2Audio.play().catch(() => {
          // If wolf_2 fails, try wolf_3 directly
          try {
            if (wolf3Audio) {
              wolf3Audio.onended = () => resolve(true);
              wolf3Audio.play().catch(() => resolve(false));
            } else {
              resolve(false);
            }
          } catch(_) { resolve(false); }
        });
      } catch(_) { resolve(false); }
    });
  };

  const ensureCameraAccess = async () => {
    if (cameraAccessGranted) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia is not supported');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(CAMERA_PERMISSION_CONSTRAINTS);
      cameraAccessGranted = true;
      return true;
    } finally {
      try {
        stream?.getTracks()?.forEach((track) => track.stop());
      } catch (_) {}
    }
  };

  // Force a fresh camera permission request on next ensure call
  const reRequestCameraPermission = async () => {
    try { cameraAccessGranted = false; } catch (_) {}
    try { return await ensureCameraAccess(); } catch (e) { throw e; }
  };

  // One-logo chase: logo hops at side A (near hare), then travels in an arc to side B (reveals hare), hops, and returns. Loops.
  const addLogoChaseToRoot = (root, spec) => {
    if (!root) return;
    try { dlog('CHASE: build start', spec); } catch(_) {}
    const xR = spec.rightX ?? 0.5;
    const xL = spec.leftX ?? -0.5;
    const z = spec.baseZ ?? -0.12;
    const baseY = spec.baseY ?? -0.06; // ниже плоскости
    const hop = spec.hop ?? 0.07;
    const hopDurMin = spec.hopDurMin ?? 900;
    const hopDurMax = spec.hopDurMax ?? 1400;
    const travelDur = spec.travelDur ?? 1100;
    const holdR = spec.holdRight ?? 2300;
    const holdL = spec.holdLeft ?? 2300;
    const arcY = spec.arcY ?? 0.6;
    const fitLogo = spec.fitLogo ?? 0.30;
    const rot = spec.rotation || '0 -90 0';

    // Holder controls horizontal travel and timers
    const holder = document.createElement('a-entity');
    holder.id = 'logo-chase-holder';
    const xMid = spec.midX ?? 0.0;
    holder.setAttribute('position', `${xMid} 0 ${z}`);
    holder.dataset.chaseStarted = '0';
    root.appendChild(holder);

    // Arc child for vertical arc during travel
    const arc = document.createElement('a-entity');
    arc.id = 'logo-arc';
    arc.setAttribute('position', '0 0 0');
    holder.appendChild(arc);

    // Logo entity
    const logo = document.createElement('a-entity');
    logo.id = 'logo-chase';
    safeSetGltfModel(logo, '#souzmultiparkModel');
    logo.setAttribute('rotation', rot);
    logo.setAttribute('position', `0 ${baseY} 0`);
    logo.setAttribute('visible', 'true');
    try { logo.setAttribute('force-opaque', 'mode: opaque; doubleSide: true; renderOrder: 3'); } catch(_) {}
    arc.appendChild(logo);

    try { dlog('CHASE: nodes created', { holderPos: holder.getAttribute('position'), arcPos: arc.getAttribute('position'), logoPos: logo.getAttribute('position') }); } catch(_) {}

    // Fit logo once loaded
    const fitOnce = () => { try { const obj = logo.getObject3D('mesh'); if (!obj) return; const box = new AFRAME.THREE.Box3().setFromObject(obj); const size = new AFRAME.THREE.Vector3(); box.getSize(size); const k = (fitLogo||0.3)/(Math.max(size.x,size.y,size.z)||1); if (isFinite(k)&&k>0&&k<1000) obj.scale.multiplyScalar(k); obj.traverse(n=>{ if (n.isMesh) n.renderOrder = 3; }); } catch(_){} };
    if (logo.getObject3D('mesh')) fitOnce(); else logo.addEventListener('model-loaded', fitOnce, { once: true });

    // Static hare at right side, strictly behind the logo (further from camera)
    // Default X matches right logo position so the logo covers the hare when on the right.
    // Z is a bit more negative (further) to be hidden behind the logo.
    const hareX = spec.hareX ?? xR;
    const hareZ = spec.hareZ ?? (z - 0.16);
    const hareY = spec.hareY ?? baseY;
    const hareFit = spec.hareFit ?? 0.17;
    const hare = document.createElement('a-entity');
    hare.id = 'hare-static';
    safeSetGltfModel(hare, spec.hareModel || '#rabbitModel');
    hare.setAttribute('position', `${hareX} ${hareY} ${hareZ}`);
    hare.setAttribute('rotation', spec.hareRot || '0 -90 0');
    hare.setAttribute('visible', 'true');
    root.appendChild(hare);
    const fitHare = () => { try { const obj = hare.getObject3D('mesh'); if (!obj) return; const box = new AFRAME.THREE.Box3().setFromObject(obj); const size = new AFRAME.THREE.Vector3(); box.getSize(size); const k = (hareFit||0.17)/(Math.max(size.x,size.y,size.z)||1); if (isFinite(k)&&k>0&&k<1000) obj.scale.multiplyScalar(k);} catch(_){} };
    if (hare.getObject3D('mesh')) fitHare(); else hare.addEventListener('model-loaded', fitHare, { once: true });

    try { dlog('CHASE: hare placed', { harePos: hare.getAttribute('position'), hareRot: hare.getAttribute('rotation') }); } catch(_) {}

    // Install animations after entities are ready (robust to load order)
    const installAnimations = () => {
      try {
        const hopSmall = hop * 1.5; // повысили в 1.5 раза
        const hopBig = spec.hopBig ?? (hop * 5.0); // повысили в 5 раз
        const bigUpDur = spec.bigUpDur ?? Math.max(450, Math.floor(travelDur * 0.6));
        const bigDownDur = spec.bigDownDur ?? Math.max(1100, Math.floor(travelDur * 1.8));

        // Base stubs (we will override from/to dynamically before each emit for smooth continuity)
        logo.setAttribute('animation__hopSmall', `property: position; dir: alternate; loop: 1; dur: ${Math.floor((hopDurMin+hopDurMax)/2)}; easing: easeInOutSine; startEvents: small-hop`);
        logo.setAttribute('animation__bigUp', `property: position; dur: ${bigUpDur}; easing: easeOutCubic; startEvents: big-up`);
        logo.setAttribute('animation__bigDown', `property: position; dur: ${bigDownDur}; easing: easeInCubic; startEvents: big-down`);

        // One-time intro: fall from sky onto wolf head (higher landing), then settle to ground, then shift holder from center to hare
        const introStart = baseY + 3 * (spec.introDrop || 1.5);
        const introLandingY = (typeof spec.introLandingY === 'number') ? spec.introLandingY : (baseY + ((spec.headOffsetY || 0.22) * 4));
        logo.setAttribute('animation__introDrop', `property: position; from: 0 ${introStart} 0; to: 0 ${introLandingY} 0; dur: ${spec.introDropDur || 1600}; easing: easeInCubic; startEvents: chase-intro-drop`);
        // slight bounce on head before moving on
        const headBounceH = Math.max(0.015, hop * 0.8);
        logo.setAttribute('animation__introHead', `property: position; from: 0 ${introLandingY} 0; to: 0 ${introLandingY + headBounceH} 0; dir: alternate; loop: 1; dur: ${spec.introHeadDur || 240}; easing: easeOutCubic; startEvents: chase-intro-head`);
        // settle from head to ground (a bit slower by default)
        logo.setAttribute('animation__introGround', `property: position; from: 0 ${introLandingY} 0; to: 0 ${baseY} 0; dur: ${spec.introGroundDur || 900}; easing: easeOutCubic; startEvents: chase-intro-ground`);
        // shift holder from center to hare
        holder.setAttribute('animation__introShift', `property: position; from: ${xMid} 0 ${z}; to: ${xR} 0 ${z}; dur: ${spec.introShiftDur || 700}; easing: ${spec.introShiftEasing || 'easeOutCubic'}; startEvents: chase-intro-shift`);

        dlog('CHASE: animations installed (3 hops + big jump + intro)');
      } catch (e) { console.warn('[AR][CHASE] installAnimations error', e); }
    };
    // Ensure entities are loaded
    const readyOr = (el, fn) => {
      if (!el) return;
      if (el.hasLoaded) { fn(); return; }
      const once = () => { el.removeEventListener('loaded', once); try { fn(); } catch(_) {} };
      el.addEventListener('loaded', once);
    };
    // Install after both holder and logo are ready
    readyOr(holder, () => readyOr(logo, installAnimations));

    // New loop: 2 small hops, then big up + long down, loop
    let smallCount = 0;
    const currentY = () => {
      try { return (logo.object3D?.position?.y ?? baseY); } catch(_) { return baseY; }
    };
    const startSmall = () => {
      try {
        const y = currentY();
        const hopSmall = hop * 1.5;
        const hopDur = Math.floor(Math.random()*(hopDurMax-hopDurMin)+hopDurMin);
        logo.setAttribute('animation__hopSmall', `property: position; from: 0 ${y} 0; to: 0 ${y + hopSmall} 0; dir: alternate; loop: 1; dur: ${hopDur}; easing: easeInOutSine; startEvents: small-hop`);
        logo.emit('small-hop');
      } catch(_) {}
    };
    const startBigUp = () => {
      try {
        const y = currentY();
        const hopBigBase = (spec.hopBig ?? (hop * 5.0));
        const hopBig = hopBigBase * 1.5; // ещё выше в 1.5 раза
        const bigUpDur = spec.bigUpDur ?? Math.max(450, Math.floor(travelDur * 0.6));
        logo.setAttribute('animation__bigUp', `property: position; from: 0 ${y} 0; to: 0 ${y + hopBig} 0; dur: ${bigUpDur}; easing: easeOutCubic; startEvents: big-up`);
        logo.emit('big-up');
      } catch(_) {}
    };
    const startBigDown = () => {
      try {
        const y = currentY();
        const bigDownDur = spec.bigDownDur ?? Math.max(1100, Math.floor(travelDur * 1.8));
        logo.setAttribute('animation__bigDown', `property: position; from: 0 ${y} 0; to: 0 ${baseY} 0; dur: ${bigDownDur}; easing: easeInCubic; startEvents: big-down`);
        logo.emit('big-down');
      } catch(_) {}
    };
    const bindAnimEnd = (el, name, fn) => {
      if (!el) return;
      el.addEventListener(`animationcomplete__${name}`, fn);
      el.addEventListener('animationcomplete', (e)=>{ if (e?.detail?.name === `animation__${name}`) fn(); });
    };
    // Bind completions
    const onSmallDone = () => {
      smallCount++;
      if (smallCount < 2) startSmall(); else { smallCount = 0; startBigUp(); }
    };
    const onBigUpDone = () => { startBigDown(); };
    const onBigDownDone = () => { startSmall(); };
    bindAnimEnd(logo, 'hopSmall', onSmallDone);
    bindAnimEnd(logo, 'bigUp', onBigUpDone);
    bindAnimEnd(logo, 'bigDown', onBigDownDone);

    // Intro: drop on head → small head-bounce → settle down to ground → shift to hare → start cycle
    const onIntroDropDone = () => {
      try {
        const hold = 160; // short hold on head before bounce
        setTimeout(() => { try { logo.emit('chase-intro-head'); } catch(_) {} }, hold);
      } catch(_) { try { logo.emit('chase-intro-head'); } catch(_) {} }
    };
    // After head-bounce, fall to ground (center), then shift to hare, then start cycle
    const onIntroHeadDone = () => { try { logo.emit('chase-intro-ground'); } catch(_) {} };
    const onIntroGroundDone = () => { try { holder.emit('chase-intro-shift'); } catch(_) {} };
    const onIntroShiftDone = () => { smallCount = 0; setTimeout(startSmall, 120); };
    bindAnimEnd(logo, 'introDrop', onIntroDropDone);
    bindAnimEnd(logo, 'introHead', onIntroHeadDone);
    bindAnimEnd(logo, 'introGround', onIntroGroundDone);
    bindAnimEnd(holder, 'introShift', onIntroShiftDone);

    // Also set big-jump active flag regardless of debug
    try {
      logo.addEventListener('animationstart__bigUp', ()=>{ wolfBigJumpActive = true; });
      logo.addEventListener('animationcomplete__bigDown', ()=>{ wolfBigJumpActive = false; });
    } catch(_) {}

    // Track big-jump active flag
    try {
      logo.addEventListener('animationstart__bigUp', ()=>{ wolfBigJumpActive = true; });
      logo.addEventListener('animationcomplete__bigDown', ()=>{ wolfBigJumpActive = false; });
    } catch(_) {}

    // Optional debug traces
    try {
      const urlParams = new URLSearchParams(location.search);
      const DEBUG_AR = urlParams.has('debug') || ['1','true','yes','on'].includes((urlParams.get('debug')||'').toLowerCase());
      if (DEBUG_AR) {
        logo.addEventListener('animationstart__hopSmall', ()=>console.log('[AR][CHASE] hopSmall start'));
        logo.addEventListener('animationcomplete__hopSmall', ()=>console.log('[AR][CHASE] hopSmall complete'));
        logo.addEventListener('animationstart__bigUp', ()=>{ wolfBigJumpActive = true; console.log('[AR][CHASE] bigUp start'); });
        logo.addEventListener('animationcomplete__bigUp', ()=>console.log('[AR][CHASE] bigUp complete'));
        logo.addEventListener('animationstart__bigDown', ()=>console.log('[AR][CHASE] bigDown start'));
        logo.addEventListener('animationcomplete__bigDown', ()=>{ wolfBigJumpActive = false; console.log('[AR][CHASE] bigDown complete'); });
        logo.addEventListener('animationstart__introDrop', ()=>console.log('[AR][CHASE] introDrop start'));
        logo.addEventListener('animationcomplete__introDrop', ()=>console.log('[AR][CHASE] introDrop complete'));
        logo.addEventListener('animationstart__introBounce', ()=>console.log('[AR][CHASE] introBounce start'));
        logo.addEventListener('animationcomplete__introBounce', ()=>console.log('[AR][CHASE] introBounce complete'));
      }
    } catch(_) {}

    // Expose quick diagnostic helpers in debug mode
    try {
      if (DEBUG_AR) {
        window.AR_DIAG = Object.assign({}, window.AR_DIAG, {
          holder, arc, logo, hare,
          startSmall: ()=> { try { logo.emit('small-hop'); } catch(e) { console.warn('AR_DIAG startSmall error', e); }},
          startBig: ()=> { try { logo.emit('big-up'); } catch(e) { console.warn('AR_DIAG startBig error', e); }},
          startIntro: ()=> { try { logo.emit('chase-intro-drop'); } catch(e) { console.warn('AR_DIAG startIntro error', e); }},
          state: ()=> ({
            chaseStarted: holder.dataset.chaseStarted,
            hopSmall: logo.getAttribute('animation__hopSmall'),
            bigUp: logo.getAttribute('animation__bigUp'),
            bigDown: logo.getAttribute('animation__bigDown'),
            introDrop: logo.getAttribute('animation__introDrop'),
            introBounce: logo.getAttribute('animation__introBounce'),
            bigJumpActive: wolfBigJumpActive,
          }),
        });
        dlog('CHASE: AR_DIAG ready. Try AR_DIAG.state(), AR_DIAG.startSmall(), AR_DIAG.startBig(), AR_DIAG.startIntro()');
      }
    } catch(_) {}
  };
  const setSceneConfig = (cfg) => {
    storedSceneConfig = cfg;
    if (sceneReady) {
      try { applySceneConfig(cfg); } catch (error) { console.warn('[AR] apply scene config failed', error); }
    }
  };

  const tryApplySceneConfig = () => {
    if (sceneReady && storedSceneConfig) {
      try { applySceneConfig(storedSceneConfig); } catch (error) { console.warn('[AR] apply scene config failed', error); }
    }
  };

  const markSceneReady = () => {
    if (sceneReady) return;
    sceneReady = true;
    tryApplySceneConfig();
    resolveSceneReadyWaiters();
  };

  if (!sceneReady) {
    const onSceneLoaded = () => {
      sceneEl.removeEventListener('loaded', onSceneLoaded);
      markSceneReady();
    };
    sceneEl.addEventListener('loaded', onSceneLoaded, { once: true });

    const onRenderStart = () => {
      sceneEl.removeEventListener('renderstart', onRenderStart);
      markSceneReady();
    };
    sceneEl.addEventListener('renderstart', onRenderStart, { once: true });

    let readyPoll = null;
    const stopPoll = () => { if (readyPoll) { clearInterval(readyPoll); readyPoll = null; } };
    readyPoll = setInterval(() => {
      if (sceneReady) { stopPoll(); return; }
      if (sceneEl.hasLoaded) {
        stopPoll();
        markSceneReady();
      }
    }, 180);
    window.addEventListener('beforeunload', stopPoll, { once: true });
  } else {
    markSceneReady();
  }

  const bindVideoHandlers = () => {
    const sys = sceneEl.systems['mindar-image-system'];
    const video = sys?.video;
    const canvas = sceneEl.renderer?.domElement || arWrapper?.querySelector('canvas');

    const ensureVideoUsable = () => {
      if (!video) return;
      try { video.setAttribute('playsinline', ''); } catch (_) {}
      try { video.setAttribute('webkit-playsinline', 'true'); } catch (_) {}
      try { video.setAttribute('muted', ''); } catch (_) {}
      try { video.setAttribute('autoplay', ''); } catch (_) {}
      try { video.setAttribute('preload', 'auto'); } catch (_) {}
      try { video.removeAttribute('controls'); } catch (_) {}
      video.playsInline = true;
      video.muted = true;
      video.autoplay = true;
    };

    const playVideoIfNeeded = () => {
      if (!video) return;
      try {
        const maybePromise = video.play?.();
        if (maybePromise && typeof maybePromise.catch === 'function') {
          maybePromise.catch(() => {});
        }
      } catch (_) {}
    };

    const applySurfaces = () => {
      if (video) {
        ensureVideoUsable();
        video.style.zIndex = '1';
        video.style.opacity = '1';
        video.style.visibility = 'visible';
        video.style.objectFit = 'cover';
        dlog('video dims', video.videoWidth, video.videoHeight);
      }
      // Align WebGL canvas internal buffer to camera video aspect.
      // Let CSS stretch it to wrapper size; MindAR computes projection from video size.
      if (sceneEl.renderer && video && (video.videoWidth || 0) > 0 && (video.videoHeight || 0) > 0) {
        sceneEl.renderer.setSize(video.videoWidth, video.videoHeight, false);
      }
      tweakCameraClipping();
      playVideoIfNeeded();
    };

    // Canvas styling can be applied immediately
    if (canvas) {
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.zIndex = '2';
      canvas.style.background = 'transparent';
      canvas.style.pointerEvents = 'none';
    }

    if (video) {
      ensureVideoUsable();
      if ((video.videoWidth || 0) > 0 && (video.videoHeight || 0) > 0) {
        applySurfaces();
      } else {
        video.addEventListener('loadedmetadata', applySurfaces, { once: true });
        video.addEventListener('loadeddata', playVideoIfNeeded, { once: true });
      }
      playVideoIfNeeded();
    }
  };

  sceneEl.addEventListener('arReady', () => {
    console.log('[AR] Ready event');
    ui.setTrackingState('lost');
    tryApplySceneConfig();
    if (state.mode === 'quest') {
      // В режиме трио не показываем подсказки по конкретному герою
      if (trioModeActive) {
        try { guide.setState('hidden'); } catch(_) {}
        try { guide.showSubtitles('Сфоткайся вместе со всеми!'); } catch(_) {}
      } else {
      const st = (quest.getStep && quest.getStep()) || 'intro';
      try {
        if (st === 'gena') { guide.dockToCorner('tl'); guide.showSubtitles('Наведи камеру на Гену!'); }
        else if (st === 'cheburashka') { guide.dockToCorner('tl'); guide.showSubtitles('Наведи камеру на Чебурашку!'); }
        else if (st === 'cheburashkastand') { guide.dockToCorner('tl'); guide.showSubtitles('Наведись на чебурашек! Получи приз!'); }
        else if (st === 'shapoklyak') { guide.setState('hidden'); guide.showSubtitles('Наведи камеру на Шапокляк!'); }
        else { guide.setState('talk'); guide.showSubtitles('Наведи камеру на волка!'); }
      } catch(_) {}
      }
    }
    bindVideoHandlers();
  });

  sceneEl.addEventListener('arError', (event) => {
    console.error('[AR] Error event', event?.detail || event);
    ui.exitARMode();
    ui.showUnsupported();
  });

  anchors.forEach((anchor) => {
    anchor.addEventListener('targetFound', () => handleTargetFound(anchor));
    anchor.addEventListener('targetLost', () => handleTargetLost(anchor));
  });

  // No explicit waiting on metadata; we attach handlers and proceed

  const start = async () => {
    if (!sceneReady) {
      console.warn('[AR] Scene is not ready yet; waiting for load…');
      try { await waitForSceneReady(); } catch (_) { /* ignore */ }
    }

    ui.hideUnsupported();

    try {
      await ensureCameraAccess();
    } catch (error) {
      console.warn('[AR] Camera permission is required', error);
      ui.exitARMode();
      ui.showUnsupported();
      guide.setState('hidden');
      guide.clearSubtitles();
      guide.clearCTA();
      return;
    }

    ui.enterARMode();
    ui.setTrackingState('loading');
    ui.setCaptureLabel('Сделать кадр');
    ui.setCaptureEnabled(false);
    // При любом новом старте AR выходим из режима трио
    trioModeActive = false;

    const mindarSystem = sceneEl.systems['mindar-image-system'];
    if (!mindarSystem) {
      console.error('[AR] MindAR system is not available');
      ui.exitARMode();
      ui.showUnsupported();
      return;
    }

    try {
      const baseCfg = {
      imageTargetSrc: './assets/targets/trio.mind',
        maxTrack: 3,
        showStats: false,
        uiLoading: 'no',
        uiScanning: 'no',
        uiError: 'no',
        missTolerance: 10,
        warmupTolerance: 5,
        filterMinCF: 0.00005,
        filterBeta: 0.001,
        autoStart: false,
      };

      // Single-target mode uses only the generic anchor and a specific .mind per hero/step
      if (simpleWolfOnly || state.mode === 'heroes' || state.mode === 'quest') {
        baseCfg.maxTrack = 1;
        enableOnlyGenericAnchor();

        if (state.mode === 'heroes' && state.hero?.mind) {
          baseCfg.imageTargetSrc = (state.hero.key === 'wolf') ? WOLF_MIND : state.hero.mind;
          await prepareHeroScene();
        } else if (state.mode === 'quest') {
          const currentStep = quest.getStep();
          // quest.mindForStep will fall back appropriately for 'intro'
          const stepKey = currentStep === 'intro' ? 'wolf' : currentStep;
          baseCfg.imageTargetSrc = (stepKey === 'wolf') ? WOLF_MIND : quest.getMindForStep(currentStep);
          await prepareGenericForStep(currentStep);
        }
      } else {
        await ensureAssetsForStep('intro');
        restoreAnchorsFromBackup();
        anchors.forEach((a) => a.setAttribute('visible', a.id !== 'anchor-generic'));
      }

      const attrib = [
        `imageTargetSrc: ${baseCfg.imageTargetSrc}`,
        `maxTrack: ${baseCfg.maxTrack}`,
        'uiLoading: no',
        'uiScanning: no',
        'uiError: no',
        `missTolerance: ${baseCfg.missTolerance}`,
        `warmupTolerance: ${baseCfg.warmupTolerance}`,
        `filterMinCF: ${baseCfg.filterMinCF}`,
        `filterBeta: ${baseCfg.filterBeta}`,
        'autoStart: false',
      ].join('; ');
      sceneEl.setAttribute('mindar-image', attrib);

      try { mindarSystem.setup(baseCfg); } catch (error) { console.warn('[AR] setup override failed', error); }

      // No forced step switching; rely on external quest controller

      await mindarSystem.start();
      console.log('[AR] MindAR started');
      bindVideoHandlers();
      tweakCameraClipping();

      if (state.mode === 'quest') {
        // Новые реплики: вступление к сцене Волка
        try {
          if (!quest.isPlayed || !quest.isPlayed('wolf-intro')) {
            await guide.speak('Пойдём к волку!');
            await guide.speak('Поможем ему поймать зайца, который спрятался!');
            if (quest.markPlayed) quest.markPlayed('wolf-intro');
          }
        } catch (_) {}
      } else {
        guide.setState('hidden');
        guide.clearSubtitles();
      }

      // Do not force-start Cheburashka effect in single-target Wolf flow
      ui.setCameraLabel('Камера: задняя');

    } catch (error) {
      console.error('Unable to start AR', error);
      ui.exitARMode();
      ui.showUnsupported();
      guide.setState('hidden');
      guide.clearSubtitles();
      guide.clearCTA();
    }
  };

  const toggleSelfie = async () => {
    if (selfieMode) {
      stopSelfieMode();
    } else {
      await startSelfieMode();
    }
  };

  const startSelfieMode = async () => {
    if (selfieMode) return;
    const mindarSystem = sceneEl.systems['mindar-image-system'];
    try { mindarSystem && mindarSystem.pause(true); } catch (_) {}

    selfieVideo = document.createElement('video');
    selfieVideo.setAttribute('autoplay', '');
    selfieVideo.setAttribute('muted', '');
    selfieVideo.setAttribute('playsinline', '');
    Object.assign(selfieVideo.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      zIndex: '1',
    });
    arWrapper?.appendChild(selfieVideo);

    selfieStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user' } });
    cameraAccessGranted = true;
    selfieVideo.srcObject = selfieStream;

    if (mindarSystem && mindarSystem.video) mindarSystem.video.style.display = 'none';

    selfieMode = true;
    ui.setCameraLabel('Камера: фронтальная');
  };

  const stopSelfieMode = () => {
    if (!selfieMode) return;

    if (selfieVideo) {
      try { selfieVideo.pause(); } catch (_) {}
      if (selfieStream) {
        selfieStream.getTracks().forEach((track) => track.stop());
        selfieStream = null;
      }
      selfieVideo.remove();
      selfieVideo = null;
    }

    const mindarSystem = sceneEl.systems['mindar-image-system'];
    if (mindarSystem && mindarSystem.video) mindarSystem.video.style.display = '';
    try { mindarSystem && mindarSystem.unpause(); } catch (_) {}

    selfieMode = false;
    ui.setCameraLabel('Камера: задняя');
  };

  const getSnapshotSources = () => {
    const sys = sceneEl.systems['mindar-image-system'];
    const video = selfieMode && selfieVideo ? selfieVideo : sys?.video;
    const canvas = sceneEl.renderer?.domElement;
    return { video, canvas };
  };

  const handleTargetFound = (anchor) => {
    const single = simpleWolfOnly || state.mode === 'heroes' || state.mode === 'quest';
    const isTrio = !!trioModeActive;
    // В режиме трио принимаем события от конкретных якорей
    if (single && !isTrio && anchor.id !== 'anchor-generic') return; // игнорируем посторонние якори
    console.log('[AR] Target found @', anchor.id);
    if (state.mode === 'heroes' && state.hero) {
      console.log('[AR] Hero found:', state.hero.key || state.hero.title || 'unknown');
    }
    if (DEBUG_AR) {
      try {
        const anc = anchor.object3D; const cam = sceneEl.camera;
        const s = new AFRAME.THREE.Vector3(), q = new AFRAME.THREE.Quaternion(), t = new AFRAME.THREE.Vector3();
        anc.matrixWorld.decompose(t,q,s);
        const pCam = new AFRAME.THREE.Vector3(); cam.getWorldPosition(pCam);
        const v = t.clone().sub(pCam); const dir = new AFRAME.THREE.Vector3(); cam.getWorldDirection(dir);
        const dot = v.clone().normalize().dot(dir);
        dlog('anchor world pos', t, 'scale', s, 'dot', dot);
      } catch(_) {}
    }
    // В режиме трио — единая фраза и быстрый выход
    if (isTrio) {
      ui.setTrackingFoundMessage('Все в сборе!');
      ui.setInteractionHint('Сфоткайся вместе со всеми!');
      // Стартуем фон птиц, если ещё не играют
      try {
        const root = document.getElementById('scene-generic');
        const birds = root?.querySelector('#trio-birds-sfx');
        const snd = birds?.components?.sound;
        if (snd && !snd.isPlaying) snd.playSound();
      } catch(_) {}
      ui.setCaptureEnabled(true);
      return;
    }

    if (single) {
      try { dlog('TARGET FOUND: single flow for', anchor.id); } catch(_) {}
      let label = 'Сцена';
      if (state.mode === 'heroes' && state.hero) {
        label = state.hero.title;
      } else if (state.mode === 'quest') {
        const st = quest.getStep && quest.getStep() ? quest.getStep() : 'intro';
        label = quest.getDisplayName ? quest.getDisplayName(st) : 'Сцена';
      }
      const verb = /(Волк|Гена)/i.test(label) ? 'найден!' : 'найдена!';
      ui.setTrackingFoundMessage(`${label} ${verb}`);
    } else {
      const map = {
        'anchor-cheb': 'Чебурашка найден!',
        'anchor-shap': 'Все в сборе!',
        'anchor-wolf': 'Волк и Заяц найдены!',
      };
      ui.setTrackingFoundMessage(map[anchor.id] || 'Сцена найдена!');
    }

    if (state.mode === 'heroes' && state.hero) {
      ui.setInteractionHint(`Нашёлся: ${state.hero.title}. Сделай кадр!`);
    } else {
      ui.setInteractionHint('Позируйте рядом с героем и готовьтесь к фото.');
    }
      ui.setCaptureEnabled(true);

    if (!single && anchor.id === 'anchor-cheb') {
      document.getElementById('scene-cheb')?.emit('effect-start');
    }

    // Trigger animations when found (single-target flow)
    if (single) {
      const root = document.getElementById('scene-generic');
      // Включаем дождь апельсинов для Чебурашки
      try {
        const isHeroCheb = state.mode === 'heroes' && state.hero?.key === 'cheburashka';
        const isQuestCheb = state.mode === 'quest' && (quest.getStep && quest.getStep()) === 'cheburashka';
        if (isHeroCheb || isQuestCheb) {
          root && root.emit('effect-start');
        }
        const isQuestShap = state.mode === 'quest' && (quest.getStep && quest.getStep()) === 'shapoklyak';
        const isHeroShap = state.mode === 'heroes' && state.hero?.key === 'shepoklak';
        if (isQuestShap || isHeroShap) { root && root.emit('effect-start'); }
      } catch(_) {}
      const logo = root?.querySelector('[data-logo="1"]');
      if (logo && logo.dataset.dropPlayed !== '1') { try { logo.emit('logo-drop'); } catch (_) {} logo.dataset.dropPlayed = '1'; }
      const swarm = Array.from(root?.querySelectorAll('[data-swarm="1"]') || []);
      swarm.forEach((holder)=>{
        if (holder.dataset.swarmStarted !== '1') {
          try { holder.emit('logo-swarm-start'); } catch(_) {}
          try { holder.querySelector('[data-swarm-child="1"]').emit('logo-swarm-start'); } catch(_) {}
          holder.dataset.swarmStarted = '1';
        }
      });

      // Start logo loop if present
      const chase = root?.querySelector('#logo-chase-holder');
      if (chase && chase.dataset.chaseStarted !== '1') {
        try {
          dlog('CHASE: attempting intro drop or first small-hop');
          const logo = root.querySelector('#logo-chase');
          if (chase.dataset.introPlayed !== '1') {
            logo?.emit('chase-intro-drop');
            chase.dataset.introPlayed = '1';
          } else {
            logo?.emit('small-hop');
            if (logo && !logo.getAttribute('animation__hopSmall')) {
              setTimeout(()=>{ try { dlog('CHASE: retry small-hop after load'); logo.emit('small-hop'); } catch(_) {} }, 220);
            }
          }
        } catch(_) {}
        chase.dataset.chaseStarted = '1';
        // No travel fallback in this looped hops + big jump mode
      }

      guide.clearCTA();
      // Фраза для сцены с волком
      try {
        const stepNow = quest.getStep && quest.getStep();
        if ((state.mode === 'heroes' && state.hero?.key === 'wolf') ||
            (state.mode === 'quest' && ['intro', 'wolf'].includes(stepNow))) {
          guide.showSubtitles('Поймай зайца!');
        } else {
          guide.showSubtitles('Отлично, сделай фото');
        }
      } catch (_) {}

      // Включаем музыку и эффект нот у Гены (квест/герои)
      try {
        const isQuestGena = state.mode === 'quest' && (quest.getStep && quest.getStep()) === 'gena';
        const isHeroGena = state.mode === 'heroes' && state.hero?.key === 'gena';
        if (isQuestGena || isHeroGena) {
          playGenaAudio();
          const root = document.getElementById('scene-generic');
          root && root.emit('gena-music-start');
        }
      } catch (_) {}

      // Сцена стенда Чебурашек: звёзды, скрыть кнопки, яркий CTA и клик на сайт
      try {
        const isStand = state.mode === 'quest' && (quest.getStep && quest.getStep()) === 'cheburashkastand';
        if (isStand) {
          const root = document.getElementById('scene-generic');
          // Запускаем эмиттер звёзд (на дочернем узле), а не на корне
          try {
            const stars = root && root.querySelector('#cheb-stand-stars');
            stars && stars.emit('effect-start');
          } catch(_) {}
          // Бросаем билет сверху
          const t = root && root.querySelector('#cheb-stand-ticket');
          try { t && t.emit('stand-drop'); } catch(_) {}
          ui.setCaptureEnabled(false);
          ui.setCaptureLabel('Сделать кадр');
          ui.setCaptureVisible && ui.setCaptureVisible(false);
          ui.setSkipVisible && ui.setSkipVisible(false);
          guide.setState('hidden');
          guide.setCTA('Нажми на билет!');
          enableStandClickMode();
        }
      } catch(_) {}
    }
  };

  const handleTargetLost = (anchor) => {
    const single = simpleWolfOnly || state.mode === 'heroes' || state.mode === 'quest';
    if (single && anchor.id !== 'anchor-generic') return;
    console.log('[AR] Target lost @', anchor.id);

    // Сразу глушим музыку Гены на событии потери таргета + стопим эффект нот
    try {
      const isQuestGena = state.mode === 'quest' && (quest.getStep && quest.getStep()) === 'gena';
      const isHeroGena = state.mode === 'heroes' && state.hero?.key === 'gena';
      if (isQuestGena || isHeroGena) {
        stopGenaAudio();
        const root = document.getElementById('scene-generic');
        root && root.emit('gena-music-stop');
      }
    } catch (_) {}

    const anyVisible = single
      ? !!document.getElementById('anchor-generic')?.object3D?.visible
      : anchors.some((a) => a.object3D?.visible);
    if (!anyVisible) {
      if (trioModeActive) {
        ui.setTrackingState('lost_trio');
        ui.setInteractionHint('Совместите рамку с трио гены, чебурашки и шапокляк');
      } else {
        ui.setTrackingState('lost');
        ui.setInteractionHint('Совместите рамку с изображением персонажа.');
      }
      try {
        // Выключаем дождь апельсинов при потере таргета Чебурашки
        const root = document.getElementById('scene-generic');
        const isHeroCheb = state.mode === 'heroes' && state.hero?.key === 'cheburashka';
        const isQuestCheb = state.mode === 'quest' && (quest.getStep && quest.getStep()) === 'cheburashka';
        if (isHeroCheb || isQuestCheb) { root && root.emit('effect-stop'); }
        // Остановить сцену Шапокляк ("Нельзя") при потере таргета (квест и одиночная)
        const isQuestShap = state.mode === 'quest' && (quest.getStep && quest.getStep()) === 'shapoklyak';
        const isHeroShap = state.mode === 'heroes' && state.hero?.key === 'shepoklak';
        if (isQuestShap || isHeroShap) { root && root.emit('effect-stop'); stopShapAudio(); }
        // Остановить стенд Чебурашек и вернуть UI
        const isStand = state.mode === 'quest' && (quest.getStep && quest.getStep()) === 'cheburashkastand';
        if (isStand) {
          try {
            const stars = root && root.querySelector('#cheb-stand-stars');
            stars && stars.emit('effect-stop');
          } catch(_) {}
          disableStandClickMode();
        }
        if (state.mode === 'quest') {
          if (trioModeActive) {
            // В трио не подсказываем про Шапокляк — предлагаем фото со всеми
            guide.showSubtitles('Сфоткайся вместе со всеми!');
            guide.dockToCorner('tl');
          } else {
          const st = quest.getStep ? quest.getStep() : 'intro';
          if (st === 'gena') { guide.showSubtitles('Наведи камеру на Гену!'); guide.dockToCorner('tl'); }
          else if (st === 'cheburashka') { guide.showSubtitles('Наведи камеру на Чебурашку!'); guide.dockToCorner('tl'); }
          else if (st === 'cheburashkastand') { guide.showSubtitles('Наведись на чебурашек! Получи приз!'); guide.dockToCorner('tl'); }
          else if (st === 'shapoklyak') { guide.showSubtitles('Наведи камеру на Шапокляк!'); guide.dockToCorner('tl'); }
          else { guide.showSubtitles('Наведи камеру на волка!'); }
          }
        }
      } catch (_) {}
    }
  };

  // Removed normalization workaround (was compensating invalid target scale).

  const enableOnlyGenericAnchor = () => {
    anchors.forEach((anchor) => {
      if (anchor.id === 'anchor-generic') return;
      if (anchor.hasAttribute('mindar-image-target')) {
        anchor.dataset.mindarBackup = anchor.getAttribute('mindar-image-target');
        anchor.removeAttribute('mindar-image-target');
      }
      anchor.setAttribute('visible', 'false');
    });
    // Let MindAR control generic anchor visibility (start as invisible)
    const generic = document.getElementById('anchor-generic');
    if (generic) generic.setAttribute('visible', 'false');
  };

  const restoreAnchorsFromBackup = () => {
    anchors.forEach((anchor) => {
      if (anchor.dataset?.mindarBackup) {
        anchor.setAttribute('mindar-image-target', anchor.dataset.mindarBackup);
        delete anchor.dataset.mindarBackup;
      }
      anchor.setAttribute('visible', anchor.id !== 'anchor-generic' ? 'true' : 'false');
    });
  };

  // Click-through mode for Cheburashka stand: open site on tap
  let standClickActive = false;
  let standClickHandler = null;
  const enableStandClickMode = () => {
    if (standClickActive) return;
    const wrapper = ui.getArWrapper ? ui.getArWrapper() : document.body;
    if (!wrapper) return;
    standClickHandler = (e) => {
      // Открываем ссылку строго по реальному тапу по сцене (не по UI)
      try {
        // Только доверенные (пользовательские) события
        if (!e.isTrusted) return;
        // Только основной клик/тап
        if (typeof e.button === 'number' && e.button !== 0) return;
        const target = e.target;
        // Игнорируем клики по оверлею/кнопкам UI
        const overlay = document.getElementById('ar-overlay');
        if (overlay && overlay.contains(target)) return;
        e.preventDefault();
        window.open('https://souzmultpark.ru', '_blank', 'noopener');
        // После перехода отключаем режим клика, чтобы не открывать повторно
        disableStandClickMode();
      } catch(_) {}
    };
    try { wrapper.addEventListener('click', standClickHandler); } catch(_) {}
    try { wrapper.style.cursor = 'pointer'; } catch(_) {}
    standClickActive = true;
  };
  const disableStandClickMode = () => {
    const wrapper = ui.getArWrapper ? ui.getArWrapper() : document.body;
    if (wrapper && standClickHandler) {
      try { wrapper.removeEventListener('click', standClickHandler); } catch(_) {}
    }
    try { if (wrapper) wrapper.style.cursor = ''; } catch(_) {}
    ui.setCaptureVisible && ui.setCaptureVisible(true);
    ui.setSkipVisible && ui.setSkipVisible(true);
    guide.clearCTA && guide.clearCTA();
    standClickActive = false;
    standClickHandler = null;
  };

  // Generic content preparation for single-target (generic anchor) mode
  const prepareHeroScene = async () => {
    const root = document.getElementById('scene-generic');
    if (!root) return;
    await ensureAssetsForHero(state.hero?.key);
    while (root.firstChild) root.removeChild(root.firstChild);
    root.setAttribute('scale', '1 1 1');
    root.removeAttribute('animation__pop');

    // Special: Trio scene in single-hero mode
    if (state.hero?.key === 'trio') {
      trioModeActive = true; // enable trio messaging/flow
      try { buildTrioScenery(root); } catch(_) {}
      try {
        ui.setInteractionHint('Совместите рамку с трио гены, чебурашки и шапокляк');
      } catch(_) {}
      // No additional effects
      return;
    }

    const spec = specForHero(state.hero?.key);
    try { dlog('PREPARE hero', state.hero?.key, spec); } catch(_) {}
    let shapSceneReady = false;
    try {
      if (state.hero?.key === 'gena') {
        // Спавним ноты чуть ниже центра
        root.setAttribute('music-notes', 'baseY: -0.08');
      } else {
        root.removeAttribute('music-notes');
      }
      if (state.hero?.key === 'cheburashka') {
        ensureChebCollider(root);
        root.setAttribute('orange-rain', buildChebRainAttrib());
      } else {
        root.removeAttribute('orange-rain');
      }
      if (state.hero?.key === 'shepoklak') {
        // Для одиночной сцены Шапокляк подключаем тот же мини-сценарий с сыром и Лариской
        addShapoklyakCheeseScene(root);
        shapSceneReady = true;
      }
    } catch (error) {
      console.warn('[AR] prepareHeroScene failed', error);
    }
    if (state.hero?.key === 'shepoklak' && shapSceneReady) {
      // Уже добавили контент сцены Шапокляк
      return;
    }
    if (spec && spec.logoChase) {
      addLogoChaseToRoot(root, spec);
    } else if (spec && spec.swarm) {
      addSwarmToRoot(root, spec);
    } else if (spec && spec.model) {
      addModelToRoot(root, spec);
    }
  };

  const prepareGenericForStep = async (step) => {
    // Выходим из режима трио при переходе на шаг квеста
    trioModeActive = false;
    const root = document.getElementById('scene-generic');
    if (!root) return;
    await ensureAssetsForStep(step);
    while (root.firstChild) root.removeChild(root.firstChild);
    root.setAttribute('scale', '1 1 1');
    root.removeAttribute('animation__pop');

    const spec = specForStep(step);
    try { dlog('PREPARE step', step, spec); } catch(_) {}
    // Подключаем ноты для шага Гены (эффект включается событиями)
    let shapStepReady = false;
    try {
      if (step === 'gena') {
        // Спавним ноты чуть ниже центра
        root.setAttribute('music-notes', 'baseY: -0.08');
      } else {
        root.removeAttribute('music-notes');
      }
      if (step === 'cheburashka') {
        ensureChebCollider(root);
        root.setAttribute('orange-rain', buildChebRainAttrib());
      } else {
        root.removeAttribute('orange-rain');
      }
      // Мини-сцена для Шапокляк: сыр + мышка тянется к сыру, голос "Нельзя" — мышка отползает
      if (step === 'shapoklyak') {
        addShapoklyakCheeseScene(root);
        shapStepReady = true;
      }
      // Сцена стенда Чебурашек: билет по центру + частицы-звёздочки
      if (step === 'cheburashkastand') {
        addChebStandScene(root);
      }
    } catch (error) {
      console.warn('[AR] prepareGenericForStep failed', error);
    }
    if ((step === 'shapoklyak' && shapStepReady) || step === 'cheburashkastand') {
      // для шага Шапокляк — свою сцену уже добавили
      return;
    }
    if (spec && spec.logoChase) {
      addLogoChaseToRoot(root, spec);
    } else if (spec && spec.swarm) {
      addSwarmToRoot(root, spec);
    } else if (spec && spec.model) {
      addModelToRoot(root, spec);
    }
  };

  // Build Cheburashka stand scene: central ticket and star emitter
  const addChebStandScene = (root) => {
    if (!root) return;
    // Ticket in the center, slight drop-in bounce
    try {
      const ticket = document.createElement('a-entity');
      ticket.id = 'cheb-stand-ticket';
      // Attach to DOM first so components initialize reliably
      root.appendChild(ticket);
      // Visual + render settings (before model loads)
      ticket.setAttribute('rotation', '0 0 0');
      ticket.setAttribute('visible', 'true');
      ticket.setAttribute('force-opaque', 'mode: opaque; doubleSide: true; renderOrder: 20');
      ticket.setAttribute('mesh-outline', 'color: #FFD400; opacity: 0.35; scale: 1.06');
      // Bind model AFTER append
      safeSetGltfModel(ticket, '#ticketModel');
      // Auto-fit once loaded
      const fitOnce = () => {
        try {
          const obj = ticket.getObject3D('mesh');
          if (!obj) return;
          const box = new AFRAME.THREE.Box3().setFromObject(obj);
          const size = new AFRAME.THREE.Vector3();
          box.getSize(size);
          const currentMax = Math.max(size.x, size.y, size.z) || 1;
          // Large ticket to ensure visibility
          const desired = 6.0;
          const k = desired / currentMax;
          if (isFinite(k) && k > 0 && k < 1000) obj.scale.multiplyScalar(k);
          // Push render order on meshes too
          try { obj.traverse((n)=>{ if (n.isMesh) n.renderOrder = 20; }); } catch(_) {}
        } catch(_) {}
      };
      if (ticket.getObject3D('mesh')) fitOnce(); else ticket.addEventListener('model-loaded', fitOnce, { once: true });
      // Put clearly in front of the plane to avoid occlusion (negative Z faces camera)
      ticket.setAttribute('position', `0 0 -0.20`);
      // Drop-in from above with soft bounce (same Z lane)
      ticket.setAttribute('animation__drop', `property: position; from: 0 0.8 -0.20; to: 0 0 -0.20; dur: 900; easing: easeOutCubic; startEvents: stand-drop`);
      ticket.setAttribute('animation__bounce', `property: position; from: 0 0 -0.20; to: 0 0.08 -0.20; dir: alternate; loop: 1; dur: 240; easing: easeOutCubic; startEvents: animationcomplete__drop`);

      // Extra diagnostics for ticket
      try {
        const onLoaded = () => { console.log('[TICKET][LOADED] ok'); };
        const onError = (e) => { console.warn('[TICKET][ERROR]', e?.detail || e); };
        ticket.addEventListener('model-loaded', onLoaded, { once: true });
        ticket.addEventListener('model-error', onError, { once: true });
        setTimeout(()=>{
          if (!ticket.getObject3D('mesh')) {
            console.warn('[TICKET][TIMEOUT] no mesh, adding fallback plane');
            const fallback = document.createElement('a-entity');
            fallback.setAttribute('geometry', 'primitive: plane; width: 1.2; height: 0.6');
            fallback.setAttribute('material', 'color: #cc2244; side: double; opacity: 0.9');
            // Ensure fallback is also in front of target
            fallback.setAttribute('position', '0 0 -0.21');
            ticket.appendChild(fallback);
          }
        }, 2500);
      } catch(_) {}
    } catch(_) {}

    // Stars emitter on root
    try {
      const emit = document.createElement('a-entity');
      emit.id = 'cheb-stand-stars';
      // Put slightly in front to avoid occlusion by target plane (negative Z faces camera)
      emit.setAttribute('position', '0 0 -0.02');
      // Bigger, longer-living, and more abundant stars
      emit.setAttribute('star-emitter', 'model: #cuteStarModel; rate: 60; max: 400; size: 0.22; baseY: 0.02; speedMin: 0.30; speedMax: 0.75; lifeMin: 4.0; lifeMax: 7.0; outBias: 1.0; spinMin: 180; spinMax: 720');
      root.appendChild(emit);
    } catch(_) {}
  };

  // Build cheese + mouse behavior for Shapoklyak step
  const addShapoklyakCheeseScene = (root) => {
    if (!root) return;
    // Positions relative to target plane
    const baseYCheese = -0.44; // even lower: near feet level
    const zLane = -0.06;       // shared Z lane for both
    const cheeseX = 0.56;      // moved 0.01 further to the right
    const mouseStartX = -0.60; // far left near Shapoklyak
    let mouseAlmostX = (cheeseX - 0.006); // aim extremely close; refined after load

    // Cheese
    const cheese = document.createElement('a-entity');
    cheese.id = 'cheese-prop';
    safeSetGltfModel(cheese, '#cheeseModel');
    cheese.setAttribute('position', `${cheeseX} ${baseYCheese} ${zLane}`);
    cheese.setAttribute('rotation', '0 -90 0'); // rotate +90° clockwise
    root.appendChild(cheese);

    // Mouse (Lariska)
    const mouse = document.createElement('a-entity');
    mouse.id = 'lariska-actor';
    safeSetGltfModel(mouse, '#lariskaModel');
    mouse.setAttribute('position', `${mouseStartX} -0.44 ${zLane}`);
    mouse.setAttribute('rotation', '0 90 0'); // face towards cheese
    mouse.setAttribute('visible', 'true');
    // Slight idle sway
    // No yaw sway; keep facing cheese (+90°). We'll tilt on sniff.
    root.appendChild(mouse);

    // Auto-fit helpers
    const fitTo = (el, desiredMax=0.40) => {
      try {
        const obj = el.getObject3D('mesh');
        if (!obj) return;
        const box = new AFRAME.THREE.Box3().setFromObject(obj);
        const size = new AFRAME.THREE.Vector3();
        box.getSize(size);
        const factor = (desiredMax || 0.4) / (Math.max(size.x, size.y, size.z) || 1);
        if (isFinite(factor) && factor > 0 && factor < 1000) obj.scale.multiplyScalar(factor);
      } catch (_) {}
    };
    let cheeseReady = false, mouseReady = false, safeStopReady = false;
    const tryComputeSafeStop = () => {
      if (!cheeseReady || !mouseReady) return;
      try {
        const cObj = cheese.getObject3D('mesh');
        const mObj = mouse.getObject3D('mesh');
        if (!cObj || !mObj) {
          safeStopReady = true;
          return;
        }
        const cBox = new AFRAME.THREE.Box3().setFromObject(cObj);
        const mBox = new AFRAME.THREE.Box3().setFromObject(mObj);
        const cSize = new AFRAME.THREE.Vector3();
        const mSize = new AFRAME.THREE.Vector3();
        cBox.getSize(cSize); mBox.getSize(mSize);
        // Push a bit into cheese for firm contact
        const touchPush = 0.05; // ~5cm into contact
        const cHalf = Math.max(0.001, cSize.x/2);
        const mHalf = Math.max(0.001, mSize.x/2);
        // Base visual separation; then reduce сильно (до ~10%) и минимальный зазор ~2-3мм
        const baseSep = Math.max(0.001, (cHalf + mHalf - touchPush));
        const closerSep = 0.2;
        mouseAlmostX = cheeseX - closerSep;
        safeStopReady = true;
      } catch(_) {
        safeStopReady = true;
      }
    };
    const onCheeseReady = () => { fitTo(cheese, 0.22); cheeseReady = true; setTimeout(tryComputeSafeStop, 0); };
    const onMouseReady = () => { fitTo(mouse, 0.28); mouseReady = true; setTimeout(tryComputeSafeStop, 0); };
    if (cheese.getObject3D('mesh')) onCheeseReady(); else cheese.addEventListener('model-loaded', onCheeseReady, { once: true });
    if (mouse.getObject3D('mesh')) onMouseReady(); else mouse.addEventListener('model-loaded', onMouseReady, { once: true });

    // Approach/retreat state machine
    const approachDur = 8000; // slow approach
    const yMouse = -0.44;
    let phase = 'idle'; // idle | approaching | sniffing

    const applyApproachAnim = () => {
      mouse.setAttribute('animation__approach', `property: position; from: ${mouseStartX} ${yMouse} ${zLane}; to: ${mouseAlmostX} ${yMouse} ${zLane}; dur: ${approachDur}; easing: easeInOutCubic; startEvents: l-approach`);
    };
    const startSniff = () => {
      try {
        // Gentle sniffing bob while waiting for photo
        mouse.setAttribute('animation__sniff', `property: position; from: ${mouseAlmostX} ${yMouse} ${zLane}; to: ${mouseAlmostX} ${yMouse + 0.02} ${zLane}; dir: alternate; loop: true; dur: 900; easing: easeInOutSine; startEvents: l-sniff`);
        mouse.emit('l-sniff');
        // Add slight forward tilt toward cheese while sniffing (pitch X)
        mouse.removeAttribute('animation__tilt');
        mouse.setAttribute('animation__tilt', 'property: rotation; from: 0 90 0; to: 4 90 0; dir: alternate; loop: true; dur: 1100; easing: easeInOutSine; startEvents: l-tilt');
        mouse.emit('l-tilt');
      } catch(_) {}
    };

    const onApproachStart = () => { phase = 'approaching'; };
    const onApproachDone = () => { phase = 'sniffing'; startSniff(); };

    mouse.addEventListener('animationstart__approach', onApproachStart);
    mouse.addEventListener('animationcomplete__approach', onApproachDone);

    const startApproach = () => {
      try {
        // ensure at start pos
        mouse.object3D.position.set(mouseStartX, yMouse, zLane);
        mouse.removeAttribute('animation__sniff');
        mouse.removeAttribute('animation__tilt');
        applyApproachAnim();
        mouse.emit('l-approach');
      } catch(_) {}
    };

    // Start cycle on effect-start; stop on effect-stop
    const startOnce = () => {
      const begin = () => setTimeout(startApproach, 800);
      if (safeStopReady) begin(); else {
        const iv = setInterval(()=>{ if (safeStopReady) { clearInterval(iv); begin(); } }, 60);
      }
    };
    const stopAll = () => {
      try {
        phase = 'idle';
        try { mouse.removeAttribute('animation__approach'); } catch(_) {}
        try { mouse.removeAttribute('animation__sniff'); } catch(_) {}
        try { mouse.removeAttribute('animation__tilt'); } catch(_) {}
        stopShapAudio();
      } catch (_) {}
    };

    root.addEventListener('effect-start', startOnce);
    root.addEventListener('effect-stop', stopAll);
  };

  // Generic model helpers
  const addModelToRoot = (root, spec) => {
    if (!root || !spec || !spec.model) return;
    const node = document.createElement('a-entity');
    if (spec.id) node.id = spec.id;
    safeSetGltfModel(node, spec.model);
    if (spec.scale) node.setAttribute('scale', spec.scale);
    if (spec.position) node.setAttribute('position', spec.position);
    if (spec.rotation) node.setAttribute('rotation', spec.rotation);
    if (spec.mixer) node.setAttribute('animation-mixer', '');
    // Visible by default; anchor visibility will control actual rendering
    node.setAttribute('visible', 'true');
    root.appendChild(node);

    // Auto-fit model to anchor size when loaded to prevent oversizing issues
    const fitOnce = () => {
      try {
        const obj = node.getObject3D('mesh');
        if (!obj) return;
        const box = new AFRAME.THREE.Box3().setFromObject(obj);
        const size = new AFRAME.THREE.Vector3();
        box.getSize(size);
        const currentMax = Math.max(size.x, size.y, size.z) || 1;
        const desired = spec.fitSize || 0.6; // fraction of target unit
        const factor = desired / currentMax;
        if (isFinite(factor) && factor > 0 && factor < 1000) {
          obj.scale.multiplyScalar(factor);
        }
      } catch (e) {
        // no-op
      }
    };
    if (node.getObject3D('mesh')) {
      fitOnce();
    } else {
      node.addEventListener('model-loaded', fitOnce, { once: true });
    }

    // Optional drop animation behind/aside the target
    if (spec.drop) {
      const x = typeof spec.xOffset === 'number' ? spec.xOffset : 0;
      const z = typeof spec.zOffset === 'number' ? spec.zOffset : -0.06;
      const h = typeof spec.dropHeight === 'number' ? spec.dropHeight : 0.85;
      node.setAttribute('position', `${x} ${h} ${z}`);
      node.setAttribute('animation__drop', `property: position; from: ${x} ${h} ${z}; to: ${x} 0 ${z}; dur: ${spec.dropDur || 3000}; easing: ${spec.dropEasing || 'easeOutCubic'}; startEvents: logo-drop; loop: 0`);
      node.dataset.logo = '1';
      node.dataset.dropPlayed = '0';

      // Bounce after landing (repeat)
      const bounceHeight = typeof spec.bounceHeight === 'number' ? spec.bounceHeight : 0.45;
      const bounceDur = typeof spec.bounceDur === 'number' ? spec.bounceDur : 380;
      const bounceEasing = spec.bounceEasing || 'easeOutCubic';
      const onDropComplete = () => {
        try {
          node.setAttribute('animation__bounce', `property: position; from: ${x} 0 ${z}; to: ${x} ${bounceHeight} ${z}; dir: alternate; dur: ${bounceDur}; easing: ${bounceEasing}; startEvents: logo-bounce; loop: true`);
          node.emit('logo-bounce');
        } catch (_) {}
      };
      node.addEventListener('animationcomplete__drop', onDropComplete, { once: true });
    }
  };

  // Build a swarm of small logos hopping around the target
  const addSwarmToRoot = (root, spec) => {
    if (!root || !spec) return;
    const count = Math.max(3, spec.swarmCount || 14);
    const layout = spec.swarmLayout || 'ring'; // 'ring' | 'sides'
    const radius = spec.swarmRadius || 0.34;
    const jitter = spec.swarmJitter || 0.16;
    const hop = spec.swarmHop || 0.16;
    const durMin = spec.swarmDurMin || 520;
    const durMax = spec.swarmDurMax || 1200;
    const zBase = (typeof spec.zOffset === 'number') ? spec.zOffset : -0.10;
    const baseY = (typeof spec.swarmBaseY === 'number') ? spec.swarmBaseY : 0.00;
    const rot = spec.rotation || '0 -90 0';
    const fit = spec.fitSizeSmall || 0.16;
    // Sides layout params
    const sideX = spec.swarmSideX ?? 0.42; // distance from center along X for sides
    const sideSpread = spec.swarmSideSpread ?? 0.10; // horizontal jitter around each side stripe
    const depthSpread = spec.swarmDepthSpread ?? 0.18; // allowed Z jitter range
    const clearX = spec.swarmClearX ?? 0.32; // keep |x| above this to avoid covering wolf
    const wanderX = spec.swarmWanderX ?? 0.10;
    const wanderZ = spec.swarmWanderZ ?? 0.10;
    const wanderDurMin = spec.swarmWanderDurMin ?? 1200;
    const wanderDurMax = spec.swarmWanderDurMax ?? 2400;

    const rand = (a,b)=> a + Math.random()*(b-a);

    for (let i=0; i<count; i++) {
      let x, z;
      if (layout === 'sides') {
        const side = i < Math.ceil(count/2) ? -1 : 1; // left negative, right positive
        x = side * (sideX + rand(-sideSpread, sideSpread));
        z = zBase + rand(-depthSpread, depthSpread);
      } else {
        const a = (i / count) * Math.PI * 2 + rand(-0.6, 0.6);
        const r = radius + rand(-jitter, jitter);
        x = r * Math.cos(a);
        z = zBase + r * Math.sin(a);
      }

      // Holder animates lateral wander; child animates vertical hop
      const holder = document.createElement('a-entity');
      holder.setAttribute('position', `${x} 0 ${z}`);
      holder.dataset.swarm = '1';
      holder.dataset.swarmStarted = '0';
      const wdur = Math.floor(rand(wanderDurMin, wanderDurMax));
      // Clamp X wander so |x| stays above clearX
      const sign = Math.sign(x) || 1;
      const ax = Math.max(0.01, Math.min(wanderX, Math.abs(x) - clearX));
      const az = Math.min(wanderZ, depthSpread);
      const tx = x + sign * rand(0.0, ax);
      const tz = z + rand(-az, az);
      const wdelay = Math.floor(rand(0, 600));
      holder.setAttribute('animation__wander', `property: position; from: ${x} 0 ${z}; to: ${tx} 0 ${tz}; dir: alternate; loop: true; dur: ${wdur}; delay: ${wdelay}; easing: easeInOutSine; startEvents: logo-swarm-start`);

      const node = document.createElement('a-entity');
      safeSetGltfModel(node, spec.model || '#souzmultiparkModel');
      node.setAttribute('position', `0 ${baseY} 0`);
      node.setAttribute('rotation', rot);
      node.setAttribute('visible', 'true');
      node.dataset.swarmChild = '1';
      const dur = Math.floor(rand(durMin, durMax));
      const delay = Math.floor(rand(0, 400));
      node.setAttribute('animation__hop', `property: position; from: 0 ${baseY} 0; to: 0 ${baseY + hop} 0; dir: alternate; loop: true; dur: ${dur}; delay: ${delay}; easing: easeInOutSine; startEvents: logo-swarm-start`);
      holder.appendChild(node);
      root.appendChild(holder);

      const fitOnce = () => {
        try {
          const obj = node.getObject3D('mesh');
          if (!obj) return;
          const box = new AFRAME.THREE.Box3().setFromObject(obj);
          const size = new AFRAME.THREE.Vector3();
          box.getSize(size);
          const currentMax = Math.max(size.x, size.y, size.z) || 1;
          const factor = (fit || 0.16) / currentMax;
          if (isFinite(factor) && factor > 0 && factor < 1000) obj.scale.multiplyScalar(factor);
        } catch (_) {}
      };
      if (node.getObject3D('mesh')) fitOnce(); else node.addEventListener('model-loaded', fitOnce, { once: true });
    }
  };

  // Trio scenic layout for target trio.mind
  const buildTrioScenery = (root) => {
    if (!root) return;
    // Clear existing content
    try { while (root.firstChild) root.removeChild(root.firstChild); } catch(_) {}

    const makeAndFit = (gltf, { position = '0 0 0', rotation = '0 -90 0', fitSize = 0.6, id } = {}) => {
      const el = document.createElement('a-entity');
      if (id) el.id = id;
      safeSetGltfModel(el, gltf);
      el.setAttribute('position', position);
      el.setAttribute('rotation', rotation);
      el.setAttribute('visible', 'true');
      root.appendChild(el);
      const fitOnce = () => {
        try {
          const obj = el.getObject3D('mesh');
          if (!obj) return;
          const box = new AFRAME.THREE.Box3().setFromObject(obj);
          const size = new AFRAME.THREE.Vector3();
          box.getSize(size);
          const currentMax = Math.max(size.x, size.y, size.z) || 1;
          const factor = (fitSize || 0.6) / currentMax;
          if (isFinite(factor) && factor > 0 && factor < 1000) obj.scale.multiplyScalar(factor);
        } catch (_) {}
      };
      if (el.getObject3D('mesh')) fitOnce(); else el.addEventListener('model-loaded', fitOnce, { once: true });
      return el;
    };

    // 1) Трава внизу (grass.glb)
    makeAndFit('#grassModel', {
      id: 'trio-grass',
      position: '-0.8 -0.85 -0.40',
      rotation: '0 -90 0',
      fitSize: 0.02,
    });

    // 2) Цветы поверх травы (grass_floor.glb)
    makeAndFit('#grassFloorModel', {
      id: 'trio-grass-floor',
      position: '0 -0.85 -0.10',
      rotation: '0 -90 0',
      fitSize: 0.15,
    });

    // 3) Два дерева сзади, слева и справа (tree.glb)
    makeAndFit('#treeModel', {
      id: 'trio-tree-left',
      position: '-0.70 -0.85 -0.36',
      rotation: '0 -90 0',
      fitSize: 0.25,
    });
    makeAndFit('#treeModel', {
      id: 'trio-tree-right',
      position: '0.70 -0.85 -0.36',
      rotation: '0 -90 0',
      fitSize: 0.25,
    });

    // 4) Логотип по центру вверху (souzmultipark.glb)
    makeAndFit('#souzmultiparkModel', {
      id: 'trio-logo',
      position: '0 0.74 -0.12',
      rotation: '0 -90 0',
      fitSize: 0.52,
    });

    // 5) Солнце слева сверху (sun.glb)
    makeAndFit('#sunModel', {
      id: 'trio-sun',
      position: '-0.86 0.80 -0.32',
      rotation: '0 -90 0',
      fitSize: 0.42,
    });

    // 6) Фоновые птицы: бесконечный цикл, запускаем по первому попаданию в трио
    try {
      const birds = document.createElement('a-entity');
      birds.id = 'trio-birds-sfx';
      // Use preloaded audio asset if present
      birds.setAttribute('sound', 'src: #birdsAudio; autoplay: false; loop: true; positional: false; volume: 0.65');
      root.appendChild(birds);
    } catch(_) {}
  };

  // Safe helper: set gltf-smart only when src is a non-empty string or an Element with id
  const safeSetGltfModel = (el, src) => {
    try {
      let ref = src;
      if (!ref) return false;
      if (ref instanceof Element) {
        const id = ref.id;
        if (!id) return false;
        ref = `#${id}`;
      }
      if (typeof ref !== 'string') {
        console.warn('[AR] skip gltf-model, non-string ref:', ref);
        return false;
      }
      // Validate a-assets entry exists
      if (ref[0] === '#') {
        const assetId = ref.slice(1);
        const asset = document.getElementById(assetId);
        if (!asset) {
          console.warn('[GLTF][MISSING-ASSET]', { elId: el.id, assetId });
        }
      }
      // debug flag is enabled by 'debug' URL param
      const urlParams = new URLSearchParams(location.search);
      const DEBUG = urlParams.has('debug') || ['1','true','yes','on'].includes((urlParams.get('debug')||'').toLowerCase());
      if (DEBUG) {
        try { console.log('[GLTF][SET]', { elId: el.id, ref }); } catch(_) {}
        // Attach one-off listeners to understand load results
        const onLoaded = (e) => {
          try {
            const obj = el.getObject3D('mesh');
            const box = obj ? new AFRAME.THREE.Box3().setFromObject(obj) : null;
            const size = new AFRAME.THREE.Vector3();
            if (box) box.getSize(size);
            console.log('[GLTF][LOADED]', { elId: el.id, ref, size: { x: size.x, y: size.y, z: size.z } });
          } catch(err) { console.warn('[GLTF][LOADED] size error', err); }
        };
        const onError = (e) => {
          console.warn('[GLTF][ERROR]', { elId: el.id, ref, detail: e?.detail || e });
          // Diagnostic helper: show a visible cube so we know anchor/content is rendering
          try {
            const dbg = document.createElement('a-entity');
            dbg.setAttribute('geometry', 'primitive: box; width: 0.18; height: 0.12; depth: 0.02');
            dbg.setAttribute('material', 'color: #ff3366; opacity: 0.9; side: double; metalness: 0.1; roughness: 0.6');
            dbg.setAttribute('position', '0 0 0.02');
            el.appendChild(dbg);
          } catch(_) {}
        };
        el.addEventListener('model-loaded', onLoaded, { once: true });
        el.addEventListener('model-error', onError, { once: true });
        // Timeout: if nothing happens in 3s, show a debug cube
        setTimeout(()=>{
          try {
            if (!el.getObject3D('mesh')) {
              console.warn('[GLTF][TIMEOUT]', { elId: el.id, ref });
              const dbg = document.createElement('a-entity');
              dbg.setAttribute('geometry', 'primitive: box; width: 0.18; height: 0.12; depth: 0.02');
              dbg.setAttribute('material', 'color: #33c3ff; opacity: 0.8; side: double');
              dbg.setAttribute('position', '0 0 0.02');
              el.appendChild(dbg);
            }
          } catch(_) {}
        }, 3000);
      }
      el.setAttribute('gltf-smart', ref);
      return true;
    } catch (e) {
      console.warn('[AR] failed to set gltf-model', e);
      return false;
    }
  };

  const specForHero = (key) => {
    switch (key) {
      case 'cheburashka':
        // Модель убираем. Для Чебурашки используем только коллайдер таргета + дождь апельсинов
        return null;
      case 'gena':
        // В одиночном режиме — без множества мини‑Ген, концентрируемся на нотах
        return null;
      case 'wolf':
        // Один логотип: прыжки у зайца (справа) и перелёт влево, заяц статичен справа
        // Чуть выше прыжок; справа 3 прыжка, слева 2 (см. installAnimations)
        // Уменьшили логотип и зайца в 1.5 раза относительно прошлых значений; заяц дальше за логотипом
        return { logoChase: true, rotation: '0 -90 0', rightX: 0.60, leftX: -0.60, baseZ: -0.14, baseY: -0.08, hop: 0.12, hopDurMin: 900, hopDurMax: 1400, travelDur: 1100, arcY: 0.70, fitLogo: 1.92, hareModel: '#rabbitModel', hareX: 0.60, hareZ: -0.30, hareY: -0.08, hareFit: 1.17, hareRot: '0 -90 0' };
      case 'shepoklak':
        return { model: '#lariskaModel', scale: '0.4 0.4 0.4', position: '0 -0.05 0', rotation: '0 20 0', mixer: true };
      case 'lariska':
        return { model: '#lariskaModel', scale: '0.4 0.4 0.4', position: '0 -0.05 0', rotation: '0 20 0', mixer: true };
      case 'souzmultipark':
        return { model: '#souzmultiparkModel', fitSize: 0.8 };
      default:
        // По умолчанию — уменьшили логотип и зайца в 1.5 раза; заяц дальше за логотипом
        return { logoChase: true, rotation: '0 -90 0', rightX: 0.60, leftX: -0.60, baseZ: -0.14, baseY: -0.08, hop: 0.12, hopDurMin: 900, hopDurMax: 1400, travelDur: 1100, arcY: 0.70, fitLogo: 1.92, hareModel: '#rabbitModel', hareX: 0.60, hareZ: -0.30, hareY: -0.08, hareFit: 1.17, hareRot: '0 -90 0' };
    }
  };

  const specForStep = (step) => {
    switch (step) {
      case 'cheburashka':
        // Модель убираем. Для Чебурашки используем только коллайдер таргета + дождь апельсинов
        return null;
      case 'cheburashkastand':
        // Отдельный таргет для стенда Чебурашек: без эффектов
        return null;
      case 'gena':
        // В квесте — тоже без мини‑Ген; эффект нот добавляется отдельно
        return null;
      case 'shapoklyak':
        return { model: '#lariskaModel', scale: '0.4 0.4 0.4', position: '0 -0.05 0', rotation: '0 20 0', mixer: true };
      case 'wolf':
      case 'intro':
      default:
        // В квесте — уменьшили размеры в 1.5 раза; заяц ещё дальше
        return { logoChase: true, rotation: '0 -90 0', rightX: 0.52, leftX: -0.52, baseZ: -0.12, hop: 0.09, hopDurMin: 900, hopDurMax: 1400, travelDur: 1100, holdRight: 2600, holdLeft: 2600, arcY: 0.6, fitLogo: 0.80, hareModel: '#rabbitModel', hareX: 0.52, hareZ: -0.28, hareFit: 0.45, hareRot: '0 -90 0' };
    }
  };

  // Build orange-rain attribute string, using scenes.json config when available
  const buildChebRainAttrib = () => {
    try {
      const cfg = storedSceneConfig?.cheb?.effects?.['orange-rain'];
      const entries = [];
      if (cfg) {
        for (const [k, v] of Object.entries(cfg)) entries.push(`${k}: ${v}`);
      }
      // Принудительно используем сферический коллайдер на узле таргета
      entries.push('collider: #chebCollider');
      entries.push('colliderType: sphere');
      return entries.join('; ');
    } catch (_) {
      return 'enabled: true; rate: 6; area: 0.6; height: 2.0; groundY: -1.12; scale: 0.002; max: 40; gravity: 2.0; life: 8; colliderType: sphere; collider: #chebCollider; visualizeCollider: false';
    }
  };

  const ensureChebCollider = (root) => {
    if (!root) return null;
    let el = root.querySelector('#chebCollider');
    if (!el) {
      el = document.createElement('a-entity');
      el.id = 'chebCollider';
      root.appendChild(el);
    }
    // Смещение к "голове" на таргете (центр сферы)
    el.setAttribute('position', '0 -0.18 0');
    // Визуальная подсказка: сфера по умолчанию радиуса ~0.28 (совпадает с colliderRadius из конфига)
    el.setAttribute('geometry', 'primitive: sphere; radius: 0.34; segmentsWidth: 12; segmentsHeight: 8');
    el.setAttribute('material', 'opacity: 0; transparent: true; color: #000');
    return el;
  };

  const tweakCameraClipping = () => {
    try {
      if (!sceneEl || !sceneEl.camera) return;
      const cam = sceneEl.camera;
      cam.near = 0.01;
      // Use large far plane to avoid clipping when video size race inflates transforms
      cam.far = 50000000; // 5e7
      cam.updateProjectionMatrix();
    } catch (_) {}
  };

  const handleResize = () => {
    tweakCameraClipping();
  };

  // Helper to build MindAR base config for current state or overridden step
  const buildBaseCfg = (stepOverride = null) => {
    const baseCfg = {
      imageTargetSrc: './assets/targets/trio.mind',
      maxTrack: 3,
      showStats: false,
      uiLoading: 'no',
      uiScanning: 'no',
      uiError: 'no',
      missTolerance: 10,
      warmupTolerance: 5,
      filterMinCF: 0.00005,
      filterBeta: 0.001,
      autoStart: false,
    };
    if (simpleWolfOnly || state.mode === 'heroes' || state.mode === 'quest') {
      baseCfg.maxTrack = 1;
      if (state.mode === 'heroes' && state.hero?.mind) {
        baseCfg.imageTargetSrc = (state.hero.key === 'wolf') ? WOLF_MIND : state.hero.mind;
      } else if (state.mode === 'quest') {
        const step = stepOverride || (quest.getStep ? quest.getStep() : 'intro');
        const stepKey = step === 'intro' ? 'wolf' : step;
        baseCfg.imageTargetSrc = (stepKey === 'wolf') ? WOLF_MIND : quest.getMindForStep(step);
      }
    }
    return baseCfg;
  };

  // Restart MindAR with new config (used for step switch)
  const restartMindAR = async (baseCfg) => {
    const mindarSystem = sceneEl.systems['mindar-image-system'];
    if (!mindarSystem) throw new Error('MindAR system is not available');
    try { stopGenaAudio(); } catch (_) {}
    try { await mindarSystem.stop(); } catch (_) {}

    const attrib = [
      `imageTargetSrc: ${baseCfg.imageTargetSrc}`,
      `maxTrack: ${baseCfg.maxTrack}`,
      'uiLoading: no',
      'uiScanning: no',
      'uiError: no',
      `missTolerance: ${baseCfg.missTolerance}`,
      `warmupTolerance: ${baseCfg.warmupTolerance}`,
      `filterMinCF: ${baseCfg.filterMinCF}`,
      `filterBeta: ${baseCfg.filterBeta}`,
      'autoStart: false',
    ].join('; ');
    sceneEl.setAttribute('mindar-image', attrib);
    try { mindarSystem.setup(baseCfg); } catch (error) { console.warn('[AR] setup override failed', error); }
    await mindarSystem.start();
    bindVideoHandlers();
    tweakCameraClipping();
  };

  // Public API: switch quest step (e.g., after photo with wolf → Gena)
  const switchQuestStep = async (nextStep) => {
    if (state.mode !== 'quest') return;
    trioModeActive = false;
    try {
      ui.setTrackingState && ui.setTrackingState('loading');
      try { ui.setInteractionHint('Готовим сцену…'); } catch (_) {}
      // Prepare content for the new step (generic anchor scene)
      await prepareGenericForStep(nextStep);
      // Switch image target to the new step
      const cfg = buildBaseCfg(nextStep);
      await restartMindAR(cfg);
      // Update helper texts
      try {
        if (nextStep === 'gena') {
          ui.setInteractionHint('Наведись на: Крокодил Гена');
          guide.showSubtitles('Наведи камеру на Гену!');
          guide.dockToCorner('tl');
        } else if (nextStep === 'cheburashka') {
          ui.setInteractionHint('Наведись на: Чебурашка');
          guide.showSubtitles('Наведи камеру на Чебурашку!');
          guide.dockToCorner('tl');
        } else if (nextStep === 'cheburashkastand') {
          // Стартовая подсказка для стенда Чебурашек
          ui.setInteractionHint('Наведись на: Чебурашки');
          try {
            if (!quest.isPlayed || !quest.isPlayed('cheburashkastand_intro')) {
              await guide.speak('Наведись на чебурашек! Получи приз!', { ctaNow: true });
              quest.markPlayed && quest.markPlayed('cheburashkastand_intro');
            }
          } catch(_) {}
        } else if (nextStep === 'shapoklyak') {
          ui.setInteractionHint('Наведись на: Шапокляк');
          // Скрываем 3D‑гида до момента фото
          try { guide.setState('hidden'); } catch(_) {}
          guide.showSubtitles('Наведи камеру на Шапокляк!');
        }
      } catch (_) {}
    } catch (e) {
      console.error('[AR] switchQuestStep failed', e);
    }
  };

  // Public API: switch back to multi-target trio.mind (after Shapokляк photo)
  const switchToTrio = async () => {
    try {
      trioModeActive = true;
      restoreAnchorsFromBackup();
      const root = document.getElementById('scene-generic');
      ui.setTrackingState && ui.setTrackingState('loading');
      try { ui.setInteractionHint('Готовим сцену…'); } catch (_) {}
      if (root) {
        await ensureAssetsForStep('trio');
        while (root.firstChild) root.removeChild(root.firstChild);
      }
      const cfg = {
        imageTargetSrc: './assets/targets/trio.mind',
        maxTrack: 3,
        showStats: false,
        uiLoading: 'no',
        uiScanning: 'no',
        uiError: 'no',
        missTolerance: 10,
        warmupTolerance: 5,
        filterMinCF: 0.00005,
        filterBeta: 0.001,
        autoStart: false,
      };
      await restartMindAR(cfg);
      // Build the requested static scenic layout for trio
      try { buildTrioScenery(root); } catch(_) {}
      ui.setTrackingState('lost_trio');
      ui.setInteractionHint('Совместите рамку с трио гены, чебурашки и шапокляк');
      try {
        // Яркий CTA для режима trio
        guide.setCTA('Сфоткайся вместе со всеми! Не забудь улыбнуться!');
        guide.showSubtitles('Сфоткайся вместе со всеми!');
      } catch (_) {}
    } catch (e) {
      console.error('[AR] switchToTrio failed', e);
    }
  };

  return {
    start,
    toggleSelfie,
    stopSelfie: stopSelfieMode,
    isSelfieMode: () => selfieMode,
    isTrioMode: () => trioModeActive,
    getSnapshotSources,
    setSceneConfig,
    isSceneReady: () => sceneReady,
    handleResize,
    isLogoInBigJump: () => wolfBigJumpActive,
    playWolfBigJumpAudio,
    reRequestCameraPermission,
    stopGenaMusic: () => { try { stopGenaAudio(); const root = document.getElementById('scene-generic'); root && root.emit('gena-music-stop'); } catch (_) {} },
    switchQuestStep,
    switchToTrio,
    // Special: Shapoklyak photo reaction — mouse runs away and hides
    shapoklyakOnPhoto: async () => {
      try {
        const root = document.getElementById('scene-generic');
        const mouse = document.getElementById('lariska-actor');
        if (!root || !mouse) return;

        // Stop any ongoing approach cycle
        try { root.emit('effect-stop'); } catch(_) {}

        // Ensure visible and cancel previous anims
        try {
          mouse.setAttribute('visible', 'true');
          mouse.removeAttribute('animation__approach');
          mouse.removeAttribute('animation__back');
          mouse.removeAttribute('animation__grow');
          mouse.removeAttribute('animation__run');
          mouse.removeAttribute('animation__pop');
          mouse.removeAttribute('animation__tilt');
          mouse.removeAttribute('animation__turn');
        } catch(_) {}

        // Quick run to hide behind the scene, then hide
        const p = mouse.object3D?.position || { x: -0.6, y: -0.44, z: -0.06 };
        const hideX = -1000.0; // far left
        const hideZ = 0.35; // behind target plane
        const hideY = p.y || -0.44;
        mouse.setAttribute('animation__run', `property: position; from: ${p.x} ${hideY} ${p.z} ; to: ${hideX} ${hideY} ${hideZ}; dur: 62000; easing: easeInCubic; startEvents: l-run`);
        // Also rotate 180° while starting to run away
        mouse.setAttribute('animation__turn', 'property: rotation; from: 0 90 0; to: 0 -90 0; dur: 300; easing: easeInOutSine; startEvents: l-turn');
        let ran = false;
        const onRunDone = () => { try { mouse.setAttribute('visible', 'false'); } catch(_) {}; ran = true; };
        mouse.addEventListener('animationcomplete__run', onRunDone, { once: true });
        try { mouse.emit('l-turn'); mouse.emit('l-run'); } catch(_) {}

        // Cleanup listener just in case run finished earlier
        if (!ran) {
          try { mouse.removeEventListener('animationcomplete__run', onRunDone); } catch(_) {}
        }
      } catch (e) {
        console.warn('[AR] shapoklyakOnPhoto failed', e);
      }
    },
  };
}
