/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * main.ts - entry point, does everything
 * models are downloaded to IndexedDB on first load
 */

import './styles/tokens.css';
import './styles/layout.css';
import './styles/animations.css';

import { startCamera, stopCamera } from './lib/camera';
import { detectObjects, detectImageObjects, reloadDetector, isDetectorStored, deleteStoredDetector } from './lib/detector';
import { loadFaceModels, detectFaces, rebuildMatcher, getFaceApi, areFaceModelsStored } from './lib/faceEngine';
import { saveFace, clearAllFaces, deleteFacesForMemory, isStorageAvailable } from './lib/faceStore';
import { hasConsent, setConsent, hasDownloadedModels, setDownloadedModels } from './lib/consent';
import { setupCanvases, drawObjectBoxes, drawFaceBoxes, setMirror, clearCanvas } from './ui/canvas';
import { showToast } from './ui/toast';
import { initTabToggle, getCurrentTab } from './ui/modeToggle';
import { initDetectionLog, addObjectDetections, addFaceDetections } from './ui/detectionLog';
import { getDeviceProfile, logDeviceProfile } from './lib/deviceProfile';
import { InferenceScheduler } from './lib/inferenceScheduler';
import { saveMemoryItem, getAllMemoryItems, deleteMemoryItem } from './lib/memoryStore';
import { downloadModelFile, isModelStored, clearAllModels, installModelFetchCache, setModelDownloadProgressListener } from './lib/modelStore';

import type { AppTab, Settings, SavedFace, MemoryItem, MemorySample, DetectorModel } from './types';
import { DETECTOR_MODELS } from './types';

let settings: Settings = loadSettings();
let faceModelsLoaded = false;
let objectModelLoaded = false;
let currentFacingMode: 'user' | 'environment' = 'user';
let scheduler: InferenceScheduler | null = null;
let capturedBlobs: Blob[] = [];
let captureType: 'person' | 'object' = 'person';
let modelSwitching = false;

let generalEnabled = true;
let faceEnabled = false;
let cameraEnabled = true;
let lastFaceNames: string[] = [];
let savedObjectLabels = new Map<string, string>();

function loadSettings(): Settings {
  return {
    showConfidence: localStorage.getItem('show_confidence') !== 'false',
    mirrorVideo: localStorage.getItem('mirror_video') === 'true',
    detectThreshold: parseFloat(localStorage.getItem('detect_threshold') || '0.5'),
    faceThreshold: parseFloat(localStorage.getItem('face_threshold') || '0.6'),
    detectorModel: (localStorage.getItem('detector_model') as DetectorModel) || 'auto',
  };
}

function saveSettings(): void {
  localStorage.setItem('show_confidence', String(settings.showConfidence));
  localStorage.setItem('mirror_video', String(settings.mirrorVideo));
  localStorage.setItem('detect_threshold', String(settings.detectThreshold));
  localStorage.setItem('face_threshold', String(settings.faceThreshold));
  localStorage.setItem('detector_model', settings.detectorModel);
}

async function refreshSavedObjectLabels(): Promise<void> {
  const items = await getAllMemoryItems();
  const labels = new Map<string, string>();
  for (const item of items) {
    if (item.type !== 'object' || !item.enabled) continue;
    for (const sample of item.samples) for (const label of sample.labels || []) labels.set(label, item.name);
  }
  savedObjectLabels = labels;
}

/** Index older object samples once so Sample mode also works for memories saved before label support. */
async function indexSavedObjectSamples(): Promise<void> {
  if (!objectModelLoaded) return;
  const items = await getAllMemoryItems();
  for (const item of items) {
    if (item.type !== 'object' || item.samples.every(sample => sample.labels !== undefined)) continue;
    let changed = false;
    for (const sample of item.samples) {
      if (sample.labels !== undefined) continue;
      const imageUrl = URL.createObjectURL(sample.image);
      try {
        const img = new Image();
        img.src = imageUrl;
        await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('Could not read saved object sample')); });
        sample.labels = [...new Set((await detectImageObjects(img)).map(detection => detection.class))];
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
      changed = true;
    }
    if (changed) await saveMemoryItem(item);
  }
  await refreshSavedObjectLabels();
}

/** Build descriptors for person memories that were saved before face indexing succeeded. */
async function indexSavedPersonSamples(): Promise<void> {
  if (!faceModelsLoaded) return;
  const api = getFaceApi();
  const items = await getAllMemoryItems();
  let matcherChanged = false;
  for (const item of items) {
    if (item.type !== 'person') continue;
    let itemChanged = false;
    for (const sample of item.samples) {
      if (sample.embedding !== undefined) continue;
      const imageUrl = URL.createObjectURL(sample.image);
      try {
        const img = new Image();
        img.src = imageUrl;
        await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('Could not read saved person sample')); });
        const detection = await api.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
        // An empty array marks a processed image without a clear face, avoiding
        // repeated expensive attempts until the user replaces that sample.
        sample.embedding = detection ? Array.from(detection.descriptor) : [];
        if (detection) {
          await saveFace({ id: crypto.randomUUID(), memoryItemId: item.id, name: item.name, descriptor: sample.embedding, addedAt: Date.now(), thumbnail: '' });
          matcherChanged = true;
        }
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
      itemChanged = true;
    }
    if (itemChanged) await saveMemoryItem(item);
  }
  if (matcherChanged) await rebuildMatcher();
}

