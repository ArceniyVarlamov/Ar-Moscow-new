import { initUI } from './js/ui.js';
import { createGuideController } from './js/guide.js';
import { createQuestController, mindForHeroKey } from './js/quest.js';
import { loadSceneConfig, applySceneConfig } from './js/scenes.js';
import { createARController } from './js/ar.js';
import { compositeSnapshot } from './js/snapshot.js';
import { createAssetPreloader } from './js/preloader.js';

const SIMPLE_WOLF_ONLY = true;
const SILENT_AUDIO_SRC = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

// Global diagnostics for unhandled Promise rejections (to pinpoint GLTF loader issues)
try {
  window.addEventListener('unhandledrejection', (event) => {
    try { console.warn('[UNHANDLED REJECTION]', event.reason); } catch(_) {}
  });
} catch(_) {}

// Log GLTFLoader URL types to ensure strings are used
try {
  if (window.AFRAME && window.THREE && THREE.GLTFLoader) {
    const OL = THREE.GLTFLoader.prototype.load;
    THREE.GLTFLoader.prototype.load = function(url, onLoad, onProgress, onError){
      try { console.log('[GLTFLoader.load]', { type: typeof url, isString: typeof url === 'string', url }); } catch(_) {}
      return OL.call(this, url, onLoad, onProgress, onError);
    };
  }
} catch(_) {}
// Note: Avoid monkey-patching A-Frame components; ensure all our glTF uses pass '#assetId' strings only.

const sceneEl = document.getElementById('ar-scene');
const anchors = Array.from(sceneEl?.querySelectorAll('[mindar-image-target]') || []);
const arWrapper = document.getElementById('ar-wrapper');
const guideEl = document.getElementById('guide-lariska');

const params = new URLSearchParams(location.search);
const currentScene = params.get('scene') || 'cheb';
 

setActiveScene(params.get('scene') ? currentScene : '');
const subtitlesEl = document.getElementById('subtitles');

const state = {
  mode: null, // 'quest' | 'heroes'
  hero: null, // { key, title, mind }
};

const HERO_TARGET_ACCUSATIVE = {
  cheburashka: 'Чебурашку',
  gena: 'Крокодила Гену',
  wolf: 'Волка',
  shepoklak: 'Шапокляк',
  souzmultipark: 'кучу Чебурашек',
  trio: 'трио героев',
};

const HERO_DISPLAY_NAMES = {
  cheburashka: 'Чебурашка',
  gena: 'Крокодил Гена',
  wolf: 'Волк',
  shepoklak: 'Шапокляк',
  souzmultipark: 'Чебурашки',
  trio: 'Трио',
  lariska: 'Лариска',
};

const heroTargetAccusative = (key, fallback = '') => {
  const normalized = (key || '').toString().toLowerCase();
  return HERO_TARGET_ACCUSATIVE[normalized] || fallback;
};

function setActiveScene(key) {
  const map = { cheb: 'anchor-cheb', shap: 'anchor-shap', wolf: 'anchor-wolf' };
  const activeId = map[key];
  anchors.forEach((anchor) => {
    const defaultShow = anchor.id !== 'anchor-generic';
    const show = activeId ? anchor.id === activeId : defaultShow;
    anchor.setAttribute('visible', show ? 'true' : 'false');
  });
}


const noGuide = params.has('noguide') || params.get('guide') === 'off';
const guide = createGuideController({ guideEl, subtitlesEl, disabled: noGuide });
const quest = createQuestController();

const assetsEl = document.querySelector('a-assets');
const assetPreloader = createAssetPreloader({ assetsEl });

const ui = initUI({
  onStartQuest: handleStartQuest,
  onStartHeroes: handleStartHeroes,
  onBackToLanding: handleBackToLanding,
  onHeroSelect: handleHeroSelect,
  onCameraToggle: handleCameraToggle,
  onCapture: handleCapture,
  onSkipNext: handleSkipNext,
  onCameraPermissionConfirm: handleCameraPermissionConfirm,
  onCameraPermissionCancel: handleCameraPermissionCancel,
});

try { ui.setSkipVisible(false); } catch (_) {}

