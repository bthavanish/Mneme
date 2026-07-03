import './styles/tokens.css';
import './styles/layout.css';
import './styles/animations.css';
import './styles/about.css';

// MD3 web components — individual imports only
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/text-button.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/fab/fab.js';
import '@material/web/dialog/dialog.js';
import '@material/web/switch/switch.js';
import '@material/web/slider/slider.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
import '@material/web/divider/divider.js';
import '@material/web/chips/assist-chip.js';
import '@material/web/progress/circular-progress.js';

import { startCamera, stopCamera } from './lib/camera';
import { loadDetector, detectObjects } from './lib/detector';
import { loadFaceModels, detectFaces, rebuildMatcher, getFaceApi } from './lib/faceEngine';
import { saveFace, clearAllFaces, isStorageAvailable } from './lib/faceStore';
import { hasConsent, setConsent } from './lib/consent';
import { setupCanvases, drawObjectBoxes, drawFaceBoxes, clearCanvas } from './ui/canvas';
import { initSidebar, renderFaceList } from './ui/sidebar';
import { showToast } from './ui/toast';
import { initModeToggle, getCurrentMode } from './ui/modeToggle';
import { initDetectionLog, logObjectDetections, logFaceDetections } from './ui/detectionLog';
import { initTheme, setTheme, toggleTheme, getStoredTheme, isDark } from './lib/theme';
import { renderAboutPage, prefetchManifest } from './pages/about';

import type { SavedFace, AppMode, Settings } from './types';
import { isMobile } from './lib/device';

let settings: Settings = loadSettings();
let objectBusy = false;
let faceBusy = false;
let faceModelsLoaded = false;
let objectModelLoaded = false;
let currentFacingMode: 'user' | 'environment' = 'user';
let lastFaceDetection: { descriptor: Float32Array; thumbnail: string } | null = null;

// Pre-allocated canvas elements for thumbnail capture (avoid GC pressure)
const thumbCanvas = document.createElement('canvas');
thumbCanvas.width = 80;
thumbCanvas.height = 80;
const thumbCtx = thumbCanvas.getContext('2d')!;
const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d')!;


function loadSettings(): Settings {
  return {
    showConfidence: localStorage.getItem('show_confidence') !== 'false',
    mirrorVideo: localStorage.getItem('mirror_video') === 'true',
    detectThreshold: parseFloat(localStorage.getItem('detect_threshold') || '0.5'),
    faceThreshold: parseFloat(localStorage.getItem('face_threshold') || '0.5'),
    theme: (localStorage.getItem('theme') as Settings['theme']) || 'system',
  };
}

function saveSettings(): void {
  localStorage.setItem('show_confidence', String(settings.showConfidence));
  localStorage.setItem('mirror_video', String(settings.mirrorVideo));
  localStorage.setItem('detect_threshold', String(settings.detectThreshold));
  localStorage.setItem('face_threshold', String(settings.faceThreshold));
  localStorage.setItem('theme', settings.theme);
}

// Loading progress
const STEP_WEIGHTS: Record<string, number> = {
  camera: 0.15,
  tf: 0.25,
  objects: 0.30,
  faces: 0.30,
};
const STEP_LABELS: Record<string, string> = {
  camera: 'Accessing camera...',
  tf: 'Initializing TensorFlow.js...',
  objects: 'Loading object detector...',
  faces: 'Loading face recognition models...',
};

function updateProgress(step: string, state: 'active' | 'done' | 'error', pct: number): void {
  const fill = document.getElementById('loading-progress-fill');
  const label = document.getElementById('loading-progress-label');
  const pctEl = document.getElementById('loading-progress-pct');
  const steps = document.querySelectorAll('.md3-loading-step');

  steps.forEach((el) => {
    const s = el as HTMLElement;
    if (s.dataset.step === step) {
      s.classList.remove('active', 'done', 'error');
      s.classList.add(state);
    }
  });

  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = state === 'error' ? `Failed: ${step}` : (STEP_LABELS[step] || 'Initializing...');
  if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
}

function waitForConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    const consentCard = document.getElementById('consent-card')!;
    const progressSection = document.getElementById('loading-progress-section')!;
    const stepsSection = document.getElementById('loading-steps')!;

    // Hide progress, show consent card
    progressSection.style.display = 'none';
    stepsSection.style.display = 'none';
    consentCard.style.display = '';

    // Small delay for animation
    requestAnimationFrame(() => {
      consentCard.classList.add('md3-consent-card--visible');
    });

    const btnAccept = document.getElementById('consent-accept')!;
    const btnDecline = document.getElementById('consent-decline')!;

    const cleanup = () => {
      btnAccept.removeEventListener('click', onAccept);
      btnDecline.removeEventListener('click', onDecline);
    };

    const onAccept = async () => {
      cleanup();
      const available = await isStorageAvailable();
      if (!available) {
        consentCard.classList.remove('md3-consent-card--visible');
        setTimeout(() => {
          consentCard.style.display = 'none';
          progressSection.style.display = '';
          stepsSection.style.display = '';
        }, 300);
        showToast("Storage unavailable — face memory disabled");
        resolve(false);
        return;
      }
      setConsent(true);
      consentCard.classList.remove('md3-consent-card--visible');
      setTimeout(() => {
        consentCard.style.display = 'none';
        progressSection.style.display = '';
        stepsSection.style.display = '';
      }, 300);
      resolve(true);
    };

    const onDecline = () => {
      cleanup();
      setConsent(false);
      consentCard.classList.remove('md3-consent-card--visible');
      setTimeout(() => {
        consentCard.style.display = 'none';
        progressSection.style.display = '';
        stepsSection.style.display = '';
      }, 300);
      resolve(false);
    };

    btnAccept.addEventListener('click', onAccept);
    btnDecline.addEventListener('click', onDecline);
  });
}

async function showConsentCard(): Promise<void> {
  return new Promise((resolve) => {
    const consentCard = document.getElementById('consent-card')!;
    const loadingScreen = document.getElementById('loading-screen');

    // Create a temporary overlay if loading screen is gone
    let overlay: HTMLDivElement | null = null;
    if (!loadingScreen || loadingScreen.classList.contains('fade-out')) {
      overlay = document.createElement('div');
      overlay.className = 'md3-consent-overlay';
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay!.classList.add('md3-consent-overlay--visible'));
    }

    // Show consent card
    consentCard.style.display = '';
    consentCard.classList.add('md3-consent-card--visible');

    const btnAccept = document.getElementById('consent-accept')!;
    const btnDecline = document.getElementById('consent-decline')!;

    const hideCard = () => {
      consentCard.classList.remove('md3-consent-card--visible');
      setTimeout(() => {
        consentCard.style.display = 'none';
        if (overlay) {
          overlay.classList.remove('md3-consent-overlay--visible');
          setTimeout(() => overlay?.remove(), 300);
        }
      }, 300);
    };

    const cleanup = () => {
      btnAccept.removeEventListener('click', onAccept);
      btnDecline.removeEventListener('click', onDecline);
    };

    const onAccept = async () => {
      cleanup();
      hideCard();
      const available = await isStorageAvailable();
      if (!available) {
        showToast("Storage unavailable — face memory disabled");
        resolve();
        return;
      }
      setConsent(true);
      const mode = getCurrentMode();
      if ((mode === 'faces' || mode === 'both') && !faceModelsLoaded) {
        try {
          const modelUrl = import.meta.env.BASE_URL + 'models';
          await loadFaceModels(modelUrl);
          faceModelsLoaded = true;
          await rebuildMatcher();
        } catch {}
      }
      await rebuildMatcher();
      showToast('Face memory enabled');
      updateModeUI(getCurrentMode());
      resolve();
    };

    const onDecline = () => {
      cleanup();
      hideCard();
      setConsent(false);
      updateModeUI(getCurrentMode());
      resolve();
    };

    btnAccept.addEventListener('click', onAccept);
    btnDecline.addEventListener('click', onDecline);
  });
}

