import type { Detection } from '../types';

let model: any = null;
let busy = false;

// mobile gets 8fps, desktop 12fps. enough for usable boxes, much less GPU churn.
const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
const FPS = isMobile ? 8 : 12;
const INTERVAL = 1000 / FPS;

export async function loadDetector(): Promise<void> {
  model = await (window as any).cocoSsd.load({ base: 'mobilenet_v2' });
}

export async function detectObjects(
  videoEl: HTMLVideoElement,
  threshold: number
): Promise<Detection[]> {
  if (busy || !model || !videoEl || videoEl.readyState < 2) return [];
  busy = true;

  try {
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

export function getInterval(): number {
  return INTERVAL;
}
