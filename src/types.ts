export interface SavedFace {
  id: string;
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

export interface FaceDetectionResult {
  detections: any[];
  matchedNames: string[];
}

export type AppMode = 'objects' | 'faces' | 'both';

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

export interface Settings {
  showConfidence: boolean;
  mirrorVideo: boolean;
  detectThreshold: number;
  faceThreshold: number;
  theme: 'light' | 'dark' | 'system';
}
