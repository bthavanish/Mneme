/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * types.ts - shared types, nothing fancy
 */

export interface SavedFace {
  id: string;
  memoryItemId?: string;
  name: string;
  descriptor: number[];
  addedAt: number;
  thumbnail: string;
}

export interface Detection {
  bbox: [number, number, number, number];
  class: string;
  score: number;
}

export interface FaceDetectionBox {
  detection: { box: { x: number; y: number; width: number; height: number } };
  descriptor: Float32Array;
}

export interface FaceDetectionResult {
  detections: FaceDetectionBox[];
  names: string[];
}

export type AppTab = 'detect' | 'memory';

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawOpts {
  strokeColor: string;
  pillBg: string;
  pillText: string;
  label: string;
}

export type DetectorModel = 'auto' | 'lite' | 'standard' | 'accurate';

export const DETECTOR_MODELS: Record<DetectorModel, { label: string; base: string; desc: string; perf: 'fast' | 'balanced' | 'accurate' }> = {
  auto:     { label: 'Auto (Recommended)',      base: 'lite_mobilenet_v2', desc: 'Chooses the fastest suitable local model for this device', perf: 'balanced' },
  lite:     { label: 'Lite (MobileNet V2)',     base: 'lite_mobilenet_v2', desc: 'Fastest, lower accuracy, ~5MB',  perf: 'fast' },
  standard: { label: 'Standard (MobileNet V1)',  base: 'mobilenet_v1',      desc: 'Balanced speed/accuracy, ~8MB', perf: 'balanced' },
  accurate: { label: 'Accurate (MobileNet V2)',  base: 'mobilenet_v2',      desc: 'Highest accuracy, slower, ~15MB', perf: 'accurate' },
};

export interface Settings {
  showConfidence: boolean;
  mirrorVideo: boolean;
  detectThreshold: number;
  faceThreshold: number;
  detectorModel: DetectorModel;
}

export interface MemorySample {
  id: string;
  image: Blob;
  thumbnail: Blob;
  crop: { x: number; y: number; width: number; height: number };
  embedding?: number[];
  landmarkPositions?: number[];
  /** COCO classes found in this saved object sample. */
  labels?: string[];
  createdAt: number;
}

export interface MemoryItem {
  id: string;
  name: string;
  type: 'person' | 'object';
  createdAt: number;
  updatedAt: number;
  samples: MemorySample[];
  enabled: boolean;
}