// Show warmup loader, but keep the Start button clickable.
try {
  ui.setStartQuestEnabled(true);
  ui.showLandingLoader('Подготавливаем квест…', true);
} catch(_) {}

let coreAssetsReady = false;
let pendingCameraLaunch = null;
let pendingCameraContext = null;

const clearPendingCameraRequest = () => {
  pendingCameraLaunch = null;
  pendingCameraContext = null;
};
assetPreloader.waitForGroups(['core'], {
  onProgress: (summary) => {
    const total = summary.total || 1;
    const message = summary.ready
      ? 'Готово! Можно начинать квест.'
      : `Подготавливаем старт… ${summary.loaded}/${total}`;
    ui.showLandingLoader(message, true);
  },
}).then(() => {
  coreAssetsReady = true;
  ui.setStartQuestEnabled(true);
  try {
    guideEl?.setAttribute('gltf-smart', '#lariskaModel');
  } catch (_) {}
}).catch((error) => {
  console.warn('[Preloader] core warmup failed', error);
  coreAssetsReady = false;
  // Keep Start enabled; handleStartQuest will wait for core and surface errors.
  ui.setStartQuestEnabled(true);
  ui.showLandingLoader('Не удалось подготовить квест. Обновите страницу.', true);
});

const arController = createARController({
  sceneEl,
  anchors,
  arWrapper,
  ui,
  guide,
  quest,
  state,
  simpleWolfOnly: SIMPLE_WOLF_ONLY,
  applySceneConfig,
  assetPreloader,
});

// Face tracking removed

window.addEventListener('resize', arController.handleResize);

loadSceneConfig().then((cfg) => {
  if (cfg) arController.setSceneConfig(cfg);
});

const QUEST_STEP_SEQUENCE = ['intro', 'gena', 'cheburashka', 'shapoklyak', 'trio', 'cheburashkastand'];
const stepPrefetchCache = new Map();

const normalizeStep = (step = 'intro') => {
  if (step === 'wolf') return 'intro';
  return step || 'intro';
};

const stepGroups = (step) => {
  const normalized = normalizeStep(step);
  const groups = normalized === 'intro' ? ['core'] : [];
  const groupKey = normalized === 'intro' ? 'step_intro' : `step_${normalized}`;
  if (assetPreloader.groupAssetIds([groupKey]).length > 0) {
    groups.push(groupKey);
  }
  return groups;
};

const getStepDisplayName = (step) => {
  const normalized = normalizeStep(step);
  if (quest && typeof quest.getDisplayName === 'function') {
    const labelKey = normalized === 'intro' ? 'intro' : normalized;
    return quest.getDisplayName(labelKey);
  }
  return normalized;
};

const formatSceneLoaderText = (step, summary) => {
  const name = getStepDisplayName(step) || 'сцену';
  if (!summary || summary.total === 0) {
    return `Загружаем сцену «${name}»…`;
  }
  const percent = Math.min(100, Math.round(summary.progress * 100));
  return `Загружаем сцену «${name}»… ${summary.loaded}/${summary.total} (${percent}%)`;
};

const heroGroupsForKey = (heroKey) => {
  const groups = ['core'];
  const normalized = (heroKey || '').toString().trim();
  if (normalized) groups.push(`hero_${normalized}`);
  return groups;
};

