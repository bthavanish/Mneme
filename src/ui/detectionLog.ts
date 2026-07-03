/**
 * Detection Log Panel — logs all detected objects and their confidence.
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
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// All valid Material Symbols Outlined icon names
const OBJECT_ICONS: Record<string, string> = {
  person: 'person',
  car: 'directions_car',
  truck: 'local_shipping',
  bus: 'directions_bus',
  motorcycle: 'two_wheeler',
  bicycle: 'pedal_bike',
  dog: 'pets',
  cat: 'pets',
  bird: 'emoji_nature',
  bottle: 'local_drink',
  cup: 'coffee',
  cell_phone: 'smartphone',
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
  teddy_bear: 'toys',
  hair_dryer: 'air',
  toothbrush: 'cleaning_services',
  keyboard: 'keyboard',
  mouse: 'mouse',
  remote: 'remote_gen',
  keyboard_mouse: 'mouse',
  tie: 'checkroom',
  suitcase: 'work',
  frisbee: 'sports_baseball',
  skis: 'downhill_skiing',
  snowboard: 'snowboarding',
  sports_ball: 'sports_baseball',
  kite: 'toys',
  baseball_bat: 'sports_baseball',
  baseball_glove: 'sports_baseball',
  skateboard: 'skateboarding',
  surfboard: 'surfing',
  tennis_racket: 'sports_tennis',
  wine_glass: 'local_bar',
  fork: 'restaurant',
  knife: 'content_cut',
  spoon: 'restaurant',
  bowl: 'restaurant',
  banana: 'nutrition',
  apple: 'nutrition',
  sandwich: 'lunch_dining',
  orange: 'nutrition',
  broccoli: 'nutrition',
  carrot: 'nutrition',
  pizza: 'local_pizza',
  donut: 'bakery_dining',
  cake: 'bakery_dining',
  chair_lamp: 'chair',
  potted_plant: 'yard',
  vase: 'local_florist',
  umbrella: 'umbrella',
  handbag: 'shopping_bag',
  backpack: 'school',
  suitcase_2: 'work',
  bottle_2: 'local_drink',
};

function getIcon(label: string): string {
  return OBJECT_ICONS[label] || 'category';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// Desktop log elements
let desktopListEl: HTMLElement | null = null;
let desktopEmptyEl: HTMLElement | null = null;

// Mobile log elements
let mobileListEl: HTMLElement | null = null;
let mobileEmptyEl: HTMLElement | null = null;

export function initDetectionLog(): void {
  desktopListEl = document.getElementById('detection-log-list');
  desktopEmptyEl = document.getElementById('detection-log-empty');
  mobileListEl = document.getElementById('mobile-log-list');
  mobileEmptyEl = document.getElementById('mobile-log-empty');

  // Desktop close
  document.getElementById('btn-close-log')?.addEventListener('click', () => {
    document.getElementById('detection-log-panel')?.classList.remove('open');
  });

  // Mobile open/close
  document.getElementById('btn-logs-mobile')?.addEventListener('click', () => {
    document.getElementById('mobile-log-sheet')?.classList.add('open');
    document.getElementById('scrim')?.classList.add('visible');
    renderAllLists();
  });

  document.getElementById('btn-close-mobile-log')?.addEventListener('click', closeMobileLog);

  document.getElementById('mobile-log-handle')?.addEventListener('click', closeMobileLog);
}

function closeMobileLog(): void {
  document.getElementById('mobile-log-sheet')?.classList.remove('open');
  document.getElementById('scrim')?.classList.remove('visible');
}

export function logObjectDetections(detections: Detection[]): void {
  if (detections.length === 0) return;

  for (const d of detections) {
    if (entries.length > 0 && entries[0].label === d.class && entries[0].type === 'object') {
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

  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(0, MAX_ENTRIES);
  }

  scheduleRender();
}

export function logFaceDetections(names: string[]): void {
  if (names.length === 0) return;

  for (const name of names) {
    if (name === 'Unknown') continue;

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
    renderAllLists();
  }, 200);
}

function renderAllLists(): void {
  renderList(desktopListEl, desktopEmptyEl);
  renderList(mobileListEl, mobileEmptyEl);
}

function renderList(listElement: HTMLElement | null, emptyElement: HTMLElement | null): void {
  if (!listElement || !emptyElement) return;

  if (entries.length === 0) {
    emptyElement.style.display = 'flex';
    listElement.style.display = 'none';
    return;
  }

  emptyElement.style.display = 'none';
  listElement.style.display = '';

  // Virtual DOM diffing — only add/update/remove changed entries
  const existingIds = new Set<string>();
  const existingEls = new Map<string, HTMLElement>();

  for (const child of Array.from(listElement.children)) {
    const el = child as HTMLElement;
    const id = el.dataset.entryId;
    if (id) {
      existingIds.add(id);
      existingEls.set(id, el);
    }
  }

  const newIds = new Set(entries.map(e => e.id));

  // Remove entries no longer present
  for (const id of existingIds) {
    if (!newIds.has(id)) {
      existingEls.get(id)?.remove();
    }
  }

  // Add/update entries in order
  for (const entry of entries) {
    if (existingIds.has(entry.id)) {
      // Update existing: update confidence text
      const el = existingEls.get(entry.id);
      if (el) {
        const confEl = el.querySelector('.md3-detection-log__item-confidence');
        if (confEl) confEl.textContent = `${Math.round(entry.confidence * 100)}%`;
      }
    } else {
      // Add new entry at correct position
      const newEl = createLogItem(entry);
      if (entries.indexOf(entry) === 0) {
        listElement.prepend(newEl);
      } else {
        // Find previous sibling
        const prevEntry = entries[entries.indexOf(entry) - 1];
        const prevEl = existingEls.get(prevEntry?.id) || listElement.lastElementChild;
        if (prevEl) {
          prevEl.after(newEl);
        } else {
          listElement.appendChild(newEl);
        }
      }
    }
  }
}

function createLogItem(entry: LogEntry): HTMLElement {
  const item = document.createElement('div');
  item.className = 'md3-detection-log__item';
  item.dataset.entryId = entry.id;

  const iconDiv = document.createElement('div');
  iconDiv.className = 'md3-detection-log__item-icon';
  iconDiv.innerHTML = `<span class="material-symbols-outlined">${entry.icon}</span>`;

  const infoDiv = document.createElement('div');
  infoDiv.className = 'md3-detection-log__item-info';
  infoDiv.innerHTML = `
    <div class="md3-detection-log__item-label">${escapeHtml(entry.label)}</div>
    <div class="md3-detection-log__item-detail">${entry.type === 'face' ? 'Face recognized' : 'Object detected'} · ${formatTime(entry.timestamp)}</div>
  `;

  const confDiv = document.createElement('div');
  confDiv.className = 'md3-detection-log__item-confidence';
  confDiv.textContent = `${Math.round(entry.confidence * 100)}%`;

  item.appendChild(iconDiv);
  item.appendChild(infoDiv);
  item.appendChild(confDiv);

  return item;
}
