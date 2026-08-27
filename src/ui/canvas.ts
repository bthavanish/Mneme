/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * canvas.ts - draws bounding boxes on the camera feed
 * handles object-fit:cover coordinate transform + mirror
 * uses EMA smoothing instead of that dumb spring animation
 */

import type { BoundingBox, Detection, DrawOpts, FaceDetectionBox } from '../types';

const ctxCache = new Map<string, CanvasRenderingContext2D>();
const logicalSize = new Map<string, { w: number; h: number }>();

let fitTransform = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
let mirrorEnabled = false;

interface SmoothedBox { x: number; y: number; w: number; h: number; age: number; }
const smoothedBoxes = new Map<string, SmoothedBox>();
const SMOOTH_FACTOR = 0.5;
const BOX_EXPIRY_MS = 1500;

function getCtx(id: string): CanvasRenderingContext2D | null {
  if (ctxCache.has(id)) return ctxCache.get(id)!;
  const canvas = document.getElementById(id) as HTMLCanvasElement;
  if (!canvas) return null;
  const ctx = canvas.getContext('2d')!;
  ctxCache.set(id, ctx);
  return ctx;
}

export function computeFitTransform(vw: number, vh: number, cw: number, ch: number): void {
  if (!vw || !vh || !cw || !ch) { fitTransform = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }; return; }
  const va = vw / vh, ca = cw / ch;
  let drawW: number, drawH: number, ox = 0, oy = 0;
  if (ca > va) { drawW = cw; drawH = cw / va; oy = (ch - drawH) / 2; }
  else { drawH = ch; drawW = ch * va; ox = (cw - drawW) / 2; }
  fitTransform = { scaleX: drawW / vw, scaleY: drawH / vh, offsetX: ox, offsetY: oy };
}

function modelToContainer(bbox: [number, number, number, number]): [number, number, number, number] {
  const [mx, my, mw, mh] = bbox;
  return [mx * fitTransform.scaleX + fitTransform.offsetX, my * fitTransform.scaleY + fitTransform.offsetY, mw * fitTransform.scaleX, mh * fitTransform.scaleY];
}

function modelToContainerFace(box: { x: number; y: number; width: number; height: number }): BoundingBox {
  return { x: box.x * fitTransform.scaleX + fitTransform.offsetX, y: box.y * fitTransform.scaleY + fitTransform.offsetY, w: box.width * fitTransform.scaleX, h: box.height * fitTransform.scaleY };
}

function applyMirror(x: number, containerW: number, boxW: number): number {
  return mirrorEnabled ? containerW - x - boxW : x;
}

export function setupCanvases(videoEl: HTMLVideoElement): void {
  const resize = () => {
    const vw = videoEl.videoWidth || 1280, vh = videoEl.videoHeight || 720;
    const container = videoEl.parentElement;
    const cw = container?.clientWidth || vw, ch = container?.clientHeight || vh;
    computeFitTransform(vw, vh, cw, ch);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const id of ['overlay-objects', 'overlay-faces']) {
      const canvas = document.getElementById(id) as HTMLCanvasElement;
      if (!canvas) continue;
      canvas.width = cw * dpr; canvas.height = ch * dpr;
      canvas.style.width = '100%'; canvas.style.height = '100%';
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctxCache.set(id, ctx);
      logicalSize.set(id, { w: cw, h: ch });
    }
  };
  let timer: ReturnType<typeof setTimeout>;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(resize, 100); };
  videoEl.addEventListener('loadedmetadata', resize);
  videoEl.addEventListener('loadeddata', resize);
  window.addEventListener('resize', debounced);
}

export function setMirror(enabled: boolean): void { mirrorEnabled = enabled; }

export function clearCanvas(canvasId: string): void {
  const ctx = getCtx(canvasId);
  if (!ctx) return;
  const size = logicalSize.get(canvasId);
  ctx.clearRect(0, 0, size?.w ?? ctx.canvas.width, size?.h ?? ctx.canvas.height);
}

