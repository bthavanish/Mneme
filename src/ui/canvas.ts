/**
 * Canvas overlay rendering — draws bounding boxes on camera feed.
 * Uses computed MD3 token colors for consistency.
 */
import type { BoundingBox, Detection, DrawOpts, FaceDetectionBox } from '../types';

const ctxCache = new Map<string, CanvasRenderingContext2D>();
const logicalSize = new Map<string, { w: number; h: number }>();

function getCtx(canvasId: string): CanvasRenderingContext2D | null {
  if (ctxCache.has(canvasId)) return ctxCache.get(canvasId)!;
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
  if (!canvas) return null;
  const ctx = canvas.getContext('2d')!;
  ctxCache.set(canvasId, ctx);
  return ctx;
}

function getTokenColor(prop: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim() || fallback;
}

export function setupCanvases(videoEl: HTMLVideoElement): void {
  const resize = () => {
    const w = videoEl.videoWidth || 1280;
    const h = videoEl.videoHeight || 720;
    const dpr = window.devicePixelRatio || 1;

    for (const id of ['overlay-objects', 'overlay-faces']) {
      const canvas = document.getElementById(id) as HTMLCanvasElement;
      if (!canvas) continue;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctxCache.set(id, ctx);
      logicalSize.set(id, { w, h });
    }
  };

  let timer: ReturnType<typeof setTimeout>;
  const debouncedResize = () => {
    clearTimeout(timer);
    timer = setTimeout(resize, 150);
  };

  videoEl.addEventListener('loadedmetadata', resize);
  window.addEventListener('resize', debouncedResize);
}

export function clearCanvas(canvasId: string): void {
  const ctx = getCtx(canvasId);
  if (!ctx) return;
  const size = logicalSize.get(canvasId);
  if (size) {
    ctx.clearRect(0, 0, size.w, size.h);
  } else {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}

export function drawObjectBoxes(
  canvasId: string,
  detections: Detection[],
  showConfidence: boolean
): void {
  const ctx = getCtx(canvasId);
  if (!ctx) return;
  const size = logicalSize.get(canvasId);
  const cw = size?.w ?? ctx.canvas.width;
  const ch = size?.h ?? ctx.canvas.height;
  ctx.clearRect(0, 0, cw, ch);

  const tertiary = getTokenColor('--md-sys-color-tertiary', '#78536A');
  const tertiaryContainer = getTokenColor('--md-sys-color-tertiary-container', '#FFD8EF');
  const onTertiaryContainer = getTokenColor('--md-sys-color-on-tertiary-container', '#2E1125');

  ctx.font = '500 12px "Roboto Flex", sans-serif';

  for (const d of detections) {
    const [x, y, w, h] = d.bbox;
    const label = showConfidence
      ? `${d.class} ${Math.round(d.score * 100)}%`
      : d.class;
    drawBox(ctx, { x, y, w, h }, {
      strokeColor: tertiary,
      pillBg: tertiaryContainer,
      pillText: onTertiaryContainer,
      label,
    });
  }
}

export function drawFaceBoxes(
  canvasId: string,
  detections: FaceDetectionBox[],
  names: string[],
  _showConfidence?: boolean
): void {
  const ctx = getCtx(canvasId);
  if (!ctx) return;
  const size = logicalSize.get(canvasId);
  const cw = size?.w ?? ctx.canvas.width;
  const ch = size?.h ?? ctx.canvas.height;
  ctx.clearRect(0, 0, cw, ch);

  const primary = getTokenColor('--md-sys-color-primary', '#4A55A2');
  const primaryContainer = getTokenColor('--md-sys-color-primary-container', '#DEE0FF');
  const onPrimaryContainer = getTokenColor('--md-sys-color-on-primary-container', '#00006E');

  ctx.font = '500 12px "Roboto Flex", sans-serif';

  for (let i = 0; i < detections.length; i++) {
    const box = detections[i].detection?.box;
    if (!box) continue;
    const name = names[i] || 'Unknown';

    drawBox(ctx, { x: box.x, y: box.y, w: box.width, h: box.height }, {
      strokeColor: primary,
      pillBg: primaryContainer,
      pillText: onPrimaryContainer,
      label: name,
    });
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBox(ctx: CanvasRenderingContext2D, box: BoundingBox, opts: DrawOpts): void {
  const { x, y, w, h } = box;
  const r = 8; // MD3 medium corner

  // Box stroke
  roundedRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = opts.strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Label pill
  const tw = ctx.measureText(opts.label).width;
  const pw = tw + 16;
  const ph = 24;
  const px = x;
  const py = y - ph - 4;

  ctx.fillStyle = opts.pillBg;
  roundedRect(ctx, px, py, pw, ph, 4);
  ctx.fill();

  ctx.fillStyle = opts.pillText;
  ctx.fillText(opts.label, px + 8, py + 16);
}
