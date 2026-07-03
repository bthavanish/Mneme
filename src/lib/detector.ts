import type { Detection } from '../types';
import { isMobile } from './device';

let model: any = null;
let busy = false;

const FPS = isMobile ? 8 : 12;
const INTERVAL = 1000 / FPS;

export async function loadDetector(): Promise<void> {
  const cocoSsd = (window as any).cocoSsd;
  const base = isMobile ? 'lite_mobilenet_v2' : 'mobilenet_v2';
  model = await cocoSsd.load({ base });
}

export async function detectObjects(
  videoEl: HTMLVideoElement,
  threshold: number
): Promise<Detection[]> {
  if (busy || !model || !videoEl || videoEl.readyState < 2) return [];
  busy = true;

  try {
    // model.detect() is async - do NOT wrap in tf.tidy()
    const predictions = await model.detect(videoEl);
    return predictions
      .filter((p: any) => p.score >= threshold)
      .map((p: any) => ({
        bbox: p.bbox as [number, number, number, number],
        class: p.class as string,
        score: p.score as number,
      }));
  } finally {
    busy = false;
  }
}

export function getObjectDetectionInterval(): number {
  return INTERVAL;
}