async function init() {
  await initTheme();

  const loadingScreen = document.getElementById('loading-screen')!;
  const app = document.getElementById('app')!;
  let runningPct = 0;

  function advanceToStep(step: string, state: 'active' | 'done' | 'error') {
    const base = Object.keys(STEP_WEIGHTS)
      .slice(0, Object.keys(STEP_WEIGHTS).indexOf(step))
      .reduce((sum, s) => sum + (STEP_WEIGHTS[s] || 0), 0);

    if (state === 'active') runningPct = base * 100;
    else if (state === 'done') runningPct = (base + STEP_WEIGHTS[step]) * 100;

    updateProgress(step, state, runningPct);
  }

  try {
    const videoEl = document.getElementById('video-feed') as HTMLVideoElement;
    const mode = getCurrentMode();

    // Step 1: Load TensorFlow.js
    advanceToStep('tf', 'active');
    await (window as any).tf.ready();
    advanceToStep('tf', 'done');

    // Step 2: Consent — shown inline in loading screen if not yet given
    if (!hasConsent()) {
      const consented = await waitForConsent();
      if (consented) {
        advanceToStep('faces', 'active');
        const modelUrl = import.meta.env.BASE_URL + 'models';
        try {
          await loadFaceModels(modelUrl);
          faceModelsLoaded = true;
          await rebuildMatcher();
        } catch (err: any) {
          console.warn('[mneme] face model load failed:', err.message);
        }
        advanceToStep('faces', 'done');
      } else {
        advanceToStep('faces', 'done');
      }
    } else {
      // Already consented — load face models
      advanceToStep('faces', 'active');
      const modelUrl = import.meta.env.BASE_URL + 'models';
      try {
        await loadFaceModels(modelUrl);
        faceModelsLoaded = true;
        await rebuildMatcher();
      } catch (err: any) {
        console.warn('[mneme] face model load failed:', err.message);
      }
      advanceToStep('faces', 'done');
    }

    // Step 3: Start camera
    advanceToStep('camera', 'active');
    await startCamera(videoEl);
    setupCanvases(videoEl);
    advanceToStep('camera', 'done');

    // Step 4: Load object detection model
    if (mode === 'objects' || mode === 'both') {
      advanceToStep('objects', 'active');
      await loadDetector();
      objectModelLoaded = true;
      advanceToStep('objects', 'done');
    } else {
      advanceToStep('objects', 'done');
    }

    // Step 5: Show app, dismiss loading screen
    app.style.display = '';
    loadingScreen.classList.add('fade-out');
    setTimeout(() => loadingScreen.remove(), 600);

    initUI();
    startDetectionLoops();
    prefetchManifest();
  } catch (err: any) {
    app.style.display = '';
    loadingScreen.classList.add('fade-out');
    setTimeout(() => loadingScreen.remove(), 600);

    const errorEl = document.getElementById('camera-error');
    if (errorEl) errorEl.style.display = 'flex';
    console.warn('[mneme] startup error:', err.message);
  }
}

