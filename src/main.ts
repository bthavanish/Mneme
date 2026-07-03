import './styles/tokens.css';
import './styles/layout.css';
import './styles/animations.css';

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

import { startCamera } from './lib/camera';
import { loadDetector, detectObjects, getObjectDetectionInterval } from './lib/detector';
import { loadFaceModels, detectFaces, rebuildMatcher, getFaceInterval, getFaceApi } from './lib/faceEngine';
import { saveFace, clearAllFaces, isStorageAvailable } from './lib/faceStore';
import { hasConsent, setConsent } from './lib/consent';
import { setupCanvases, drawObjectBoxes, drawFaceBoxes, clearCanvas } from './ui/canvas';
import { initSidebar, renderFaceList } from './ui/sidebar';
import { showToast } from './ui/toast';
import { initModeToggle, getCurrentMode } from './ui/modeToggle';
import { initDetectionLog, logObjectDetections, logFaceDetections } from './ui/detectionLog';
import { initTheme, setTheme, toggleTheme, getStoredTheme, isDark } from './lib/theme';

import type { SavedFace, AppMode, Settings } from './types';

let settings: Settings = loadSettings();
let objectBusy = false;
let faceBusy = false;

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

// Loading progress helpers
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

async function init() {
  // Initialize dynamic theme first
  await initTheme();

  const loadingScreen = document.getElementById('loading-screen')!;
  const app = document.getElementById('app')!;

  let runningPct = 0;

  function advanceToStep(step: string, state: 'active' | 'done' | 'error') {
    const base = Object.keys(STEP_WEIGHTS)
      .slice(0, Object.keys(STEP_WEIGHTS).indexOf(step))
      .reduce((sum, s) => sum + (STEP_WEIGHTS[s] || 0), 0);

    if (state === 'active') {
      runningPct = base * 100;
    } else if (state === 'done') {
      runningPct = (base + STEP_WEIGHTS[step]) * 100;
    }

    updateProgress(step, state, runningPct);
  }

  try {
    const videoEl = document.getElementById('video-feed') as HTMLVideoElement;

    // Only load what the current mode needs
    const mode = getCurrentMode();
    const needsObjects = mode === 'objects' || mode === 'both';
    const needsFaces = (mode === 'faces' || mode === 'both') && hasConsent();

    advanceToStep('camera', 'active');
    await startCamera(videoEl);
    setupCanvases(videoEl);
    advanceToStep('camera', 'done');

    advanceToStep('tf', 'active');
    await (window as any).tf.ready();
    advanceToStep('tf', 'done');

    if (needsObjects) {
      advanceToStep('objects', 'active');
      await loadDetector();
      advanceToStep('objects', 'done');
    } else {
      advanceToStep('objects', 'done');
    }

    if (needsFaces) {
      advanceToStep('faces', 'active');
      const modelUrl = import.meta.env.BASE_URL + 'models';
      await loadFaceModels(modelUrl);
      advanceToStep('faces', 'done');
    } else {
      advanceToStep('faces', 'done');
    }

    if (hasConsent()) {
      await rebuildMatcher();
    }

    // Transition to app
    app.style.display = '';
    loadingScreen.classList.add('fade-out');
    setTimeout(() => loadingScreen.remove(), 600);

    initUI();
    startDetectionLoops();
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
    // If switching to a mode that needs models we haven't loaded, load them lazily
    lazyLoadForMode(mode);
  });

  updateModeUI(getCurrentMode());

  // Sidebar
  initSidebar();

  // Detection log
  initDetectionLog();

  // Settings
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

  // Theme toggle
  const btnTheme = document.getElementById('btn-theme')!;
  btnTheme.addEventListener('click', () => {
    const next = toggleTheme();
    const icon = btnTheme.querySelector('md-icon');
    if (icon) icon.textContent = next === 'dark' ? 'light_mode' : 'dark_mode';
    showToast(`Switched to ${next} mode`);
  });

  // Theme switch in settings
  const themeSwitch = document.getElementById('theme-switch') as any;
  const storedTheme = getStoredTheme();
  themeSwitch.selected = storedTheme === 'dark' ||
    (storedTheme === 'system' && isDark());

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

  // Settings controls
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
  });

  // Delete all faces
  const btnDeleteAll = document.getElementById('btn-delete-all-faces')!;
  btnDeleteAll.addEventListener('click', async () => {
    await clearAllFaces();
    await rebuildMatcher();
    showToast('All face data deleted');
    renderFaceList();
  });

  // Add face FAB
  const btnAddFace = document.getElementById('btn-add-face')!;
  btnAddFace.addEventListener('click', () => handleAddFace());

  // Face memory off chip
  document.getElementById('face-off-chip')?.addEventListener('click', () => {
    (document.getElementById('consent-dialog') as any).open = true;
  });

  // Consent dialog
  const consentDialog = document.getElementById('consent-dialog') as any;
  const consentForm = document.getElementById('consent-form')!;

  if (!hasConsent()) {
    consentDialog.open = true;
  }

  consentForm.addEventListener('submit', async (e: Event) => {
    const formEvent = e as SubmitEvent;
    const value = formEvent.submitter ? (formEvent.submitter as HTMLElement).textContent : '';
    consentDialog.open = false;

    if (value?.includes('Got it')) {
      const available = await isStorageAvailable();
      if (!available) {
        showToast("Storage isn't available — face memory disabled.");
        return;
      }
      setConsent(true);
      // Load face models if not already loaded
      const mode = getCurrentMode();
      if (mode === 'faces' || mode === 'both') {
        const modelUrl = import.meta.env.BASE_URL + 'models';
        await loadFaceModels(modelUrl);
      }
      await rebuildMatcher();
      showToast('Face memory enabled');
    } else {
      setConsent(false);
      updateModeUI(getCurrentMode());
    }
  });

  // Retry camera
  document.getElementById('btn-retry-camera')?.addEventListener('click', () => {
    window.location.reload();
  });
}

