const HERO_MIND_MAP = {
  wolf: './assets/targets/wolf.mind',
  // new marker files
  gena: './assets/targets/gena.mind',
  shepoklak: './assets/targets/shepoklak.mind',
  lariska: './assets/targets/lariska.mind',
  trio: './assets/targets/trio.mind',
  souzmultipark: './assets/targets/cheburashkastand.mind',
};

const STEP_MIND_MAP = {
  wolf: HERO_MIND_MAP.wolf,
  gena: HERO_MIND_MAP.gena,
  shapoklyak: HERO_MIND_MAP.shepoklak,
  'find-mouse': HERO_MIND_MAP.lariska,
  cheburashka: './assets/targets/cheburashka.mind',
  cheburashkastand: './assets/targets/cheburashkastand.mind',
};

const STEP_LABEL_MAP = {
  wolf: 'Волк',
  gena: 'Крокодил Гена',
  shapoklyak: 'Шапокляк',
  cheburashka: 'Чебурашка',
  cheburashkastand: 'Чебурашки',
};

export function mindForHeroKey(key) {
  if (!key) return `./assets/targets/${key}.mind`;
  return HERO_MIND_MAP[key] || `./assets/targets/${key}.mind`;
}

export function mindForStep(step) {
  return STEP_MIND_MAP[step] || HERO_MIND_MAP.wolf;
}

export function displayNameForStep(step) {
  return STEP_LABEL_MAP[step] || 'Сцена';
}

export function createQuestController() {
  let step = 'intro';
  const played = new Set();

  const reset = () => {
    step = 'intro';
    played.clear();
  };

  const getStep = () => step;
  const setStep = (next) => { step = next; };
  const markPlayed = (key) => { if (key) played.add(key); };
  const isPlayed = (key) => played.has(key);

  return {
    reset,
    getStep,
    setStep,
    markPlayed,
    isPlayed,
    getMindForStep: mindForStep,
    getMindForHero: mindForHeroKey,
    getDisplayName: displayNameForStep,
  };
}
