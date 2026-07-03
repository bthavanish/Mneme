/**
 * Detection Log Panel — logs all detected objects and their confidence.
 * Desktop-only panel that shows a running list of detections.
 */
import type { Detection } from '../types';

interface LogEntry {
  id: string;
  label: string;
  confidence: number;
  icon: string;
  timestamp: number;
  type: 'object' | 'face';
}

const MAX_ENTRIES = 50;
let entries: LogEntry[] = [];
let listEl: HTMLElement | null = null;
let emptyEl: HTMLElement | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const OBJECT_ICONS: Record<string, string> = {
  person: 'person',
  car: 'directions_car',
  truck: 'local_shipping',
  bus: 'directions_bus',
  motorcycle: 'two_wheeler',
  bicycle: 'pedal_bike',
  dog: 'pets',
  cat: 'cat',
  bird: 'flutter',
  bottle: 'local_drink',
  cup: 'coffee',
  phone: 'smartphone',
  laptop: 'laptop',
  tv: 'tv',
  book: 'book',
  chair: 'chair',
  couch: 'weekend',
  bed: 'bed',
  dining_table: 'table_restaurant',
  refrigerator: 'kitchen',
  clock: 'schedule',
  scissors: 'content_cut',
  teddy_bear: 'stuffed',
  hair_dryer: 'hair_dryer',
  toothbrush: 'cleaning_services',
};

function getIcon(label: string): string {
  return OBJECT_ICONS[label] || 'category';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function initDetectionLog(): void {
  listEl = document.getElementById('detection-log-list');
  emptyEl = document.getElementById('detection-log-empty');

  const closeBtn = document.getElementById('btn-close-log');
  closeBtn?.addEventListener('click', () => {
    const panel = document.getElementById('detection-log-panel');
    panel?.classList.remove('open');
  });
}

export function logObjectDetections(detections: Detection[]): void {
  if (!listEl || !emptyEl) return;
  if (detections.length === 0) return;

  for (const d of detections) {
    // Deduplicate: don't add if same label already at top
    if (entries.length > 0 && entries[0].label === d.class && entries[0].type === 'object') {
      // Update confidence of existing entry
      entries[0].confidence = d.score;
      entries[0].timestamp = Date.now();
      continue;
    }

    entries.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: d.class,
      confidence: d.score,
      icon: getIcon(d.class),
      timestamp: Date.now(),
      type: 'object',
    });
  }

  // Trim old entries
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(0, MAX_ENTRIES);
  }

  scheduleRender();
}

export function logFaceDetections(names: string[]): void {
  if (!listEl || !emptyEl) return;
  if (names.length === 0) return;

  for (const name of names) {
    if (name === 'Unknown') continue; // Don't log unknowns

    entries.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: name,
      confidence: 1.0,
      icon: 'face',
      timestamp: Date.now(),
      type: 'face',
    });
  }

  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(0, MAX_ENTRIES);
  }

  scheduleRender();
}

function scheduleRender(): void {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    renderList();
  }, 200);
}

function renderList(): void {
  if (!listEl || !emptyEl) return;

  if (entries.length === 0) {
    emptyEl.style.display = 'flex';
    listEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  listEl.style.display = '';

  // Only update DOM if count changed
  const existingItems = listEl.children.length;
  if (existingItems !== entries.length) {
    listEl.innerHTML = '';
    for (const entry of entries) {
      listEl.appendChild(createLogItem(entry));
    }
  } else {
    // Update in place for performance
    for (let i = 0; i < entries.length; i++) {
      const item = listEl.children[i] as HTMLElement;
      if (item && item.dataset.entryId === entries[i].id) {
        updateLogItem(item, entries[i]);
      }
    }
  }
}

function createLogItem(entry: LogEntry): HTMLElement {
  const item = document.createElement('div');
  item.className = 'md3-detection-log__item';
  item.dataset.entryId = entry.id;
  item.style.animation = `box-appear var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized-decelerate)`;

  item.innerHTML = `
    <div class="md3-detection-log__item-icon">
      <span class="material-symbols-outlined">${entry.icon}</span>
    </div>
    <div class="md3-detection-log__item-info">
      <div class="md3-detection-log__item-label">${escapeHtml(entry.label)}</div>
      <div class="md3-detection-log__item-detail">${entry.type === 'face' ? 'Face recognized' : 'Object detected'} · ${formatTime(entry.timestamp)}</div>
    </div>
    <div class="md3-detection-log__item-confidence">${Math.round(entry.confidence * 100)}%</div>
  `;

  return item;
}

function updateLogItem(item: HTMLElement, entry: LogEntry): void {
  const conf = item.querySelector('.md3-detection-log__item-confidence');
  if (conf) conf.textContent = `${Math.round(entry.confidence * 100)}%`;
  const detail = item.querySelector('.md3-detection-log__item-detail');
  if (detail) detail.textContent = `${entry.type === 'face' ? 'Face recognized' : 'Object detected'} · ${formatTime(entry.timestamp)}`;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
