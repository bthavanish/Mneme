/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * detectionLog.ts - deduplicated detection history with cropped thumbnails
 * pauses updates when offscreen, only shows unique detections
 */

import type { Detection } from '../types';

interface LogEntry {
  id: string;
  label: string;
  type: 'object' | 'face';
  confidence?: number;
  timestamp: number;
  thumbUrl?: string;
}

const MAX_ENTRIES = 60;
const DEDUP_WINDOW_MS = 3000;
const entries: LogEntry[] = [];
const recentLabels = new Map<string, number>();
let listEl: HTMLElement | null = null;
let emptyEl: HTMLElement | null = null;
let isVisible = true;
let observer: IntersectionObserver | null = null;
let entryCounter = 0;
let videoEl: HTMLVideoElement | null = null;

export function initDetectionLog(vEl: HTMLVideoElement): void {
  videoEl = vEl;
  listEl = document.getElementById('detection-log-list');
  emptyEl = document.getElementById('detection-log-empty');
  if (!listEl) return;

  observer = new IntersectionObserver(
    ([entry]) => { isVisible = entry.isIntersecting; },
    { threshold: 0 }
  );
  observer.observe(listEl);
}

export function addObjectDetections(detections: Detection[]): void {
  if (!isVisible || !listEl || !emptyEl || detections.length === 0) return;
  for (const d of detections) {
    if (isDuplicate(d.class)) continue;
    const thumb = cropDetectionThumb(d.bbox);
    addEntry({ label: d.class, type: 'object', confidence: d.score, timestamp: Date.now(), thumbUrl: thumb });
  }
}

export function addFaceDetections(names: string[]): void {
  if (!isVisible || !listEl || !emptyEl || names.length === 0) return;
  for (const name of names) {
    if (name === 'Unknown' || name === '') continue;
    if (isDuplicate(name)) continue;
    addEntry({ label: name, type: 'face', timestamp: Date.now() });
  }
}

function isDuplicate(label: string): boolean {
  const now = Date.now();
  const last = recentLabels.get(label);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  recentLabels.set(label, now);
  // cleanup old entries
  if (recentLabels.size > 200) {
    for (const [k, v] of recentLabels) { if (now - v > DEDUP_WINDOW_MS * 2) recentLabels.delete(k); }
  }
  return false;
}

function cropDetectionThumb(bbox: [number, number, number, number]): string | undefined {
  if (!videoEl || videoEl.readyState < 2) return undefined;
  try {
    const [mx, my, mw, mh] = bbox;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    // COCO-SSD bbox is [x, y, w, h] in pixels
    const sx = Math.max(0, Math.floor(mx));
    const sy = Math.max(0, Math.floor(my));
    const sw = Math.min(Math.floor(mw), vw - sx);
    const sh = Math.min(Math.floor(mh), vh - sy);
    if (sw <= 0 || sh <= 0) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, 64, 64);
    const url = canvas.toDataURL('image/jpeg', 0.5);
    canvas.width = 0; canvas.height = 0;
    return url;
  } catch { return undefined; }
}

function addEntry(input: Omit<LogEntry, 'id'>): void {
  const entry: LogEntry = { ...input, id: `det-${entryCounter++}` };
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) {
    const removed = entries.pop();
    if (removed?.thumbUrl) URL.revokeObjectURL(removed.thumbUrl);
  }
  renderEntry(entry);
  if (emptyEl) emptyEl.style.display = 'none';
}

function renderEntry(entry: LogEntry): void {
  if (!listEl) return;
  const el = document.createElement('div');
  el.className = 'detection-log__item';
  el.dataset.id = entry.id;

  const confText = entry.confidence !== undefined ? ` ${Math.round(entry.confidence * 100)}%` : '';

  const thumbHtml = entry.thumbUrl
    ? `<img class="detection-log__item-thumb" src="${entry.thumbUrl}" alt="" loading="lazy">`
    : `<div class="detection-log__item-icon"><span class="material-symbols-outlined">${entry.type === 'face' ? 'person' : 'category'}</span></div>`;

  el.innerHTML = `
    ${thumbHtml}
    <div class="detection-log__item-info">
      <div class="detection-log__item-label">${escapeHtml(entry.label)}</div>
    </div>
    <span class="detection-log__item-confidence">${confText}</span>
  `;

  listEl.prepend(el);

  while (listEl.children.length > MAX_ENTRIES) {
    listEl.lastChild?.remove();
  }
}

export function clearLog(): void {
  entries.length = 0;
  recentLabels.clear();
  if (listEl) listEl.innerHTML = '';
  if (emptyEl) emptyEl.style.display = '';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
