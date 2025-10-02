import { initUI } from './js/ui.js';
import { createGuideController } from './js/guide.js';
import { createQuestController, mindForHeroKey } from './js/quest.js';
import { loadSceneConfig, applySceneConfig } from './js/scenes.js';
import { createARController } from './js/ar.js';
import { compositeSnapshot } from './js/snapshot.js';
import { createAssetPreloader } from './js/preloader.js';
 

const SIMPLE_WOLF_ONLY = true;

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
const assetPreloader = createAssetPreloader({
  assetsEl,
  onStateChange: (state) => {
    try {
      // Progress for quest warmup (core + step_intro)
      const ids = assetPreloader.groupAssetIds(['core','step_intro']);
      const status = state.statusById || {};
      const total = ids.length || 1;
      const loaded = ids.filter((id)=> status[id] === 'loaded').length;
      if (loaded < total) ui.showLandingLoader(`Подготавливаем квест… ${loaded}/${total}` , true);
      else ui.showLandingLoader('Готово! Можно начинать квест.', true);
    } catch(_) {}
  }
});
// Warm critical bundles for quest start
const coreReady = assetPreloader.ensureCore();
const questWarmup = assetPreloader.ensureForStep('intro');
Promise.all([coreReady, questWarmup]).then(() => {
  ui.setStartQuestEnabled(true);
  ui.showLandingLoader('Готово! Можно начинать квест.', true);
  try {
    // Bind guide model only after core assets exist to avoid early glTF errors
    guideEl?.setAttribute('gltf-smart', '#lariskaModel');
  } catch(_) {}
  assetPreloader.warmupGroups([
    'step_gena',
    'step_cheburashka',
    'step_shapoklyak',
    'step_cheburashkastand',
    'step_trio',
  ]);
}).catch((error) => {
  console.warn('[Preloader] core warmup failed', error);
  ui.setStartQuestEnabled(false);
  ui.showLandingLoader('Не удалось подготовить квест. Обновите страницу.', true);
});

const ui = initUI({
  onStartQuest: handleStartQuest,
  onStartHeroes: handleStartHeroes,
  onBackToLanding: handleBackToLanding,
  onHeroSelect: handleHeroSelect,
  onCameraToggle: handleCameraToggle,
  onCapture: handleCapture,
  onSkipNext: handleSkipNext,
});

// Disable quest start until warmup completes; show loader
try {
  ui.setStartQuestEnabled(false);
  ui.showLandingLoader('Подготавливаем квест…', true);
} catch(_) {}

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

async function handleStartQuest() {
  state.mode = 'quest';
  state.hero = null;
  quest.reset();
  ui.hideUnsupported();
  guide.setState('hidden');
  guide.clearCTA();
  guide.clearSubtitles();
  ui.setInteractionHint('Готовим сцену…');
  const step = quest.getStep ? quest.getStep() : 'intro';
  try {
    await assetPreloader.ensureForStep(step || 'intro');
  } catch (error) {
    console.error('[Preloader] quest intro load failed', error);
    state.mode = null;
    quest.reset();
    ui.showLanding();
    ui.hideHeroes();
    ui.setInteractionHint('Не удалось загрузить сцену. Попробуйте ещё раз.');
    guide.setState('hidden');
    guide.clearSubtitles();
    guide.clearCTA();
    return;
  }
  ui.setInteractionHint('Иди по подсказкам и наводи камеру на таблички у статуй.');
  ui.hideLanding();
  ui.hideHeroes();
  // Запрашиваем доступ к камере повторно по нажатию кнопки "Квест"
  try { if (arController.reRequestCameraPermission) await arController.reRequestCameraPermission(); } catch(_) {}
  await arController.start();
}

function handleStartHeroes() {
  state.mode = 'heroes';
  state.hero = null;
  quest.reset();
  ui.hideLanding();
  ui.showHeroes();
  guide.setState('hidden');
  guide.clearSubtitles();
  guide.clearCTA();
  // Камеру не запрашиваем здесь; запросим при выборе конкретного героя (старт сцены)
}

function handleBackToLanding() {
  state.mode = null;
  state.hero = null;
  quest.reset();
  ui.showLanding();
  ui.hideHeroes();
  ui.exitARMode();
  ui.hideUnsupported();
  guide.setState('hidden');
  guide.clearSubtitles();
  guide.clearCTA();
  arController.stopSelfie();
  
}