function initUI() {
  const videoEl = document.getElementById('video-feed') as HTMLVideoElement;

  // Mode toggle
  initModeToggle((mode: AppMode) => {
    updateModeUI(mode);
    lazyLoadForMode(mode);
    // Immediately clear stale canvas from previous mode
    if (mode === 'faces') clearCanvas('overlay-objects');
    if (mode === 'objects') clearCanvas('overlay-faces');
  });

  updateModeUI(getCurrentMode());
  initSidebar();
  initDetectionLog();

  // === Settings ===
  const settingsSheet = document.getElementById('settings-sheet')!;
  const btnSettings = document.getElementById('btn-settings')!;
  const btnCloseSettings = document.getElementById('btn-close-settings')!;
  const scrim = document.getElementById('scrim')!;

  btnSettings.addEventListener('click', () => {
    settingsSheet.classList.add('open');
    scrim.classList.add('visible');
  });

  btnCloseSettings.addEventListener('click', () => {
    settingsSheet.classList.remove('open');
    scrim.classList.remove('visible');
  });

  // Scrim click closes everything
  scrim.addEventListener('click', () => {
    settingsSheet.classList.remove('open');
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('mobile-log-sheet')?.classList.remove('open');
    scrim.classList.remove('visible');
  });

  // === Theme toggle ===
  const btnTheme = document.getElementById('btn-theme')!;
  btnTheme.addEventListener('click', () => {
    const next = toggleTheme();
    const icon = btnTheme.querySelector('md-icon');
    if (icon) icon.textContent = next === 'dark' ? 'light_mode' : 'dark_mode';
    showToast(`Switched to ${next} mode`);
  });

  const themeSwitch = document.getElementById('theme-switch') as any;
  const storedTheme = getStoredTheme();
  themeSwitch.selected = storedTheme === 'dark' || (storedTheme === 'system' && isDark());

  const icon = btnTheme.querySelector('md-icon');
  if (icon) icon.textContent = isDark() ? 'light_mode' : 'dark_mode';

  themeSwitch.addEventListener('change', () => {
    settings.theme = themeSwitch.selected ? 'dark' : 'light';
    setTheme(settings.theme);
    saveSettings();
    const themeIcon = btnTheme.querySelector('md-icon');
    if (themeIcon) themeIcon.textContent = isDark() ? 'light_mode' : 'dark_mode';
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredTheme() === 'system') {
      setTheme('system');
      const themeIcon = btnTheme.querySelector('md-icon');
      if (themeIcon) themeIcon.textContent = isDark() ? 'light_mode' : 'dark_mode';
    }
  });

  // === Settings controls ===
  const showConfidenceSwitch = document.getElementById('show-confidence') as any;
  const mirrorSwitch = document.getElementById('mirror-video') as any;
  const detectSlider = document.getElementById('detect-threshold') as any;
  const faceSlider = document.getElementById('face-threshold') as any;
  const detectVal = document.getElementById('detect-threshold-val')!;
  const faceVal = document.getElementById('face-threshold-val')!;

  showConfidenceSwitch.selected = settings.showConfidence;
  mirrorSwitch.selected = settings.mirrorVideo;
  detectSlider.value = settings.detectThreshold;
  faceSlider.value = settings.faceThreshold;
  detectVal.textContent = String(settings.detectThreshold);
  faceVal.textContent = String(settings.faceThreshold);

  showConfidenceSwitch.addEventListener('change', () => {
    settings.showConfidence = showConfidenceSwitch.selected;
    saveSettings();
  });

  mirrorSwitch.addEventListener('change', () => {
    settings.mirrorVideo = mirrorSwitch.selected;
    saveSettings();
    videoEl.style.transform = settings.mirrorVideo ? 'scaleX(-1)' : '';
  });

  detectSlider.addEventListener('input', () => {
    settings.detectThreshold = parseFloat(detectSlider.value);
    detectVal.textContent = String(detectSlider.value);
    saveSettings();
  });

  faceSlider.addEventListener('input', () => {
    settings.faceThreshold = parseFloat(faceSlider.value);
    faceVal.textContent = String(faceSlider.value);
    saveSettings();
    rebuildMatcher(settings.faceThreshold);
  });

  // === Delete all faces ===
  document.getElementById('btn-delete-all-faces')?.addEventListener('click', async () => {
    await clearAllFaces();
    await rebuildMatcher();
    showToast('All face data deleted');
    renderFaceList();
  });

  // === Add face FAB ===
  document.getElementById('btn-add-face')?.addEventListener('click', () => handleAddFace());

  // === Face memory off chip ===
  document.getElementById('face-off-chip')?.addEventListener('click', () => showConsentCard());

  // === Camera switch ===
  document.getElementById('btn-switch-camera')?.addEventListener('click', async () => {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    try {
      stopCamera();
      const videoEl2 = document.getElementById('video-feed') as HTMLVideoElement;
      await startCamera(videoEl2, currentFacingMode);
      setupCanvases(videoEl2);
      showToast(`Camera: ${currentFacingMode === 'user' ? 'Front' : 'Back'}`);
    } catch {
      showToast('Failed to switch camera');
      currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    }
  });

  // === Retry camera ===
  document.getElementById('btn-retry-camera')?.addEventListener('click', () => {
    window.location.reload();
  });

  // === About page ===
  const aboutPage = document.getElementById('about-page')!;
  const btnAbout = document.getElementById('btn-about')!;
  const btnCloseAbout = document.getElementById('btn-close-about');

  btnAbout.addEventListener('click', () => {
    renderAboutPage();
    aboutPage.getBoundingClientRect(); // force reflow before animation
    requestAnimationFrame(() => aboutPage.classList.add('open'));
    // Force animation replay on cards
    aboutPage.querySelectorAll('.about-how-card').forEach(el => {
      (el as HTMLElement).style.animationName = 'none';
      requestAnimationFrame(() => {
        (el as HTMLElement).style.animationName = '';
      });
    });
  });

  if (btnCloseAbout) {
    btnCloseAbout.addEventListener('click', () => {
      aboutPage.classList.remove('open');
    });
  }
}

