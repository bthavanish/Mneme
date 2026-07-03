import type { SavedFace } from '../types';
import { loadFaces } from './faceStore';

const faceapi = (window as any).faceapi;

let faceMatcher: any = null;
let busy = false;

// face detection is heavier. 3fps on mobile, 5fps on desktop.
const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
const FPS = isMobile ? 3 : 5;
const INTERVAL = 1000 / FPS;

export async function loadFaceModels(modelUrl: string): Promise<void> {
  await faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl);
  await faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelUrl);
  await faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl);
}

export async function rebuildMatcher(): Promise<void> {
  const stored = await loadFaces();
  if (stored.length === 0) {
    faceMatcher = null;
    return;
  }

  const labeledDescriptors = stored.map((face: SavedFace) => {
    const descriptor = new Float32Array(face.descriptor);
    return new faceapi.LabeledFaceDescriptors(face.name, [descriptor]);
  });

  const threshold = parseFloat(localStorage.getItem('face_threshold') || '0.5');
  faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, threshold);
}

export async function detectFaces(
  videoEl: HTMLVideoElement
): Promise<{ detections: any[]; names: string[] }> {
  if (busy || !faceapi.nets.tinyFaceDetector.isLoaded || !videoEl || videoEl.readyState < 2) {
    return { detections: [], names: [] };
  }
  busy = true;

  try {
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: isMobile ? 224 : 320,
      scoreThreshold: 0.4,
    });

    const results = await faceapi
      .detectAllFaces(videoEl, options)
      .withFaceLandmarks()
      .withFaceDescriptors();

    const names = results.map((r: any) => {
      if (!faceMatcher) return 'Unknown';
      const match = faceMatcher.findBestMatch(r.descriptor);
      return match.label === 'unknown' ? 'Unknown' : match.label;
    });

    return { detections: results, names };
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
