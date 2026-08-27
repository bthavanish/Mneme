/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * faceEngine.ts - face detection + recognition via face-api.js
 * loads models from IndexedDB cache, not from network
 */

import type { FaceDetectionBox, FaceDetectionResult } from '../types';
import { getDeviceProfile } from './deviceProfile';
import { loadFaces } from './faceStore';
import { loadModelFile, hasValidModelFile } from './modelStore';
import { getAllMemoryItems } from './memoryStore';

let faceapi: any = null;
let faceMatcher: any = null;
let busy = false;
let descriptorCallCount = 0;
const DESCRIPTOR_INTERVAL = 2;

// face-api.js model file IDs (stored in IndexedDB)
export const FACE_MODEL_FILES = [
  { id: 'tiny_face_detector_model-weights_manifest.json', minimumBytes: 1000 },
  { id: 'tiny_face_detector_model.bin', minimumBytes: 100000 },
  { id: 'face_landmark_68_tiny_model-weights_manifest.json', minimumBytes: 1000 },
  { id: 'face_landmark_68_tiny_model.bin', minimumBytes: 50000 },
  { id: 'face_recognition_model-weights_manifest.json', minimumBytes: 1000 },
  { id: 'face_recognition_model.bin', minimumBytes: 1000000 },
];

export function getFaceApi(): any {
  if (!faceapi) faceapi = (window as any).faceapi;
  return faceapi;
}

export async function areFaceModelsStored(): Promise<boolean> {
  for (const file of FACE_MODEL_FILES) {
    if (!(await hasValidModelFile(file.id, file.minimumBytes))) return false;
  }
  return true;
}

export async function loadFaceModels(): Promise<void> {
  const api = getFaceApi();

  // Load bytes directly from IndexedDB. This deliberately avoids loadFromUri:
  // face-api may retain an internal fetch implementation that bypasses the
  // app's fetch cache and then fails in restrictive browser/network setups.
  const loadFromStore = async (name: string, manifestName: string, shardName: string) => {
    const [manifestData, shardData] = await Promise.all([loadModelFile(manifestName), loadModelFile(shardName)]);
    if (!manifestData || !shardData) throw new Error(`${manifestName} is incomplete in local storage`);
    const tf = api.tf || (window as any).tf;
    const factory = tf?.io?.weightsLoaderFactory;
    if (!factory) throw new Error('TensorFlow weight loader is unavailable');
    const manifest = JSON.parse(new TextDecoder().decode(manifestData));
    const loadWeights = factory(async () => [shardData]);
    const weightMap = await loadWeights(manifest, '');
    api.nets[name].loadFromWeightMap(weightMap);
  };

  await loadFromStore('tinyFaceDetector', 'tiny_face_detector_model-weights_manifest.json', 'tiny_face_detector_model.bin');
  await Promise.all([
    loadFromStore('faceLandmark68TinyNet', 'face_landmark_68_tiny_model-weights_manifest.json', 'face_landmark_68_tiny_model.bin'),
    loadFromStore('faceRecognitionNet', 'face_recognition_model-weights_manifest.json', 'face_recognition_model.bin'),
  ]);
}

export async function rebuildMatcher(threshold?: number): Promise<void> {
  const api = getFaceApi();
  const stored = await loadFaces();
  const memoryItems = await getAllMemoryItems();

  const byName = new Map<string, Float32Array[]>();
  const addDescriptor = (name: string, descriptor: number[]) => {
    const arr = new Float32Array(descriptor);
    if (arr.length !== 128 || arr.every(v => v === 0)) return;
    const existing = byName.get(name) || [];
    // Do not add the same descriptor twice when it exists in both legacy
    // face storage and the Memory sample itself.
    if (!existing.some(value => value[0] === arr[0] && value[1] === arr[1] && value[2] === arr[2])) existing.push(arr);
    byName.set(name, existing);
  };

  for (const face of stored) {
    const arr = new Float32Array(face.descriptor);
    if (arr.length !== 128 || arr.every(v => v === 0)) {
      console.warn(`[mneme] skipping invalid descriptor for ${face.name} (len=${arr.length})`);
      continue;
    }
    addDescriptor(face.name, face.descriptor);
  }
  for (const item of memoryItems) {
    if (item.type !== 'person' || !item.enabled) continue;
    for (const sample of item.samples) if (sample.embedding?.length === 128) addDescriptor(item.name, sample.embedding);
  }

  if (byName.size === 0) { faceMatcher = null; console.log('[mneme] no valid descriptors, matcher cleared'); return; }

  const labeledDescriptors = Array.from(byName.entries()).map(([name, descs]) => {
    console.log(`[mneme] adding ${descs.length} descriptor(s) for "${name}"`);
    return new api.LabeledFaceDescriptors(name, descs);
  });

  const t = threshold ?? parseFloat(localStorage.getItem('face_threshold') || '0.6');
  faceMatcher = new api.FaceMatcher(labeledDescriptors, t);
  console.log(`[mneme] matcher rebuilt: ${labeledDescriptors.length} people, threshold=${t}`);
}

export async function detectFaces(videoEl: HTMLVideoElement): Promise<FaceDetectionResult> {
  const api = getFaceApi();
  if (busy || !api?.nets?.tinyFaceDetector?.isLoaded || !videoEl || videoEl.readyState < 2) {
    return { detections: [], names: [] };
  }
  busy = true;
  try {
    const profile = getDeviceProfile();
    const options = new api.TinyFaceDetectorOptions({
      inputSize: profile.faceInputSize,
      scoreThreshold: 0.3,
    });

    descriptorCallCount++;
    const computeDescriptors = descriptorCallCount % DESCRIPTOR_INTERVAL === 0;

    if (computeDescriptors) {
      const results = await api.detectAllFaces(videoEl, options).withFaceLandmarks().withFaceDescriptors();
      if (!results || results.length === 0) return { detections: [], names: [] };

      const names = results.map((r: any) => {
        if (!faceMatcher) return 'Unknown';
        try {
          const match = faceMatcher.findBestMatch(r.descriptor);
          if (match.label === 'unknown') return 'Unknown';
          return match.label;
        } catch (e) {
          console.warn('[mneme] findBestMatch error:', e);
          return 'Unknown';
        }
      });

      return { detections: results as FaceDetectionBox[], names };
    } else {
      const results = await api.detectAllFaces(videoEl, options).withFaceLandmarks();
      if (!results || results.length === 0) return { detections: [], names: [] };
      return { detections: results as FaceDetectionBox[], names: results.map(() => '') };
    }
  } finally {
    busy = false;
  }
}

export function hasSavedFaces(): boolean {
  return faceMatcher !== null;
}

export function getMatcher(): any {
  return faceMatcher;
}