async function lazyLoadForMode(mode: AppMode): Promise<void> {
  const needsObjects = mode === 'objects' || mode === 'both';
  const needsFaces = (mode === 'faces' || mode === 'both') && hasConsent();

  try {
    if (needsObjects) {
      await loadDetector();
    }
    if (needsFaces) {
      const modelUrl = import.meta.env.BASE_URL + 'models';
      await loadFaceModels(modelUrl);
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

  const videoEl = document.getElementById('video-feed') as HTMLVideoElement;
  const addFaceDialog = document.getElementById('add-face-dialog') as any;
  const nameInput = document.getElementById('face-name-input') as HTMLInputElement;
  const addFaceForm = document.getElementById('add-face-form')!;
  const api = getFaceApi();

  const offscreen = document.createElement('canvas');
  offscreen.width = videoEl.videoWidth || 1280;
  offscreen.height = videoEl.videoHeight || 720;
  const offCtx = offscreen.getContext('2d')!;
  offCtx.drawImage(videoEl, 0, 0);

  const allDetections = await api
    .detectAllFaces(offscreen, new api.TinyFaceDetectorOptions())
    .withFaceLandmarks();

  if (allDetections.length > 1) {
    showToast('Multiple faces in frame. Try adding one at a time.');
    return;
  }

  const detection = await api
    .detectSingleFace(offscreen, new api.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    showToast("Didn't spot a face in that shot. Try moving closer.");
    return;
  }

  const box = detection.detection.box;
  const pad = 20;
  const cropX = Math.max(0, box.x - pad);
  const cropY = Math.max(0, box.y - pad);
  const cropW = Math.min(offscreen.width - cropX, box.width + pad * 2);
  const cropH = Math.min(offscreen.height - cropY, box.height + pad * 2);

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 80;
  thumbCanvas.height = 80;
  const thumbCtx = thumbCanvas.getContext('2d')!;
  thumbCtx.drawImage(offscreen, cropX, cropY, cropW, cropH, 0, 0, 80, 80);
  const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.7);

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
      descriptor: Array.from(detection.descriptor),
      addedAt: Date.now(),
      thumbnail,
    };

    await saveFace(face);
    await rebuildMatcher();
    showToast(`Saved ${name}`);
    renderFaceList();

    addFaceDialog.open = false;
    addFaceForm.removeEventListener('submit', handleFormSubmit);
  };

  addFaceForm.addEventListener('submit', handleFormSubmit);
}

function startDetectionLoops() {
  const videoEl = document.getElementById('video-feed') as HTMLVideoElement;

  function objectLoop() {
    const mode = getCurrentMode();
    if ((mode === 'objects' || mode === 'both') && !objectBusy) {
      objectBusy = true;
      detectObjects(videoEl, settings.detectThreshold).then((detections) => {
        drawObjectBoxes('overlay-objects', detections, settings.showConfidence);
        logObjectDetections(detections);
        objectBusy = false;
      });
    }
    if (mode === 'faces') clearCanvas('overlay-objects');
    setTimeout(objectLoop, getObjectDetectionInterval());
  }

  function faceLoop() {
    const mode = getCurrentMode();
    if ((mode === 'faces' || mode === 'both') && hasConsent() && !faceBusy) {
      faceBusy = true;
      detectFaces(videoEl).then(({ detections, names }) => {
        drawFaceBoxes('overlay-faces', detections, names);
        logFaceDetections(names);
        faceBusy = false;
      });
    }
    if (mode === 'objects') clearCanvas('overlay-faces');
    setTimeout(faceLoop, getFaceInterval());
  }

  objectLoop();
  faceLoop();
}

init();