async function handleHeroSelect({ key, title }) {
  // Use canonical mapping for new targets
  const mind = mindForHeroKey(key);
  state.mode = 'heroes';
  state.hero = { key, title, mind };
  ui.hideUnsupported();
  ui.setInteractionHint('Готовим героя…');
  try {
    await assetPreloader.ensureForHero(key);
  } catch (error) {
    console.error('[Preloader] hero load failed', key, error);
    state.hero = null;
    ui.showHeroes();
    ui.hideLanding();
    ui.setInteractionHint('Не удалось загрузить героя. Попробуйте выбрать ещё раз.');
    guide.setState('hidden');
    guide.clearSubtitles();
    guide.clearCTA();
    return;
  }
  ui.hideHeroes();
  ui.hideLanding();
  ui.setInteractionHint(`Наведись на: ${title}`);
  guide.setState('hidden');
  guide.clearSubtitles();
  guide.clearCTA();
  // Повторно запрашиваем доступ к камере при выборе конкретного персонажа
  try { if (arController.reRequestCameraPermission) await arController.reRequestCameraPermission(); } catch(_) {}
  await arController.start();
  
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
      try { await arController.switchQuestStep('gena'); } catch (e) { console.warn('[AR] step switch to Gena failed', e); }
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
      try { await arController.switchQuestStep('cheburashka'); } catch (e) { console.warn('[AR] step switch to Cheburashka failed', e); }
    } else if (isQuest && step === 'cheburashka') {
      // После фото с Чебурашкой: через секунду мышка всплывает, говорит фразу, затем уменьшается и переключаем таргет на Шапокляк
      await new Promise((r)=> setTimeout(r, 1000));
      await guide.speak('Отлично! Давай теперь к Шепокляк, я где-то возле неё прячусь, попробуй меня найти!');
      // После speak мышка автоматически уходит в угол (уменьшается)
      // Переключаемся на этап Шапокляк
      quest.setStep('shapoklyak');
      try { await arController.switchQuestStep('shapoklyak'); } catch (e) { console.warn('[AR] step switch to Shapoklyak failed', e); }
      // face tracking removed
    } else if (isQuest && step === 'shapoklyak' && !isTrio) {
      // Фото на Шапокляк: мышка убегает, гид говорит фразу и переводим на трио
      try { arController.shapoklyakOnPhoto && arController.shapoklyakOnPhoto(); } catch(_) {}
      try {
        await guide.speak('Ах! Не получилось съесть сыр! Ну ничего! Давай сфоткаемся со всеми и потом пойдём в парк!', { dock: false });
      } catch (_) {}
      try { arController.switchToTrio && await arController.switchToTrio(); } catch(_) {}
      // Зафиксируем состояние трио в квесте, чтобы на следующем кадре не повторять фразу Шапокляк
      quest.setStep('trio');
    } else if (isQuest && isTrio) {
      // Фото с трио: мышка-гид становится большой и говорит фразу
      try {
        await guide.speak('Пойдём теперь во внутрь парка! Там очень интересно!', { dock: false });
      } catch(_) {}
      // Переключаем таргет на cheburashkastand.mind
      quest.setStep('cheburashkastand');
      try { await arController.switchQuestStep('cheburashkastand'); } catch (e) { console.warn('[AR] switch to cheburashkastand failed', e); }
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

function handleSkipNext() {
  if (state.mode !== 'quest') return;
  const step = quest.getStep();
  let next = null;
  if (step === 'intro' || step === 'wolf') next = 'gena';
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
    arController.switchToTrio?.().catch((e)=> console.warn('[AR] skip switch to trio failed', e));
    // Яркий CTA/сабтайтлы выставятся внутри switchToTrio
    return;
  }

  // Обычные подсказки для остальных шагов
  guide.dockToCorner('tl');
  guide.showSubtitles(next === 'gena' ? 'Наведи камеру на Гену!' : next === 'cheburashka' ? 'Наведи камеру на Чебурашку!' : next === 'cheburashkastand' ? 'Наведись на чебурашек! Получи приз!' : 'Наведи камеру на Шапокляк!');
  quest.setStep(next);
  arController.switchQuestStep(next).catch((e)=> console.warn('[AR] skip switch failed', e));
  // face tracking removed
}

// face tracking helpers removed