const heroDisplayName = (heroKey, title) => {
  const label = typeof title === 'string' ? title.trim() : '';
  if (label) return label;
  const normalized = (heroKey || '').toString().toLowerCase();
  if (!normalized) return 'героя';
  return HERO_DISPLAY_NAMES[normalized]
    || quest?.getDisplayName?.(normalized)
    || normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatHeroLoaderText = (heroKey, title, summary = null) => {
  const name = heroDisplayName(heroKey, title);
  if (!summary || summary.total === 0) {
    return `Готовим сцену «${name}»…`;
  }
  const percent = Math.min(100, Math.round((summary.progress || 0) * 100));
  return `Готовим сцену «${name}»… ${summary.loaded}/${summary.total} (${percent}%)`;
};

const ensureHeroAssetsWithLoader = async (heroKey, title) => {
  const groups = heroGroupsForKey(heroKey);
  const alreadyLoaded = assetPreloader.areGroupsLoaded(groups);
  ui.showSceneLoader(formatHeroLoaderText(heroKey, title));
  try {
    const summary = await assetPreloader.waitForGroups(groups, {
      autoStart: !alreadyLoaded,
      onProgress: (progress) => {
        ui.updateSceneLoader(formatHeroLoaderText(heroKey, title, progress));
      },
    });
    ui.updateSceneLoader(formatHeroLoaderText(heroKey, title, summary));
    return summary;
  } catch (error) {
    throw error;
  } finally {
    ui.hideSceneLoader();
  }
};

const getNextQuestStep = (step) => {
  const normalized = normalizeStep(step);
  const idx = QUEST_STEP_SEQUENCE.indexOf(normalized);
  if (idx === -1) return null;
  return QUEST_STEP_SEQUENCE[idx + 1] || null;
};

const ensureStepAssetsWithLoader = async (step) => {
  const groups = stepGroups(step);
  const alreadyLoaded = assetPreloader.areGroupsLoaded(groups);
  ui.showSceneLoader(formatSceneLoaderText(step));
  try {
    const summary = await assetPreloader.waitForGroups(groups, {
      autoStart: !alreadyLoaded,
      onProgress: (progress) => {
        ui.updateSceneLoader(formatSceneLoaderText(step, progress));
      },
    });
    ui.updateSceneLoader(formatSceneLoaderText(step, summary));
    return summary;
  } catch (error) {
    throw error;
  } finally {
    ui.hideSceneLoader();
  }
};

const prefetchStepAssets = (step) => {
  const normalized = normalizeStep(step);
  if (!normalized) return;
  const groups = stepGroups(normalized);
  if (groups.length === 0) return;
  if (assetPreloader.areGroupsLoaded(groups)) return;
  if (stepPrefetchCache.has(normalized)) return stepPrefetchCache.get(normalized);
  const promise = assetPreloader.ensureForStep(normalized)
    .catch((error) => {
      console.warn('[Preloader] prefetch failed', normalized, error);
    })
    .finally(() => {
      stepPrefetchCache.delete(normalized);
    });
  stepPrefetchCache.set(normalized, promise);
  return promise;
};

const prefetchNextQuestStep = (currentStep) => {
  const next = getNextQuestStep(currentStep);
  if (!next) return;
  prefetchStepAssets(next);
};

const transitionToQuestStep = async (nextStep) => {
  const normalized = normalizeStep(nextStep);
  await ensureStepAssetsWithLoader(normalized);
  await arController.switchQuestStep(normalized === 'intro' ? 'intro' : normalized);
  prefetchNextQuestStep(normalized);
};

const transitionToTrio = async () => {
  const targetStep = 'trio';
  await ensureStepAssetsWithLoader(targetStep);
  await arController.switchToTrio?.();
  prefetchNextQuestStep(targetStep);
};

async function handleStartQuest() {
  const unlockAttempt = unlockAudioPlayback().catch(() => {});
  state.mode = 'quest';
  state.hero = null;
  quest.reset();
  try { ui.setSkipVisible(true); } catch (_) {}
  try { arController.disableStandClick && arController.disableStandClick(); } catch (_) {}
  clearPendingCameraRequest();
  ui.hideCameraPrompt();
  ui.hideUnsupported();
  guide.setState('hidden');
  guide.clearCTA();
  guide.clearSubtitles();

  const step = normalizeStep(quest.getStep ? quest.getStep() : 'intro');

  if (!coreAssetsReady) {
    try {
      await assetPreloader.waitForGroups(['core']);
      coreAssetsReady = assetPreloader.areGroupsLoaded(['core']);
    } catch (error) {
      console.error('[Preloader] core assets unavailable', error);
      ui.showLanding();
      ui.hideHeroes();
      ui.showLandingLoader('Не удалось подготовить квест. Обновите страницу.', true);
      guide.setState('hidden');
      guide.clearSubtitles();
      guide.clearCTA();
      state.mode = null;
      quest.reset();
      return;
    }
  }

  // Keep landing visible during preload to avoid a blank screen on slow networks

  try {
    await ensureStepAssetsWithLoader(step || 'intro');
  } catch (error) {
    console.error('[Preloader] quest intro load failed', error);
    state.mode = null;
    quest.reset();
    ui.hideSceneLoader();
    ui.showLanding();
    ui.hideHeroes();
    ui.setInteractionHint('Не удалось загрузить сцену. Попробуй ещё раз.');
    guide.setState('hidden');
    guide.clearSubtitles();
    guide.clearCTA();
    return;
  }
  try { await unlockAttempt; } catch(_) {}
  ui.setInteractionHint('Разреши доступ к камере, чтобы продолжить квест.');

  pendingCameraContext = { mode: 'quest', step };
  pendingCameraLaunch = async () => {
    await arController.start();
    ui.setInteractionHint('Найди скульптуру Волка с Зайцем и наведи на неё рамку — Лариска подскажет, что делать дальше!');
    prefetchNextQuestStep(step || 'intro');
  };
  ui.hideSceneLoader();
  ui.showCameraPrompt({
    title: 'Включи камеру',
    message: 'Разреши доступ к камере, чтобы увидеть сцену с Волком.',
    allowLabel: 'Разрешить камеру',
  });
  // Hide background panels after the prompt is visible
  ui.hideHeroes();
  ui.hideLanding();
  try {
    document.getElementById('camera-permission')?.scrollIntoView({ block: 'center' });
    document.getElementById('camera-permission-allow')?.focus?.();
  } catch (_) {}
}

function handleStartHeroes() {
  state.mode = 'heroes';
  state.hero = null;
  quest.reset();
  try { ui.setSkipVisible(false); } catch (_) {}
  try { arController.disableStandClick && arController.disableStandClick(); } catch (_) {}
  clearPendingCameraRequest();
  ui.hideCameraPrompt();
  ui.hideLanding();
  ui.showHeroes();
  guide.setState('hidden');
  guide.clearSubtitles();
  guide.clearCTA();
  ui.hideSceneLoader();
  // Камеру не запрашиваем здесь; запросим при выборе конкретного героя (старт сцены)
}

function handleBackToLanding() {
  state.mode = null;
  state.hero = null;
  quest.reset();
  try { ui.setSkipVisible(false); } catch (_) {}
  try { arController.disableStandClick && arController.disableStandClick(); } catch (_) {}
  ui.hideCameraPrompt();
  clearPendingCameraRequest();
  ui.showLanding();
  ui.hideHeroes();
  ui.exitARMode();
  ui.hideUnsupported();
  guide.setState('hidden');
  guide.clearSubtitles();
  guide.clearCTA();
  arController.stopSelfie();
  ui.hideSceneLoader();
  
}

// Attempt to unlock audio playback on first user gesture (iOS/Chrome autoplay policies)
async function unlockAudioPlayback() {
  if (window.__AUDIO_UNLOCKED) {
    return window.__AUDIO_UNLOCK_PROMISE || Promise.resolve();
  }
  if (window.__AUDIO_UNLOCK_PROMISE) {
    return window.__AUDIO_UNLOCK_PROMISE;
  }

  const run = async () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!window.__UNLOCK_AC) window.__UNLOCK_AC = new AC();
        const ctx = window.__UNLOCK_AC;
        if (ctx && typeof ctx.resume === 'function' && ctx.state === 'suspended') {
          try { await ctx.resume(); } catch (_) {}
        }
      }
    } catch (_) {}

    try {
      const audios = Array.from(document.querySelectorAll('a-assets audio'));
      for (const audioEl of audios) {
        try { audioEl.load?.(); } catch (_) {}
      }
    } catch (_) {}

    try {
      const registry = window.__AUDIO_UNLOCK_SILENT || {};
      window.__AUDIO_UNLOCK_SILENT = registry;
      let silent = registry.el;
      if (!silent) {
        silent = new Audio();
        silent.preload = 'auto';
        silent.crossOrigin = 'anonymous';
        silent.src = SILENT_AUDIO_SRC;
        registry.el = silent;
      }
      silent.muted = true;
      silent.volume = 0;
      // Safari can leave the play() promise pending until visibility changes, so avoid awaiting here.
      const result = silent.play();
      if (result && typeof result.then === 'function') {
        result.catch(() => {});
      }
      try { silent.pause(); } catch (_) {}
      try { silent.currentTime = 0; } catch (_) {}
    } catch (_) {}
  };

  window.__AUDIO_UNLOCK_PROMISE = run()
    .catch((error) => {
      console.warn('[Audio] unlockAudioPlayback failed', error);
    })
    .finally(() => {
      window.__AUDIO_UNLOCKED = true;
    });

  return window.__AUDIO_UNLOCK_PROMISE;
}

