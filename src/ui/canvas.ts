import type { BoundingBox, Detection, DrawOpts } from '../types';

// cache canvas contexts to avoid repeated getContext calls
const ctxCache = new Map<string, CanvasRenderingContext2D>();

function getCtx(canvasId: string): CanvasRenderingContext2D | null {
  if (ctxCache.has(canvasId)) return ctxCache.get(canvasId)!;
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
  if (!canvas) return null;
  const ctx = canvas.getContext('2d')!;
  ctxCache.set(canvasId, ctx);
  return ctx;
}

export function setupCanvases(videoEl: HTMLVideoElement): void {
  const resize = () => {
    const w = videoEl.videoWidth || 1280;
    const h = videoEl.videoHeight || 720;
    for (const id of ['overlay-objects', 'overlay-faces']) {
      const canvas = document.getElementById(id) as HTMLCanvasElement;
      if (canvas) {
        canvas.width = w;
        canvas.height = h;
      }
    }
    ctxCache.clear(); // context invalidated after resize
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
  const canvas = ctx.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function drawObjectBoxes(canvasId: string, detections: Detection[]): void {
  const ctx = getCtx(canvasId);
  if (!ctx) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (const d of detections) {
    const [x, y, w, h] = d.bbox;
    drawBox(ctx, { x, y, w, h }, {
      strokeColor: '#78536A',
      pillBg: '#FFD8EF',
      pillText: '#2E1125',
      label: d.class,
    });
  }
}

export function drawFaceBoxes(canvasId: string, detections: any[], names: string[]): void {
  const ctx = getCtx(canvasId);
  if (!ctx) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let i = 0; i < detections.length; i++) {
    const box = detections[i].detection?.box;
    if (!box) continue;
    const name = names[i] || 'Unknown';

    drawBox(ctx, { x: box.x, y: box.y, w: box.width, h: box.height }, {
      strokeColor: '#4A55A2',
      pillBg: '#DEE0FF',
      pillText: '#00006E',
      label: name,
    });
  }
}

// pre-build rounded rect path for reuse (boxes are all the same shape)
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
  const r = 6;

  roundedRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = opts.strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // label pill
  ctx.font = '12px "Roboto Flex", sans-serif';
  const tw = ctx.measureText(opts.label).width;
  const pw = tw + 12;
  const ph = 22;
  const px = x;
  const py = y - ph - 4;

  ctx.fillStyle = opts.pillBg;
  roundedRect(ctx, px, py, pw, ph, 4);
  ctx.fill();

  ctx.fillStyle = opts.pillText;
  ctx.fillText(opts.label, px + 6, py + 15);
}