async function hasSavedSamples(): Promise<boolean> {
  return (await getAllMemoryItems()).some(item => item.enabled && item.samples.length > 0);
}

async function ensureFaceRecognitionReady(): Promise<boolean> {
  if (!hasConsent()) return false;
  if (faceModelsLoaded) return true;
  try {
    if (!(await areFaceModelsStored())) {
      // The user has already granted model consent. Repair a partial/legacy
      // cache here instead of directing them to a Settings action that cannot
      // download face files.
      showToast('Restoring saved face model files…');
      await downloadFaceModels();
      if (!(await areFaceModelsStored())) throw new Error('face model files are still incomplete');
      setDownloadedModels(true);
    }
    await loadFaceModels();
    faceModelsLoaded = true;
    await rebuildMatcher();
    return true;
  } catch (error) {
    console.error('[mneme] saved face model could not be loaded:', error);
    showToast('Face model recovery failed — check the connection once');
    return false;
  }
}

// ============================================================
// loading screen
// ============================================================

const loadingLogEl = document.getElementById('loading-log')!;
const loadingStatusEl = document.getElementById('loading-status-text')!;
const loadingEtaEl = document.getElementById('loading-eta')!;
const progressContainer = document.getElementById('progress-container')!;
const progressFill = document.getElementById('progress-fill')!;
const progressPercent = document.getElementById('progress-percent')!;
const progressSpeed = document.getElementById('progress-speed')!;
const progressSize = document.getElementById('progress-size')!;
let loadStartTime = 0;
let stepCount = 4;
let completedSteps = 0;

function logLine(text: string, cls?: string): void {
  const line = document.createElement('div');
  line.className = 'loading-log__line' + (cls ? ` loading-log__line--${cls}` : '');
  line.textContent = text;
  loadingLogEl.appendChild(line);
  loadingLogEl.scrollTop = loadingLogEl.scrollHeight;
}

function updateEta(): void {
  const elapsed = performance.now() - loadStartTime;
  if (completedSteps < 2) { loadingEtaEl.textContent = ''; return; }
  const avg = elapsed / completedSteps;
  const remaining = Math.max(0, Math.ceil(avg * (stepCount - completedSteps) / 1000));
  loadingEtaEl.textContent = remaining > 0 ? `~${remaining}s remaining` : 'finishing...';
}

function setLoadingStatus(text: string): void { loadingStatusEl.textContent = text; }

function showProgress(show: boolean): void { progressContainer.style.display = show ? '' : 'none'; }

function updateProgress(p: { loaded: number; total: number; percent: number; speed: number; eta: number }): void {
  progressFill.style.width = `${p.percent}%`;
  progressPercent.textContent = `${p.percent}%`;
  progressSpeed.textContent = p.speed > 0 ? `${(p.speed / 1024).toFixed(0)} KB/s` : '';
  const mb = (p.loaded / (1024 * 1024)).toFixed(1);
  const totalMb = p.total > 0 ? ` / ${(p.total / (1024 * 1024)).toFixed(1)}` : '';
  progressSize.textContent = `${mb}${totalMb} MB`;
}

function showModelDownloadProgress(p: { loaded: number; total: number; percent: number; speed: number; eta: number }): void {
  showProgress(true);
  updateProgress(p);
  loadingEtaEl.textContent = p.eta > 0 ? `~${Math.ceil(p.eta)}s` : '';
}

function openModelDownloadDialog(label: string): { update: (p: { percent: number; loaded: number; total: number }) => void; close: () => void } {
  const dialog = document.createElement('dialog');
  dialog.className = 'name-dialog';
  dialog.innerHTML = `<div class="name-dialog__header"><h2>Downloading model</h2></div><div style="padding: 0 20px 20px"><p>${escapeHtml(label)}</p><div class="progress-bar" style="margin-top: 14px"><div class="progress-bar__fill" style="width: 0%"></div></div><p style="margin-top: 8px; color: var(--text-secondary)">Preparing download…</p></div>`;
  document.body.appendChild(dialog);
  dialog.showModal();
  const fill = dialog.querySelector('.progress-bar__fill') as HTMLElement;
  const text = dialog.querySelector('p:last-child') as HTMLElement;
  return {
    update: (p) => { fill.style.width = `${p.percent}%`; text.textContent = p.total ? `${p.percent}% — ${(p.loaded / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB` : `${(p.loaded / 1048576).toFixed(1)} MB downloaded`; },
    close: () => { dialog.close(); dialog.remove(); },
  };
}

// ============================================================
// consent + model download
// ============================================================

function waitForDownloadConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    const card = document.getElementById('download-consent')!;
    const loadingUi = document.getElementById('loading-ui')!;
    loadingUi.style.display = 'none';
    card.style.display = '';

    const btnAccept = document.getElementById('consent-accept')!;
    const btnDecline = document.getElementById('consent-decline')!;
    const cleanup = () => { btnAccept.removeEventListener('click', onAccept); btnDecline.removeEventListener('click', onDecline); };

    const onAccept = () => { cleanup(); card.style.display = 'none'; loadingUi.style.display = ''; resolve(true); };
    const onDecline = () => { cleanup(); window.location.href = 'https://github.com/bthavanish'; };

    btnAccept.addEventListener('click', onAccept);
    btnDecline.addEventListener('click', onDecline);
  });
}

function waitForFaceConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    const card = document.getElementById('face-consent')!;
    const loadingUi = document.getElementById('loading-ui')!;
    loadingUi.style.display = 'none';
    card.style.display = '';

    const btnAccept = document.getElementById('face-accept')!;
    const btnDecline = document.getElementById('face-decline')!;
    const cleanup = () => { btnAccept.removeEventListener('click', onAccept); btnDecline.removeEventListener('click', onDecline); };

    const onAccept = async () => {
      cleanup();
      if (!(await isStorageAvailable())) { card.style.display = 'none'; loadingUi.style.display = ''; showToast('Storage unavailable'); resolve(false); return; }
      setConsent(true);
      card.style.display = 'none';
      loadingUi.style.display = '';
      resolve(true);
    };
    const onDecline = () => { cleanup(); setConsent(false); card.style.display = 'none'; loadingUi.style.display = ''; resolve(false); };

    btnAccept.addEventListener('click', onAccept);
    btnDecline.addEventListener('click', onDecline);
  });
}

// face-api.js model files to download from CDN
const FACE_MODEL_FILES = [
  { id: 'tiny_face_detector_model-weights_manifest.json', file: 'tiny_face_detector_model-weights_manifest.json', type: 'application/json' },
  { id: 'tiny_face_detector_model.bin', file: 'tiny_face_detector_model.bin', type: 'application/octet-stream' },
  { id: 'face_landmark_68_tiny_model-weights_manifest.json', file: 'face_landmark_68_tiny_model-weights_manifest.json', type: 'application/json' },
  { id: 'face_landmark_68_tiny_model.bin', file: 'face_landmark_68_tiny_model.bin', type: 'application/octet-stream' },
  { id: 'face_recognition_model-weights_manifest.json', file: 'face_recognition_model-weights_manifest.json', type: 'application/json' },
  { id: 'face_recognition_model.bin', file: 'face_recognition_model.bin', type: 'application/octet-stream' },
];

function faceModelUrls(file: string): string[] {
  return [
    `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/${file}`,
    `https://unpkg.com/@vladmandic/face-api@1.7.12/model/${file}`,
  ];
}