async function handleHeroSelect({ key, title }) {
  const unlockAttempt = unlockAudioPlayback().catch(() => {});
  // Use canonical mapping for new targets
  const mind = mindForHeroKey(key);
  state.mode = 'heroes';
  state.hero = { key, title, mind };
  const targetLabel = heroTargetAccusative(key, title);
  try { ui.setSkipVisible(false); } catch (_) {}
  clearPendingCameraRequest();
  ui.hideCameraPrompt();
  ui.hideUnsupported();
  ui.setInteractionHint('Готовим героя…');

  try {
    await ensureHeroAssetsWithLoader(key, title);
  } catch (error) {
    console.error('[Preloader] hero load failed', key, error);
    state.hero = null;
    ui.showHeroes();
    ui.hideLanding();
    ui.setInteractionHint('Не удалось загрузить героя. Попробуй выбрать ещё раз.');
    guide.setState('hidden');
    guide.clearSubtitles();
    guide.clearCTA();
    return;
  }
  try { await unlockAttempt; } catch(_) {}
  // Keep selection screen visible until the permission prompt is shown
  ui.setInteractionHint('Разреши доступ к камере, чтобы увидеть героя.');
  guide.setState('hidden');
  guide.clearSubtitles();
  guide.clearCTA();
  pendingCameraContext = { mode: 'heroes', heroKey: key, title };
  pendingCameraLaunch = async () => {
    await arController.start();
    ui.setInteractionHint(`Наведись на ${targetLabel || title}!`);
  };
  ui.hideSceneLoader();
  ui.showCameraPrompt({
    title: 'Включи камеру',
    message: `Разреши доступ к камере, чтобы увидеть ${targetLabel || title}.`,
    allowLabel: 'Разрешить камеру',
  });
  ui.hideHeroes();
  ui.hideLanding();
  try {
    document.getElementById('camera-permission')?.scrollIntoView({ block: 'center' });
    document.getElementById('camera-permission-allow')?.focus?.();
  } catch (_) {}
}

