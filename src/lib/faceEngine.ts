import type { SavedFace, FaceDetectionBox, FaceDetectionResult } from '../types';
import { isMobile } from './device';
import { loadFaces } from './faceStore';

let faceapi: any = null;
let faceMatcher: any = null;
let busy = false;

const FPS = isMobile ? 3 : 5;
const INTERVAL = 1000 / FPS;

export function getFaceApi(): any {
  if (!faceapi) faceapi = (window as any).faceapi;
  return faceapi;
}

export async function loadFaceModels(modelUrl: string): Promise<void> {
  const api = getFaceApi();
  // load detector first (needed for detection), then landmarks + recognition in parallel
  await api.nets.tinyFaceDetector.loadFromUri(modelUrl);
  await Promise.all([
    api.nets.faceLandmark68TinyNet.loadFromUri(modelUrl),
    api.nets.faceRecognitionNet.loadFromUri(modelUrl),
  ]);
}

export async function rebuildMatcher(): Promise<void> {
  const api = getFaceApi();
  const stored = await loadFaces();
  if (stored.length === 0) {
    faceMatcher = null;
    return;
  }

  const labeledDescriptors = stored.map((face: SavedFace) => {
    const descriptor = new Float32Array(face.descriptor);
    return new api.LabeledFaceDescriptors(face.name, [descriptor]);
  });

  const threshold = parseFloat(localStorage.getItem('face_threshold') || '0.5');
  faceMatcher = new api.FaceMatcher(labeledDescriptors, threshold);
}

export async function detectFaces(
  videoEl: HTMLVideoElement
): Promise<FaceDetectionResult> {
  const api = getFaceApi();
  if (busy || !api?.nets?.tinyFaceDetector?.isLoaded || !videoEl || videoEl.readyState < 2) {
    return { detections: [], names: [] };
  }
  busy = true;

  try {
    const options = new api.TinyFaceDetectorOptions({
      inputSize: isMobile ? 160 : 224,
      scoreThreshold: 0.4,
    });

    const results = await api
      .detectAllFaces(videoEl, options)
      .withFaceLandmarks()
      .withFaceDescriptors();

    const names = results.map((r: any) => {
      if (!faceMatcher) return 'Unknown';
      const match = faceMatcher.findBestMatch(r.descriptor);
      return match.label === 'unknown' ? 'Unknown' : match.label;
    });

    return { detections: results as FaceDetectionBox[], names };
  } finally {
    busy = false;
  }
}

export function getMatcher(): any {
  return faceMatcher;
}

export function getFaceInterval(): number {
  return INTERVAL;
}
