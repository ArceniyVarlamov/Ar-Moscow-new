const noop = () => {};

export function initUI({
  onStartQuest = noop,
  onStartHeroes = noop,
  onBackToLanding = noop,
  onHeroSelect = noop,
  onCameraToggle = noop,
  onCapture = noop,
  onSkipNext = noop,
} = {}) {
  const landingScreen = document.getElementById('landing-screen');
  const startQuestBtn = document.getElementById('start-quest');
  const startHeroesBtn = document.getElementById('start-heroes');
  const heroesPanel = document.getElementById('heroes-panel');
  const heroesBackBtn = document.getElementById('back-to-landing');
  const heroButtons = Array.from(document.querySelectorAll('#heroes-panel .hero'));

  const arWrapper = document.getElementById('ar-wrapper');
  const unsupportedPanel = document.getElementById('unsupported');
  const trackingStatus = document.getElementById('tracking-status');
  const interactionHint = document.getElementById('interaction-hint');
  const captureButton = document.getElementById('capture');
  const cameraToggle = document.getElementById('camera-toggle');
  const skipNextBtn = document.getElementById('skip-next');
  const preloadBox = document.getElementById('preload-status');
  const preloadText = document.getElementById('preload-text');

  startQuestBtn?.addEventListener('click', () => { onStartQuest(); });
  startHeroesBtn?.addEventListener('click', () => { onStartHeroes(); });
  heroesBackBtn?.addEventListener('click', () => { onBackToLanding(); });

  heroButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      const title = btn.textContent?.trim() || '';
      onHeroSelect({ key, title });
    });
  });

  captureButton?.addEventListener('click', (event) => {
    event.preventDefault();
    if (captureButton.disabled) return;
    onCapture();
  });

  cameraToggle?.addEventListener('click', (event) => {
    event.preventDefault();
    if (!document.body.classList.contains('ar-active')) return;
    onCameraToggle();
  });

  skipNextBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    onSkipNext();
  });

  function hide(el) { el && el.classList.add('hidden'); }
  function show(el) { el && el.classList.remove('hidden'); }

  function enterARMode() {
    document.body.classList.add('ar-active');
    show(arWrapper);
    hide(unsupportedPanel);
  }

  function exitARMode() {
    document.body.classList.remove('ar-active');
    hide(arWrapper);
  }

  function showLanding() { show(landingScreen); }
  function hideLanding() { hide(landingScreen); }
  function showHeroes() { show(heroesPanel); }
  function hideHeroes() { hide(heroesPanel); }
  function showUnsupported() { show(unsupportedPanel); }
  function hideUnsupported() { hide(unsupportedPanel); }

  function setTrackingState(state) {
    if (!trackingStatus) return;
    switch (state) {
      case 'loading':
        trackingStatus.textContent = 'Загружаем сцену…';
        trackingStatus.classList.remove('status--positive');
        setCaptureEnabled(false);
        break;
      case 'lost':
        trackingStatus.textContent = 'Ищем скульптуру…';
        trackingStatus.classList.remove('status--positive');
        setCaptureEnabled(false);
        break;
      case 'lost_trio':
        trackingStatus.textContent = 'Ищем скульптуры…';
        trackingStatus.classList.remove('status--positive');
        setCaptureEnabled(false);
        break;
      default:
        break;
    }
  }

  function setTrackingFoundMessage(text) {
    if (!trackingStatus) return;
    trackingStatus.textContent = text;
    trackingStatus.classList.add('status--positive');
  }

  function setInteractionHint(text) {
    if (!interactionHint) return;
    interactionHint.textContent = text || '';
  }

  function setCaptureEnabled(enabled) {
    if (!captureButton) return;
    captureButton.disabled = !enabled;
  }

  function setCaptureLabel(text) {
    if (!captureButton) return;
    captureButton.textContent = text;
  }

  function setCameraLabel(text) {
    if (!cameraToggle) return;
    cameraToggle.textContent = text;
  }

  return {
    enterARMode,
    exitARMode,
    showLanding,
    hideLanding,
    showHeroes,
    hideHeroes,
    showUnsupported,
    hideUnsupported,
    setTrackingState,
    setTrackingFoundMessage,
    setInteractionHint,
    setCaptureEnabled,
    setCaptureLabel,
    setCaptureVisible: (visible) => { if (captureButton) captureButton.style.display = visible ? '' : 'none'; },
    setCameraLabel,
    getArWrapper: () => arWrapper,
    getTrackingStatusEl: () => trackingStatus,
    getInteractionHintEl: () => interactionHint,
    setSkipVisible: (visible) => { if (skipNextBtn) skipNextBtn.style.display = visible ? '' : 'none'; },
    setStartQuestEnabled: (enabled) => { if (startQuestBtn) startQuestBtn.disabled = !enabled; },
    setStartHeroesEnabled: (enabled) => { if (startHeroesBtn) startHeroesBtn.disabled = !enabled; },
    showLandingLoader: (text, visible=true) => {
      if (!preloadBox) return;
      if (typeof text === 'string' && preloadText) preloadText.textContent = text;
      preloadBox.classList.toggle('hidden', !visible);
    },
  };
}
