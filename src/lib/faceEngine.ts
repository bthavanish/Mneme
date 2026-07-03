import type { SavedFace, FaceDetectionBox, FaceDetectionResult } from '../types';
import { isMobile } from './device';
import { loadFaces } from './faceStore';

let faceapi: any = null;
let faceMatcher: any = null;
let busy = false;

export function getFaceApi(): any {
  if (!faceapi) faceapi = (window as any).faceapi;
  return faceapi;
}

export async function loadFaceModels(modelUrl: string): Promise<void> {
  const api = getFaceApi();
  await api.nets.tinyFaceDetector.loadFromUri(modelUrl);
  await Promise.all([
    api.nets.faceLandmark68TinyNet.loadFromUri(modelUrl),
    api.nets.faceRecognitionNet.loadFromUri(modelUrl),
  ]);
}

export async function rebuildMatcher(threshold?: number): Promise<void> {
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

  const t = threshold ?? parseFloat(localStorage.getItem('face_threshold') || '0.5');
  faceMatcher = new api.FaceMatcher(labeledDescriptors, t);
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
      inputSize: isMobile ? 128 : 224,
      scoreThreshold: 0.4,
    });

    const results = await api
      .detectAllFaces(videoEl, options)
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (!results || results.length === 0) {
      return { detections: [], names: [] };
    }

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
