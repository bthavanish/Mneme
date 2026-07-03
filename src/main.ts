import './styles/tokens.css';
import './styles/layout.css';
import './styles/animations.css';

import { startCamera } from './lib/camera';
import { loadDetector, detectObjects, getObjectDetectionInterval } from './lib/detector';
import { loadFaceModels, detectFaces, rebuildMatcher, getFaceInterval, getFaceApi } from './lib/faceEngine';
import { saveFace, clearAllFaces, isStorageAvailable } from './lib/faceStore';
import { hasConsent, setConsent } from './lib/consent';
import { setupCanvases, drawObjectBoxes, drawFaceBoxes, clearCanvas } from './ui/canvas';
import { initSidebar, renderFaceList } from './ui/sidebar';
import { showToast } from './ui/toast';
import { initModeToggle, getCurrentMode } from './ui/modeToggle';

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

async function init() {
  const loadingScreen = document.getElementById('loading-screen')!;
  const app = document.getElementById('app')!;
  const steps = document.querySelectorAll('.loading-step');

  function markStep(name: string, state: 'active' | 'done' | 'error') {
    steps.forEach((el) => {
      const step = el as HTMLElement;
      if (step.dataset.step === name) {
        step.classList.remove('active', 'done', 'error');
        step.classList.add(state);
      }
    });
  }

  try {
    markStep('camera', 'active');
    const videoEl = document.getElementById('video-feed') as HTMLVideoElement;
    await startCamera(videoEl);
    setupCanvases(videoEl);
    markStep('camera', 'done');

    markStep('tf', 'active');
    await (window as any).tf.ready();
    markStep('tf', 'done');

    markStep('objects', 'active');
    await loadDetector();
    markStep('objects', 'done');

    markStep('faces', 'active');
    const modelUrl = import.meta.env.BASE_URL + 'models';
    await loadFaceModels(modelUrl);
    markStep('faces', 'done');

    if (hasConsent()) {
      await rebuildMatcher();
    }

    app.style.display = '';
    loadingScreen.classList.add('fade-out');
    setTimeout(() => loadingScreen.remove(), 400);

    initUI();
    startDetectionLoops();
  } catch (err: any) {
    app.style.display = '';
    loadingScreen.classList.add('fade-out');
    setTimeout(() => loadingScreen.remove(), 400);

    const errorEl = document.getElementById('camera-error')!;
    if (errorEl) errorEl.style.display = 'flex';
    console.warn('[mneme] startup error:', err.message);
  }
}

function initUI() {
  const videoEl = document.getElementById('video-feed') as HTMLVideoElement;

  initModeToggle((mode: AppMode) => {
    updateModeUI(mode);
  });

  updateModeUI(getCurrentMode());

  initSidebar();

  // Settings
  const settingsSheet = document.getElementById('settings-sheet')!;
  const btnSettings = document.getElementById('btn-settings')!;
  const btnCloseSettings = document.getElementById('btn-close-settings')!;
  const scrim = document.getElementById('scrim')!;

  btnSettings.addEventListener('click', () => {
    settingsSheet.classList.toggle('open');
    scrim.classList.toggle('visible', settingsSheet.classList.contains('open'));
  });
  btnCloseSettings.addEventListener('click', () => {
    settingsSheet.classList.remove('open');
    scrim.classList.remove('visible');
  });

  // Theme toggle
  const btnTheme = document.getElementById('btn-theme')!;
  btnTheme.addEventListener('click', () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveSettings();
    showToast(`Switched to ${settings.theme}`);
  });

  // Theme switch in settings
  const themeSwitch = document.getElementById('theme-switch') as any;
  themeSwitch.selected = settings.theme === 'dark' ||
    (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  themeSwitch.addEventListener('change', () => {
    settings.theme = themeSwitch.selected ? 'dark' : 'light';
    applyTheme();
    saveSettings();
  });

  // Listen for system preference changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.theme === 'system') applyTheme();
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

  // Face memory off chip re-enables consent
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
      await rebuildMatcher();
      showToast('Face memory enabled');
    } else {
      setConsent(false);
      updateModeUI(getCurrentMode());
    }
  });

  applyTheme();
}

function applyTheme(): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && prefersDark);

  document.documentElement.classList.toggle('theme-dark', useDark);

  const icon = document.querySelector('#btn-theme md-icon');
  if (icon) icon.textContent = useDark ? 'light_mode' : 'dark_mode';
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

  // check for multiple faces first
  const allDetections = await api
    .detectAllFaces(offscreen, new api.TinyFaceDetectorOptions())
    .withFaceLandmarks();

  if (allDetections.length > 1) {
    showToast('Multiple faces in frame. Try adding one at a time.');
    return;
  }

  // get single face with descriptor
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
