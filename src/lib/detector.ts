/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * detector.ts - coco-ssd wrapper with model selection
 */

import type { Detection, DetectorModel } from '../types';
import { DETECTOR_MODELS } from '../types';
import { hasCachedModelMatching, deleteCachedModelsMatching, flushModelCache } from './modelStore';
import { getDeviceProfile } from './deviceProfile';

let model: any = null;
let currentBase: string = '';
let lastError = '';

export async function loadDetector(base?: string): Promise<void> {
  const cocoSsd = (window as any).cocoSsd;
  const modelBase = base || 'lite_mobilenet_v2';
  if (model && currentBase === modelBase) return;
  if (model) { try { model.dispose(); } catch {} }
  model = await cocoSsd.load({ base: modelBase });
  // coco-ssd has consumed all manifest/shard responses at this point. Wait for
  // their mirrored IndexedDB writes so a completed download is never repeated.
  await flushModelCache();
  currentBase = modelBase;
  console.log(`[mneme] detector loaded: ${modelBase}`);
}

export async function reloadDetector(modelKey: DetectorModel): Promise<void> {
  const cfg = DETECTOR_MODELS[modelKey];
  const base = modelKey === 'auto' ? getDeviceProfile().detectorBase : cfg.base;
  await loadDetector(base);
}

const MODEL_CACHE_NAMES: Record<DetectorModel, string> = {
  auto: 'ssdlite_mobilenet_v2',
  lite: 'ssdlite_mobilenet_v2',
  standard: 'ssd_mobilenet_v1',
  accurate: 'ssd_mobilenet_v2',
};

export function isDetectorStored(modelKey: DetectorModel): Promise<boolean> {
  const fragment = modelKey === 'auto'
    ? (getDeviceProfile().detectorBase === 'mobilenet_v2' ? MODEL_CACHE_NAMES.accurate : MODEL_CACHE_NAMES.lite)
    : MODEL_CACHE_NAMES[modelKey];
  return hasCachedModelMatching(fragment);
}

export function deleteStoredDetector(modelKey: DetectorModel): Promise<void> {
  return deleteCachedModelsMatching(MODEL_CACHE_NAMES[modelKey]);
}

export async function detectObjects(
  videoEl: HTMLVideoElement,
  threshold: number,
  maxDetections = 20,
): Promise<Detection[]> {
  if (!model || !videoEl || videoEl.readyState < 2) return [];
  try {
    // Let COCO-SSD apply the confidence cutoff during non-max suppression;
    // filtering only after inference wastes work on low-confidence boxes.
    const predictions = await model.detect(videoEl, maxDetections, threshold);
    return predictions
      .filter((p: any) => p.score >= threshold)
      .map((p: any) => ({
        bbox: p.bbox as [number, number, number, number],
        class: p.class as string,
        score: p.score as number,
      }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== lastError) {
      lastError = message;
      console.error('[mneme] object detection failed:', error);
    }
    return [];
  }
}

export async function detectImageObjects(image: HTMLImageElement | HTMLCanvasElement, threshold = 0.35): Promise<Detection[]> {
  return detectObjects(image as unknown as HTMLVideoElement, threshold, 20);
}