async function handleCameraPermissionConfirm() {
  if (!pendingCameraLaunch) {
    ui.hideCameraPrompt();
    return;
  }
  ui.setCameraPromptBusy(true);
  ui.setCameraPromptError('');
  try {
    try { await unlockAudioPlayback(); } catch (error) { console.warn('[AR] unlockAudioPlayback before camera access failed', error); }
    if (typeof arController.reRequestCameraPermission === 'function') {
      await arController.reRequestCameraPermission();
    }
  } catch (error) {
    console.warn('[AR] camera permission denied or failed', error);
    ui.setCameraPromptBusy(false);
    ui.setCameraPromptError('Нужно разрешить использование камеры. Проверьте настройки браузера и попробуйте снова.');
    return;
  }

  const launch = pendingCameraLaunch;
  clearPendingCameraRequest();
  ui.hideCameraPrompt();
  try {
    await launch?.();
  } catch (error) {
    console.error('[AR] failed to launch AR after camera permission', error);
    ui.exitARMode();
    ui.showUnsupported();
    guide.setState('hidden');
    guide.clearSubtitles();
    guide.clearCTA();
  }
}

function handleCameraPermissionCancel() {
  ui.hideCameraPrompt();
  if (!pendingCameraContext) {
    clearPendingCameraRequest();
    return;
  }
  const context = pendingCameraContext;
  clearPendingCameraRequest();
  if (context.mode === 'quest') {
    state.mode = null;
    state.hero = null;
    quest.reset();
    ui.showLanding();
    ui.hideHeroes();
    ui.setInteractionHint('Совмести рамку с изображением персонажа.');
  } else if (context.mode === 'heroes') {
    state.mode = 'heroes';
    state.hero = null;
    ui.hideLanding();
    ui.showHeroes();
    ui.setInteractionHint('Выбери героя и затем разреши доступ к камере.');
  }
  guide.setState('hidden');
  guide.clearSubtitles();
  guide.clearCTA();
}