async function downloadFaceModels(): Promise<void> {
  showProgress(true);
  for (let i = 0; i < FACE_MODEL_FILES.length; i++) {
    const f = FACE_MODEL_FILES[i];
    if (await isModelStored(f.id)) { logLine(`face: ${f.id} (cached)`, 'ok'); continue; }
    logLine(`face: downloading ${f.id}...`);
    setLoadingStatus(`Downloading face model (${i + 1}/${FACE_MODEL_FILES.length})...`);
    let lastError: unknown;
    for (const url of faceModelUrls(f.file)) {
      try {
        await downloadModelFile(url, f.id, f.type, (p) => {
          updateProgress(p);
          loadingEtaEl.textContent = p.eta > 0 ? `~${Math.ceil(p.eta)}s` : '';
        });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        console.warn(`[mneme] face model fetch failed from ${url}`, error);
      }
    }
    if (lastError) throw new Error(`${f.id}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    logLine(`face: ${f.id} done`, 'ok');
  }
  showProgress(false);
}

// ============================================================
// init
// ============================================================

async function init() {
  loadStartTime = performance.now();
  const loadingScreen = document.getElementById('loading-screen')!;
  const app = document.getElementById('app')!;

  try {
    installModelFetchCache(showModelDownloadProgress);
    const videoEl = document.getElementById('video-feed') as HTMLVideoElement;

    // tf.js
    setLoadingStatus('Initializing TensorFlow.js...');
    logLine('tf.js: requesting backend...');
    const t0 = performance.now();
    await (window as any).tf.ready();
    logLine(`tf.js: ready (${Math.round(performance.now() - t0)}ms)`);
    logLine(`tf.js backend: ${(window as any).tf.getBackend?.() || 'unknown'}`, 'ok');
    logDeviceProfile();
    completedSteps++;
    updateEta();

    // download consent + face models
    const faceStored = await areFaceModelsStored();
    if (!faceStored) {
      if (!hasDownloadedModels()) {
        setLoadingStatus('Waiting for consent...');
        const consented = await waitForDownloadConsent();
        if (!consented) { window.location.href = 'https://github.com/bthavanish'; return; }
        logLine('download consent: accepted');
      } else {
        // A previous session approved models. This only happens after an
        // interrupted/cleared cache, so repair it without showing the same
        // consent popup again.
        logLine('model download: restoring incomplete local cache');
      }
      setLoadingStatus('Downloading face models...');
      const t1 = performance.now();
      try {
        await downloadFaceModels();
        if (!(await areFaceModelsStored())) throw new Error('local model cache is incomplete');
        setDownloadedModels(true);
        logLine(`face models: downloaded (${Math.round(performance.now() - t1)}ms)`, 'ok');
      } catch (err: any) { logLine(`face models: download FAILED - ${err.message}`, 'err'); }
    } else {
      setDownloadedModels(true);
      logLine('face models: already cached', 'ok');
    }

    // face consent
    if (!hasConsent()) {
      setLoadingStatus('Waiting for consent...');
      const consented = await waitForFaceConsent();
      if (consented) {
        logLine('face consent: accepted');
        setLoadingStatus('Loading face models...');
        const t1 = performance.now();
        try { await loadFaceModels(); faceModelsLoaded = true; await rebuildMatcher(); logLine(`face models: loaded (${Math.round(performance.now() - t1)}ms)`, 'ok'); }
        catch (err: any) { logLine(`face models: FAILED - ${err.message}`, 'err'); }
      } else { logLine('face consent: skipped'); }
    } else {
      setLoadingStatus('Loading face models...');
      const t1 = performance.now();
      try { await loadFaceModels(); faceModelsLoaded = true; await rebuildMatcher(); logLine(`face models: loaded (${Math.round(performance.now() - t1)}ms)`, 'ok'); }
      catch (err: any) { logLine(`face models: FAILED - ${err.message}`, 'err'); }
    }
    completedSteps++;
    updateEta();

    // camera
    setLoadingStatus('Accessing camera...');
    logLine('camera: requesting getUserMedia (1280x720)...');
    const t2 = performance.now();
    await startCamera(videoEl);
    setupCanvases(videoEl);
    logLine(`camera: active (${videoEl.videoWidth}x${videoEl.videoHeight}, ${Math.round(performance.now() - t2)}ms)`, 'ok');
    completedSteps++;
    updateEta();

    // object detector
    setLoadingStatus('Loading object detector...');
    const t3 = performance.now();
    const modelCfg = DETECTOR_MODELS[settings.detectorModel];
    showProgress(true);
    await reloadDetector(settings.detectorModel);
    showProgress(false);
    objectModelLoaded = true;
    logLine(`detector: loaded ${modelCfg.label} (${Math.round(performance.now() - t3)}ms)`, 'ok');
    completedSteps++;
    updateEta();

    logLine(`startup complete in ${((performance.now() - loadStartTime) / 1000).toFixed(1)}s`, 'ok');

    app.style.display = '';
    loadingScreen.classList.add('fade-out');
    setTimeout(() => loadingScreen.remove(), 300);

    initUI();
    startDetection();
  } catch (err: any) {
    logLine(`FATAL: ${err.message}`, 'err');
    app.style.display = '';
    loadingScreen.classList.add('fade-out');
    setTimeout(() => loadingScreen.remove(), 300);
    const errorEl = document.getElementById('camera-error');
    if (errorEl) errorEl.style.display = 'flex';
  }
}

// ============================================================
// UI setup
// ============================================================

function initUI() {
  initTabToggle((tab: AppTab) => switchTab(tab));
  const videoEl = document.getElementById('video-feed') as HTMLVideoElement;
  initDetectionLog(videoEl);

  // settings
  const settingsSheet = document.getElementById('settings-sheet')!;
  const scrim = document.getElementById('scrim')!;
  document.getElementById('btn-settings')!.addEventListener('click', () => { settingsSheet.classList.add('open'); scrim.classList.add('visible'); renderModelList(); });
  document.getElementById('btn-close-settings')!.addEventListener('click', () => { settingsSheet.classList.remove('open'); scrim.classList.remove('visible'); });
  scrim.addEventListener('click', () => { settingsSheet.classList.remove('open'); scrim.classList.remove('visible'); });

  // settings controls
  const showConfidenceToggle = document.getElementById('show-confidence') as HTMLInputElement;
  const mirrorToggle = document.getElementById('mirror-video') as HTMLInputElement;
  const detectSlider = document.getElementById('detect-threshold') as HTMLInputElement;
  const faceSlider = document.getElementById('face-threshold') as HTMLInputElement;
  const detectVal = document.getElementById('detect-threshold-val')!;
  const faceVal = document.getElementById('face-threshold-val')!;

  showConfidenceToggle.checked = settings.showConfidence;
  mirrorToggle.checked = settings.mirrorVideo;
  detectSlider.value = String(settings.detectThreshold);
  faceSlider.value = String(settings.faceThreshold);
  detectVal.textContent = String(settings.detectThreshold);
  faceVal.textContent = String(settings.faceThreshold);

  showConfidenceToggle.addEventListener('change', () => { settings.showConfidence = showConfidenceToggle.checked; saveSettings(); });
  mirrorToggle.addEventListener('change', () => { settings.mirrorVideo = mirrorToggle.checked; saveSettings(); applyMirror(); });
  detectSlider.addEventListener('input', () => { settings.detectThreshold = parseFloat(detectSlider.value); detectVal.textContent = detectSlider.value; saveSettings(); });
  faceSlider.addEventListener('input', () => { settings.faceThreshold = parseFloat(faceSlider.value); faceVal.textContent = faceSlider.value; saveSettings(); rebuildMatcher(settings.faceThreshold); });

  document.getElementById('btn-delete-all-faces')?.addEventListener('click', async () => { await clearAllFaces(); await rebuildMatcher(); showToast('All face data deleted'); });
  document.getElementById('btn-delete-all-models')?.addEventListener('click', async () => { await clearAllModels(); setDownloadedModels(false); showToast('All models deleted'); });

  // camera switch
  document.getElementById('btn-switch-camera')?.addEventListener('click', async () => {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    try { stopCamera(); await startCamera(document.getElementById('video-feed') as HTMLVideoElement, currentFacingMode); setupCanvases(document.getElementById('video-feed') as HTMLVideoElement); showToast(`Camera: ${currentFacingMode === 'user' ? 'Front' : 'Back'}`); }
    catch { showToast('Failed to switch camera'); currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user'; }
  });

  document.getElementById('btn-retry-camera')?.addEventListener('click', () => window.location.reload());

  // General toggle
  document.getElementById('btn-toggle-general')?.addEventListener('click', () => {
    generalEnabled = !generalEnabled;
    if (generalEnabled) faceEnabled = false;
    updateModelButtons();
    updateScheduler();
    showToast(generalEnabled ? 'General detection on' : 'General detection off');
  });

  // Sample mode recognizes saved people and saved COCO object classes.
  document.getElementById('btn-toggle-face')?.addEventListener('click', async () => {
    if (!faceEnabled) {
      await ensureFaceRecognitionReady();
      await Promise.all([indexSavedObjectSamples(), indexSavedPersonSamples()]);
    }
    if (!faceEnabled && !(await hasSavedSamples())) {
      showToast('Add a person or object in Memory first');
      return;
    }
    faceEnabled = !faceEnabled;
    if (faceEnabled) generalEnabled = false;
    updateModelButtons();
    updateScheduler();
    if (faceEnabled && !faceModelsLoaded && savedObjectLabels.size === 0) {
      showToast('Sample mode is on, but no clear face was found in the saved photos');
    } else {
      showToast(faceEnabled ? 'Sample detection on' : 'Sample detection off');
    }
  });

  // Camera toggle
  document.getElementById('btn-toggle-camera')?.addEventListener('click', async () => {
    cameraEnabled = !cameraEnabled;
    const btn = document.getElementById('btn-toggle-camera')!;
    btn.classList.toggle('active', cameraEnabled);
    btn.classList.toggle('off', !cameraEnabled);
    const icon = btn.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = cameraEnabled ? 'videocam' : 'videocam_off';
    const vEl = document.getElementById('video-feed') as HTMLVideoElement;
    if (cameraEnabled) {
      try {
        await startCamera(vEl, currentFacingMode);
        setupCanvases(vEl);
        if (generalEnabled || faceEnabled) scheduler?.resume();
      } catch { showToast('Camera access needed'); cameraEnabled = false; }
    } else {
      scheduler?.pause();
      stopCamera();
      clearCanvas('overlay-objects');
      clearCanvas('overlay-faces');
    }
    showToast(cameraEnabled ? 'Camera on' : 'Camera off');
  });

  // about
  document.getElementById('btn-about')?.addEventListener('click', () => document.getElementById('about-page')?.classList.add('open'));
  document.getElementById('btn-close-about')?.addEventListener('click', () => document.getElementById('about-page')?.classList.remove('open'));

  // memory
  document.getElementById('btn-add-memory')?.addEventListener('click', () => (document.getElementById('add-memory-dialog') as HTMLDialogElement).showModal());
  document.getElementById('btn-add-person')?.addEventListener('click', () => { (document.getElementById('add-memory-dialog') as HTMLDialogElement).close(); startCapture('person'); });
  document.getElementById('btn-add-object')?.addEventListener('click', () => { (document.getElementById('add-memory-dialog') as HTMLDialogElement).close(); startCapture('object'); });
  document.getElementById('btn-close-add-memory')?.addEventListener('click', () => (document.getElementById('add-memory-dialog') as HTMLDialogElement).close());

  if (settings.mirrorVideo) applyMirror();
  void Promise.all([renderMemoryPage(), refreshSavedObjectLabels()]);
}

function updateModelButtons(): void {
  const gBtn = document.getElementById('btn-toggle-general')!;
  const fBtn = document.getElementById('btn-toggle-face')!;
  gBtn.classList.toggle('active', generalEnabled);
  gBtn.classList.toggle('off', !generalEnabled);
  fBtn.classList.toggle('active', faceEnabled);
  fBtn.classList.toggle('off', !faceEnabled);
}

function updateScheduler(): void {
  if (!scheduler) return;
  if (!generalEnabled && !faceEnabled) {
    scheduler.pause();
    clearCanvas('overlay-objects');
    clearCanvas('overlay-faces');
  } else {
    scheduler.setEnabledModes((generalEnabled || (faceEnabled && savedObjectLabels.size > 0)) && objectModelLoaded, faceEnabled && hasConsent() && faceModelsLoaded);
    scheduler.resume();
  }
}

function applyMirror(): void {
  const videoEl = document.getElementById('video-feed') as HTMLVideoElement;
  videoEl.style.transform = settings.mirrorVideo ? 'scaleX(-1)' : '';
  setMirror(settings.mirrorVideo);
  const objCanvas = document.getElementById('overlay-objects') as HTMLCanvasElement;
  const faceCanvas = document.getElementById('overlay-faces') as HTMLCanvasElement;
  if (objCanvas) objCanvas.style.transform = settings.mirrorVideo ? 'scaleX(-1)' : '';
  if (faceCanvas) faceCanvas.style.transform = settings.mirrorVideo ? 'scaleX(-1)' : '';
}

function switchTab(tab: AppTab): void {
  const detectTab = document.getElementById('tab-detect')!;
  const memoryTab = document.getElementById('tab-memory')!;
  if (tab === 'detect') {
    detectTab.style.display = ''; detectTab.classList.add('tab-content--active');
    memoryTab.style.display = 'none'; memoryTab.classList.remove('tab-content--active');
    scheduler?.resume();
  } else {
    detectTab.style.display = 'none'; detectTab.classList.remove('tab-content--active');
    memoryTab.style.display = ''; memoryTab.classList.add('tab-content--active');
    scheduler?.pause();
    renderMemoryPage();
  }
}

// ============================================================
// model list in settings
// ============================================================

async function renderModelList(): Promise<void> {
  const list = document.getElementById('model-list')!;
  list.innerHTML = '';
  const keys: DetectorModel[] = ['auto', 'lite', 'standard', 'accurate'];
  const storedModels = await Promise.all(keys.map(key => isDetectorStored(key)));
  for (const [index, key] of keys.entries()) {
    const cfg = DETECTOR_MODELS[key];
    const stored = storedModels[index];
    const isCurrent = settings.detectorModel === key;
    const item = document.createElement('div');
    item.className = 'model-item' + (isCurrent ? ' active' : '');
    item.tabIndex = isCurrent ? -1 : 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `${isCurrent ? 'Selected' : 'Select'} ${cfg.label}`);
    item.innerHTML = `
      <div class="model-item__info">
        <div class="model-item__name">${cfg.label}</div>
        <div class="model-item__desc">${cfg.desc}</div>
      </div>
      <span class="model-item__badge model-item__badge--${cfg.perf}">${cfg.perf}</span>
      ${isCurrent ? '<button class="model-item__btn model-item__btn--current">Active</button>' :
        stored ? `<button class="model-item__btn model-item__btn--delete" data-action="delete" data-key="${key}">Delete</button>
                   <button class="model-item__btn model-item__btn--download" data-action="use" data-key="${key}">Use</button>` :
        `<button class="model-item__btn model-item__btn--download" data-action="download" data-key="${key}">Download</button>`}
    `;
    if (!isCurrent) {
      const selectOnCard = (event: Event) => {
        if (event.target instanceof Element && event.target.closest('button')) return;
        void selectDetectorModel(key, stored, item);
      };
      item.addEventListener('click', selectOnCard);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectOnCard(event); }
      });
    }
    list.appendChild(item);
  }

  list.querySelectorAll('.model-item__btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const el = e.currentTarget as HTMLElement;
      const action = el.dataset.action;
      const key = el.dataset.key as DetectorModel;
      if (!action || !key) return;
      if (action === 'download' || action === 'use') {
        await selectDetectorModel(key, action === 'use', el);
      } else if (action === 'delete') {
        await deleteStoredDetector(key);
        settings.detectorModel = 'auto';
        saveSettings();
        await reloadDetector('auto');
        objectModelLoaded = true;
        showToast(`Deleted ${DETECTOR_MODELS[key].label}, reverted to Lite`);
        renderModelList();
      }
    });
  });
}

async function selectDetectorModel(key: DetectorModel, alreadyStored: boolean, control: HTMLElement): Promise<void> {
  if (modelSwitching || settings.detectorModel === key) return;
  modelSwitching = true;
  const originalText = control.textContent;
  control.classList.add('model-item__btn--downloading');
  control.textContent = alreadyStored ? 'Switching…' : 'Downloading…';
  const progressDialog = alreadyStored ? null : openModelDownloadDialog(DETECTOR_MODELS[key].label);
  if (progressDialog) setModelDownloadProgressListener(progressDialog.update);
  try {
    await reloadDetector(key);
    settings.detectorModel = key;
    saveSettings();
    objectModelLoaded = true;
    updateScheduler();
    showToast(`Selected ${DETECTOR_MODELS[key].label}`);
    await renderModelList();
  } catch (err: any) {
    control.textContent = originalText || 'Download';
    control.classList.remove('model-item__btn--downloading');
    showToast(`Could not load model: ${err.message}`);
  } finally {
    setModelDownloadProgressListener(showModelDownloadProgress);
    progressDialog?.close();
    modelSwitching = false;
  }
}

// ============================================================
// detection loop
// ============================================================

function startDetection() {
  const videoEl = document.getElementById('video-feed') as HTMLVideoElement;
  const profile = getDeviceProfile();
  let paused = false;

  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    if (paused) scheduler?.pause();
    else if (getCurrentTab() === 'detect' && (generalEnabled || faceEnabled)) scheduler?.resume();
  });

  scheduler = new InferenceScheduler({ objectIntervalMs: profile.objectIntervalMs, faceIntervalMs: profile.faceIntervalMs });

  scheduler.setCallbacks(
    async (gen: number) => {
      if (paused || getCurrentTab() !== 'detect' || !objectModelLoaded || (!generalEnabled && (!faceEnabled || savedObjectLabels.size === 0))) return;
      const detections = await detectObjects(videoEl, settings.detectThreshold);
      if (scheduler!.getGeneration('object') !== gen || getCurrentTab() !== 'detect') return;
      if (generalEnabled) {
        drawObjectBoxes('overlay-objects', detections, settings.showConfidence);
        addObjectDetections(detections);
      } else {
        const matches = detections.filter(d => savedObjectLabels.has(d.class)).map(d => ({ ...d, class: savedObjectLabels.get(d.class)! }));
        drawObjectBoxes('overlay-objects', matches, settings.showConfidence);
        addObjectDetections(matches);
      }
    },
    async (gen: number) => {
      if (paused || getCurrentTab() !== 'detect' || !hasConsent() || !faceModelsLoaded || !faceEnabled) return;
      if (!getFaceApi()?.nets?.tinyFaceDetector?.isLoaded) return;
      const { detections, names } = await detectFaces(videoEl);
      if (scheduler!.getGeneration('face') !== gen || getCurrentTab() !== 'detect') return;
      const resolvedNames = names.map((n, i) => n === '' ? (lastFaceNames[i] || 'Unknown') : n);
      if (names.some(n => n !== '')) lastFaceNames = resolvedNames;
      drawFaceBoxes('overlay-faces', detections, resolvedNames);
      addFaceDetections(resolvedNames);
    }
  );

  scheduler.setEnabledModes((generalEnabled || (faceEnabled && savedObjectLabels.size > 0)) && objectModelLoaded, faceEnabled && hasConsent() && faceModelsLoaded);
  scheduler.start();
}

// ============================================================
// memory page
// ============================================================

async function renderMemoryPage(): Promise<void> {
  const items = await getAllMemoryItems();
  const people = items.filter(i => i.type === 'person');
  const objects = items.filter(i => i.type === 'object');
  renderMemoryGrid('memory-people-grid', 'memory-people-empty', people);
  renderMemoryGrid('memory-objects-grid', 'memory-objects-empty', objects);
}

function renderMemoryGrid(gridId: string, emptyId: string, items: MemoryItem[]): void {
  const grid = document.getElementById(gridId)!;
  const empty = document.getElementById(emptyId)!;
  grid.querySelectorAll('.memory-card').forEach(c => c.remove());
  if (items.length === 0) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'memory-card';
    const thumb = document.createElement('div');
    thumb.className = 'memory-card__thumb';
    if (item.samples.length > 0 && item.samples[0].thumbnail) {
      const img = document.createElement('img');
      const thumbnailUrl = URL.createObjectURL(item.samples[0].thumbnail);
      img.src = thumbnailUrl;
      img.addEventListener('load', () => URL.revokeObjectURL(thumbnailUrl), { once: true });
      img.addEventListener('error', () => URL.revokeObjectURL(thumbnailUrl), { once: true });
      img.alt = item.name;
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = `<span class="material-symbols-outlined">${item.type === 'person' ? 'person' : 'category'}</span>`;
    }
    const info = document.createElement('div');
    info.className = 'memory-card__info';
    info.innerHTML = `<p class="memory-card__name">${escapeHtml(item.name)}</p><p class="memory-card__meta">${item.samples.length} sample${item.samples.length !== 1 ? 's' : ''}</p>`;
    const delBtn = document.createElement('button');
    delBtn.className = 'memory-card__delete';
    delBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteMemoryItem(item.id);
      if (item.type === 'person') {
        await deleteFacesForMemory(item.id);
        await rebuildMatcher();
      }
      await refreshSavedObjectLabels();
      showToast(`Deleted ${item.name}`);
      renderMemoryPage();
    });
    card.appendChild(thumb);
    card.appendChild(info);
    card.appendChild(delBtn);
    grid.appendChild(card);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// capture flow
// ============================================================

async function startCapture(type: 'person' | 'object'): Promise<void> {
  captureType = type;
  capturedBlobs = [];
  const screen = document.getElementById('capture-screen')!;
  const video = document.getElementById('capture-video') as HTMLVideoElement;
  const title = document.getElementById('capture-title')!;
  const countEl = document.getElementById('capture-count')!;
  const doneBtn = document.getElementById('btn-done-capture')!;
  const shutterBtn = document.getElementById('btn-shutter')!;
  const closeBtn = document.getElementById('btn-close-capture')!;

  title.textContent = type === 'person' ? 'Add Person' : 'Add Object';
  countEl.textContent = '0 photos';
  doneBtn.style.display = 'none';
  screen.style.display = 'flex';

  try { await startCamera(video, currentFacingMode); } catch { showToast('Camera access needed'); screen.style.display = 'none'; return; }

  const onShutter = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (blob) { capturedBlobs.push(blob); countEl.textContent = `${capturedBlobs.length} photo${capturedBlobs.length !== 1 ? 's' : ''}`; doneBtn.style.display = ''; }
  };
  const onDone = () => { cleanup(); screen.style.display = 'none'; stopCamera(); if (capturedBlobs.length > 0) showNameDialog(); };
  const onClose = () => { cleanup(); screen.style.display = 'none'; stopCamera(); };
  const cleanup = () => { shutterBtn.removeEventListener('click', onShutter); doneBtn.removeEventListener('click', onDone); closeBtn.removeEventListener('click', onClose); };

  shutterBtn.addEventListener('click', onShutter);
  doneBtn.addEventListener('click', onDone);
  closeBtn.addEventListener('click', onClose);
}

function showNameDialog(): void {
  const dialog = document.getElementById('name-dialog') as HTMLDialogElement;
  const input = document.getElementById('name-input') as HTMLInputElement;
  const form = document.getElementById('name-form') as HTMLFormElement;
  const cancelBtn = document.getElementById('btn-cancel-name')!;
  const titleEl = document.getElementById('name-dialog-title')!;
  titleEl.textContent = captureType === 'person' ? 'Name this person' : 'Name this object';
  input.value = '';
  dialog.showModal();
  input.focus();

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    dialog.close();
    form.removeEventListener('submit', handleSubmit);
    cancelBtn.removeEventListener('click', onCancel);

    const samples: MemorySample[] = capturedBlobs.map(blob => ({
      id: crypto.randomUUID(), image: blob, thumbnail: blob,
      crop: { x: 0, y: 0, width: 100, height: 100 }, createdAt: Date.now(),
    }));

    const item: MemoryItem = {
      id: crypto.randomUUID(), name, type: captureType,
      createdAt: Date.now(), updatedAt: Date.now(), samples, enabled: true,
    };
    await saveMemoryItem(item);

    // Store a descriptor for every usable sample. Using only the first image
    // made recognition fail whenever that one capture was blurred or off-angle.
    if (captureType === 'person' && faceModelsLoaded) {
      try {
        const api = getFaceApi();
        let savedCount = 0;
        for (let index = 0; index < capturedBlobs.length; index++) {
          const img = new Image();
          const imageUrl = URL.createObjectURL(capturedBlobs[index]);
          img.src = imageUrl;
          await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('Could not read sample image')); });
          const detection = await api.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
          URL.revokeObjectURL(imageUrl);
          if (!detection) continue;

          samples[index].embedding = Array.from(detection.descriptor);
          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = 80; thumbCanvas.height = 80;
          thumbCanvas.getContext('2d')!.drawImage(img, 0, 0, 80, 80);
          const face: SavedFace = {
            id: crypto.randomUUID(),
            memoryItemId: item.id,
            name,
            descriptor: Array.from(detection.descriptor),
            addedAt: Date.now(),
            thumbnail: thumbCanvas.toDataURL('image/jpeg', 0.7),
          };
          await saveFace(face);
          savedCount++;
        }
        await saveMemoryItem(item); // includes per-sample embeddings in IndexedDB
        await rebuildMatcher();
        logLine(savedCount ? `saved ${savedCount} face sample${savedCount === 1 ? '' : 's'} for "${name}"` : `no face detected in samples for "${name}"`, savedCount ? 'ok' : 'err');
      } catch (err: any) {
        logLine(`face descriptor error: ${err.message}`, 'err');
      }
    }

    if (captureType === 'object' && objectModelLoaded) {
      try {
        const learned = new Set<string>();
        for (let index = 0; index < capturedBlobs.length; index++) {
          const img = new Image();
          const imageUrl = URL.createObjectURL(capturedBlobs[index]);
          img.src = imageUrl;
          await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('Could not read sample image')); });
          const detections = await detectImageObjects(img);
          URL.revokeObjectURL(imageUrl);
          const labels = [...new Set(detections.map(d => d.class))];
          samples[index].labels = labels;
          labels.forEach(label => learned.add(label));
        }
        await saveMemoryItem(item);
        await refreshSavedObjectLabels();
        updateScheduler();
        logLine(learned.size ? `saved object sample labels for "${name}": ${[...learned].join(', ')}` : `no pretrained object class found in samples for "${name}"`, learned.size ? 'ok' : 'err');
      } catch (err: any) {
        logLine(`object sample analysis error: ${err.message}`, 'err');
      }
    }

    showToast(`Saved ${name}`);
    renderMemoryPage();
    capturedBlobs = [];
  };

  const onCancel = () => { dialog.close(); form.removeEventListener('submit', handleSubmit); cancelBtn.removeEventListener('click', onCancel); };
  form.addEventListener('submit', handleSubmit);
  cancelBtn.addEventListener('click', onCancel);
}

init();