async function lazyLoadForMode(mode: AppMode): Promise<void> {
  try {
    if ((mode === 'objects' || mode === 'both') && !objectModelLoaded) {
      await loadDetector();
      objectModelLoaded = true;
    }
    if ((mode === 'faces' || mode === 'both') && hasConsent() && !faceModelsLoaded) {
      const modelUrl = import.meta.env.BASE_URL + 'models';
      await loadFaceModels(modelUrl);
      faceModelsLoaded = true;
      await rebuildMatcher();
    }
  } catch (err: any) {
    console.warn('[mneme] lazy load error:', err.message);
  }
}

function updateModeUI(mode: AppMode): void {
  const btnAddFace = document.getElementById('btn-add-face')!;
  const faceChipArea = document.getElementById('face-chip-area')!;
  const btnFaceLibrary = document.getElementById('btn-face-library')!;
  const consentGiven = hasConsent();

  if (mode === 'faces' || mode === 'both') {
    if (!consentGiven) {
      faceChipArea.style.display = 'flex';
      btnAddFace.style.display = 'none';
      btnFaceLibrary.style.display = 'none';
    } else {
      faceChipArea.style.display = 'none';
      btnAddFace.style.display = '';
      btnFaceLibrary.style.display = '';
    }
  } else {
    faceChipArea.style.display = 'none';
    btnAddFace.style.display = 'none';
    btnFaceLibrary.style.display = 'none';
  }
}

async function handleAddFace() {
  if (!hasConsent()) {
    showToast('Enable face memory in settings first');
    return;
  }

  // Ensure face models are loaded before detection
  if (!faceModelsLoaded) {
    showToast('Loading face models...');
    try {
      const modelUrl = import.meta.env.BASE_URL + 'models';
      await loadFaceModels(modelUrl);
      faceModelsLoaded = true;
      await rebuildMatcher();
    } catch {
      showToast('Failed to load face models');
      return;
    }
  }

  const addFaceDialog = document.getElementById('add-face-dialog') as any;
  const nameInput = document.getElementById('face-name-input') as HTMLInputElement;
  const addFaceForm = document.getElementById('add-face-form')!;

  // Use cached detection from the live loop
  if (!lastFaceDetection) {
    showToast('No face detected. Look at the camera and try again.');
    return;
  }

  const descriptor = lastFaceDetection.descriptor;
  const thumbnail = lastFaceDetection.thumbnail;

  addFaceDialog.open = true;
  nameInput.value = '';

  const handleFormSubmit = async (e: Event) => {
    e.preventDefault();
    const formEvent = e as SubmitEvent;

    if (formEvent.submitter) {
      const val = (formEvent.submitter as HTMLElement).textContent;
      if (val?.includes('Cancel')) {
        addFaceDialog.open = false;
        addFaceForm.removeEventListener('submit', handleFormSubmit);
        return;
      }
    }

    const name = nameInput.value.trim();
    if (!name) {
      showToast('Type a name first');
      return;
    }

    const face: SavedFace = {
      id: crypto.randomUUID(),
      name,
      descriptor: Array.from(descriptor),
      addedAt: Date.now(),
      thumbnail,
    };

    await saveFace(face);
    await rebuildMatcher();
    lastFaceDetection = null;
    showToast(`Saved ${name}`);
    renderFaceList();

    addFaceDialog.open = false;
    addFaceForm.removeEventListener('submit', handleFormSubmit);
  };

  addFaceForm.addEventListener('submit', handleFormSubmit);
}