function getSmoothedBox(key: string, x: number, y: number, w: number, h: number): SmoothedBox {
  let box = smoothedBoxes.get(key);
  if (!box) { box = { x, y, w, h, age: performance.now() }; smoothedBoxes.set(key, box); return box; }
  box.age = performance.now();
  box.x = box.x * (1 - SMOOTH_FACTOR) + x * SMOOTH_FACTOR;
  box.y = box.y * (1 - SMOOTH_FACTOR) + y * SMOOTH_FACTOR;
  box.w = box.w * (1 - SMOOTH_FACTOR) + w * SMOOTH_FACTOR;
  box.h = box.h * (1 - SMOOTH_FACTOR) + h * SMOOTH_FACTOR;
  return box;
}

export function drawObjectBoxes(canvasId: string, detections: Detection[], showConfidence: boolean): void {
  const ctx = getCtx(canvasId);
  if (!ctx) return;
  const size = logicalSize.get(canvasId);
  const cw = size?.w ?? ctx.canvas.width, ch = size?.h ?? ctx.canvas.height;
  ctx.clearRect(0, 0, cw, ch);

  const stroke = '#3c3f45';
  const pillBg = '#2b2d31';
  const pillText = '#f3f1ed';

  ctx.font = '500 11px var(--font, sans-serif)';
  const now = performance.now();
  for (const [k, v] of smoothedBoxes) { if (now - v.age > BOX_EXPIRY_MS) smoothedBoxes.delete(k); }

  for (const d of detections) {
    const [cx, cy, cw2, ch2] = modelToContainer(d.bbox);
    const mx = applyMirror(cx, size?.w ?? cw, cw2);
    const key = `obj-${d.class}-${Math.round(d.bbox[0] / 10)}-${Math.round(d.bbox[1] / 10)}`;
    const smooth = getSmoothedBox(key, mx, cy, cw2, ch2);
    const label = showConfidence ? `${d.class} ${Math.round(d.score * 100)}%` : d.class;
    drawBox(ctx, { x: smooth.x, y: smooth.y, w: smooth.w, h: smooth.h }, { strokeColor: stroke, pillBg, pillText, label });
  }
}

export function drawFaceBoxes(canvasId: string, detections: FaceDetectionBox[], names: string[]): void {
  const ctx = getCtx(canvasId);
  if (!ctx) return;
  const size = logicalSize.get(canvasId);
  const cw = size?.w ?? ctx.canvas.width, ch = size?.h ?? ctx.canvas.height;
  ctx.clearRect(0, 0, cw, ch);

  const stroke = '#6b6f77';
  const pillBg = '#3c3f45';
  const pillText = '#d7d1c6';

  ctx.font = '500 11px var(--font, sans-serif)';

  for (let i = 0; i < detections.length; i++) {
    const box = detections[i].detection?.box;
    if (!box) continue;
    const transformed = modelToContainerFace(box);
    const mx = applyMirror(transformed.x, size?.w ?? cw, transformed.w);
    const key = `face-${names[i]}-${Math.round(box.x / 10)}-${Math.round(box.y / 10)}`;
    const smooth = getSmoothedBox(key, mx, transformed.y, transformed.w, transformed.h);
    drawBox(ctx, { x: smooth.x, y: smooth.y, w: smooth.w, h: smooth.h }, { strokeColor: stroke, pillBg, pillText, label: names[i] || 'Unknown' });
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
  roundedRect(ctx, box.x, box.y, box.w, box.h, 4);
  ctx.strokeStyle = opts.strokeColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  const tw = ctx.measureText(opts.label).width;
  const pw = tw + 8, ph = 16;
  const px = box.x, py = Math.max(0, box.y - ph - 2);
  ctx.fillStyle = opts.pillBg;
  roundedRect(ctx, px, py, pw, ph, 3);
  ctx.fill();
  ctx.fillStyle = opts.pillText;
  ctx.font = '500 9px var(--font, sans-serif)';
  ctx.fillText(opts.label, px + 4, py + 11);
}