function handleCameraToggle() {
  arController.toggleSelfie().catch((error) => {
    console.warn('[AR] selfie toggle failed', error);
    ui.setCameraLabel('Камера: задняя');
  });
}

async function handleCapture() {
  ui.setCaptureEnabled(false);
  try {
    const isShapoklyak = state.mode === 'quest' && quest.getStep() === 'shapoklyak';
    const sources = arController.getSnapshotSources();
    const dataUrl = await compositeSnapshot(sources, { vintage: isShapoklyak });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `souzmultipark-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    ui.setCaptureLabel('Готово!');

    // Проигрываем wolf mp3 только для фото с Волком
    const isWolfPhotoInQuest = state.mode === 'quest' && ['intro','wolf'].includes(quest.getStep());
    const isWolfPhotoInHeroes = state.mode === 'heroes' && state.hero?.key === 'wolf';
    const shouldPlayWolfAudio = isWolfPhotoInQuest || isWolfPhotoInHeroes;
    if (shouldPlayWolfAudio) {
      try {
        if (arController.playWolfBigJumpAudio) {
          await arController.playWolfBigJumpAudio();
        }
      } catch (e) { console.warn('[AR] wolf jump audio failed', e); }
      // Небольшая пауза только если воспроизводили звук
      await new Promise(r => setTimeout(r, 2000));
    }
    
    // Ветвление квеста по текущему шагу/режиму. Важно: обрабатываем ровно одну ветку за снимок.
    const isQuest = state.mode === 'quest';
    const step = quest.getStep && quest.getStep();
    const isTrio = !!(arController.isTrioMode && arController.isTrioMode());

    if (isQuest && ['intro','wolf'].includes(step)) {
      // 1-2. Мышка увеличивается и говорит фразы (не уводим в угол во время речи)
      await guide.speak('Получилась отличная фотка!', { dock: false });
      await guide.speak('Пойдём к Гене, он нам сыграет на гармошке!', { dock: false });

      // 3. Мышка уменьшается и пишет подсказку
      guide.dockToCorner('tl');
      guide.showSubtitles('Наведись на Гену!');

      // 4. Переключаемся на таргет Гены (gena.mind)
      quest.setStep('gena');
      try { await transitionToQuestStep('gena'); }
      catch (e) {
        console.warn('[AR] step switch to Gena failed', e);
        ui.setInteractionHint('Не удалось загрузить сцену. Попробуй ещё раз.');
      }
      // 5. Музыка включится автоматически при наведении (targetFound @ step=gena)
    } else if (isQuest && step === 'gena') {
      // Остановить музыку Гены при фото
      try { arController.stopGenaMusic && arController.stopGenaMusic(); } catch(_) {}
      // Переход от Гены к Чебурашке
      await new Promise((r)=> setTimeout(r, 1000));
      await guide.speak('А теперь пойдём к чебурашке! Он покажет тебе свои сокровища!', { dock: false });
      guide.dockToCorner('tl');
      guide.showSubtitles('Наведи камеру на Чебурашку!');
      // Убираем таргет Гены и переключаемся на Чебурашку (cheburashka.mind)
      quest.setStep('cheburashka');
      try { await transitionToQuestStep('cheburashka'); }
      catch (e) {
        console.warn('[AR] step switch to Cheburashka failed', e);
        ui.setInteractionHint('Не удалось загрузить сцену. Попробуй ещё раз.');
      }
    } else if (isQuest && step === 'cheburashka') {
      // После фото с Чебурашкой: через секунду мышка всплывает, говорит фразу, затем уменьшается и переключаем таргет на Шапокляк
      await new Promise((r)=> setTimeout(r, 1000));
      await guide.speak('Отлично! Давай теперь к Шепокляк, я где-то возле неё прячусь, попробуй меня найти!');
      // После speak мышка автоматически уходит в угол (уменьшается)
      // Переключаемся на этап Шапокляк
      quest.setStep('shapoklyak');
      try { await transitionToQuestStep('shapoklyak'); }
      catch (e) {
        console.warn('[AR] step switch to Shapoklyak failed', e);
        ui.setInteractionHint('Не удалось загрузить сцену. Попробуй ещё раз.');
      }
      // face tracking removed
    } else if (isQuest && step === 'shapoklyak' && !isTrio) {
      // Фото на Шапокляк: мышка убегает, гид говорит фразу и переводим на трио
      try { arController.shapoklyakOnPhoto && arController.shapoklyakOnPhoto(); } catch(_) {}
      try {
        await guide.speak('Ах! Не получилось съесть сыр! Ну ничего! Давай сфоткаемся со всеми и потом пойдём в парк!', { dock: false });
      } catch (_) {}
      try { await transitionToTrio(); }
      catch (e) {
        console.warn('[AR] switch to trio failed', e);
        ui.setInteractionHint('Не удалось загрузить сцену. Попробуй ещё раз.');
      }
      // Зафиксируем состояние трио в квесте, чтобы на следующем кадре не повторять фразу Шапокляк
      quest.setStep('trio');
    } else if (isQuest && isTrio) {
      // Фото с трио: мышка-гид становится большой и говорит фразу
      try {
        await guide.speak('Пойдём теперь во внутрь парка! Там очень интересно!', { dock: false });
      } catch(_) {}
      // Переключаем таргет на cheburashkastand.mind
      quest.setStep('cheburashkastand');
      try { await transitionToQuestStep('cheburashkastand'); }
      catch (e) {
        console.warn('[AR] switch to cheburashkastand failed', e);
        ui.setInteractionHint('Не удалось загрузить сцену. Попробуй ещё раз.');
      }
      // Стартовая подсказка для стенда озвучивается внутри switchQuestStep (ar.js) и не дублируется здесь
    }

    // В одиночном режиме: если выбран Гена — выключаем музыку при снимке
    if (state.mode === 'heroes' && state.hero?.key === 'gena') {
      try { arController.stopGenaMusic && arController.stopGenaMusic(); } catch(_) {}
    }
  } catch (error) {
    console.warn('[AR] snapshot failed', error);
  } finally {
    ui.setCaptureLabel('Сделать кадр');
    ui.setCaptureEnabled(true);
  }
}

async function handleSkipNext() {
  if (state.mode !== 'quest') return;
  const step = normalizeStep(quest.getStep());
  let next = null;
  if (step === 'intro') next = 'gena';
  else if (step === 'gena') next = 'cheburashka';
  else if (step === 'cheburashka') next = 'shapoklyak';
  else if (step === 'shapoklyak') next = 'trio';
  else if (step === 'trio') next = 'cheburashkastand';

  if (!next) return;
  // Останавливаем музыку Гены при переходе вперёд
  if (step === 'gena') { try { arController.stopGenaMusic && arController.stopGenaMusic(); } catch(_) {} }

  if (next === 'trio') {
    // Переход с Шапокляк на трио
    quest.setStep('trio');
    try { await transitionToTrio(); }
    catch (e) {
      console.warn('[AR] skip switch to trio failed', e);
      ui.setInteractionHint('Не удалось загрузить сцену. Попробуй ещё раз.');
    }
    // Яркий CTA/сабтайтлы выставятся внутри switchToTrio
    return;
  }

  // Обычные подсказки для остальных шагов
  guide.dockToCorner('tl');
  guide.showSubtitles(next === 'gena' ? 'Наведи камеру на Гену!' : next === 'cheburashka' ? 'Наведи камеру на Чебурашку!' : next === 'cheburashkastand' ? 'Наведись на чебурашек! Получи приз!' : 'Наведи камеру на Шапокляк!');
  quest.setStep(next);
  try { await transitionToQuestStep(next); }
  catch (e) {
    console.warn('[AR] skip switch failed', e);
    ui.setInteractionHint('Не удалось загрузить сцену. Попробуй ещё раз.');
  }
  // face tracking removed
}

// face tracking helpers removed