function startDetectionLoops() {
  const videoEl = document.getElementById('video-feed') as HTMLVideoElement;

  let paused = false;
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
  });

  // Frame skip counters
  let objectFrameSkip = 0;
  let faceFrameSkip = 0;
  let OBJECT_SKIP = isMobile ? 8 : 5;
  let FACE_SKIP = isMobile ? 20 : 12;

  // Adaptive FPS governor
  const frameDurations: number[] = [];
  let lastFrameTime = performance.now();

  function runObjectDetect() {
    const mode = getCurrentMode();
    if ((mode === 'objects' || mode === 'both') && objectModelLoaded && !objectBusy) {
      objectBusy = true;
      detectObjects(videoEl, settings.detectThreshold).then((detections) => {
        drawObjectBoxes('overlay-objects', detections, settings.showConfidence);
        logObjectDetections(detections);
        objectBusy = false;
      });
    }
    if (mode === 'faces') clearCanvas('overlay-objects');
  }

  function runFaceDetect() {
    const mode = getCurrentMode();
    const api = getFaceApi();
    if ((mode === 'faces' || mode === 'both') && hasConsent() && faceModelsLoaded && !faceBusy && api?.nets?.tinyFaceDetector?.isLoaded) {
      faceBusy = true;
      detectFaces(videoEl).then(({ detections, names }) => {
        drawFaceBoxes('overlay-faces', detections, names);
        logFaceDetections(names);
        if (detections.length > 0 && videoEl.videoWidth > 0) {
          try {
            if (offscreenCanvas.width !== videoEl.videoWidth || offscreenCanvas.height !== videoEl.videoHeight) {
              offscreenCanvas.width = videoEl.videoWidth;
              offscreenCanvas.height = videoEl.videoHeight;
            }
            offscreenCtx.drawImage(videoEl, 0, 0);
            const box = (detections[0] as any).detection.box;
            const pad = 20;
            const cropX = Math.max(0, box.x - pad);
            const cropY = Math.max(0, box.y - pad);
            const cropW = Math.min(offscreenCanvas.width - cropX, box.width + pad * 2);
            const cropH = Math.min(offscreenCanvas.height - cropY, box.height + pad * 2);
            thumbCtx.drawImage(offscreenCanvas, cropX, cropY, cropW, cropH, 0, 0, 80, 80);
            lastFaceDetection = {
              descriptor: (detections[0] as any).descriptor,
              thumbnail: thumbCanvas.toDataURL('image/jpeg', 0.7),
            };
          } catch {}
        }
        faceBusy = false;
      }).catch((err: any) => {
        console.warn('[mneme] face detect error:', err.message);
        faceBusy = false;
      });
    }
    if (mode === 'objects') clearCanvas('overlay-faces');
  }

  function rafLoop() {
    if (paused) {
      requestAnimationFrame(rafLoop);
      return;
    }

    // Adaptive FPS governor
    const now = performance.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;
    frameDurations.push(dt);
    if (frameDurations.length > 10) frameDurations.shift();
    if (frameDurations.length >= 10) {
      const avg = frameDurations.reduce((a, b) => a + b, 0) / frameDurations.length;
      if (avg > 150) {
        OBJECT_SKIP = Math.min(OBJECT_SKIP + 1, isMobile ? 16 : 10);
        FACE_SKIP = Math.min(FACE_SKIP + 1, isMobile ? 40 : 24);
      } else if (avg < 80) {
        OBJECT_SKIP = Math.max(OBJECT_SKIP - 1, isMobile ? 4 : 3);
        FACE_SKIP = Math.max(FACE_SKIP - 1, isMobile ? 10 : 8);
      }
    }

    objectFrameSkip++;
    faceFrameSkip++;
    if (objectFrameSkip >= OBJECT_SKIP) { objectFrameSkip = 0; runObjectDetect(); }
    if (faceFrameSkip >= FACE_SKIP) { faceFrameSkip = 0; runFaceDetect(); }
    requestAnimationFrame(rafLoop);
  }

  requestAnimationFrame(rafLoop);
}

init();
