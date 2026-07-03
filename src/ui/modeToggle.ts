/**
 * Mode toggle — syncs both nav rail (desktop) and bottom nav (mobile).
 */
import type { AppMode } from '../types';

const STORAGE_KEY = 'mneme_mode';
const validModes: AppMode[] = ['objects', 'faces', 'both'];

function getStoredMode(): AppMode {
  const raw = localStorage.getItem(STORAGE_KEY);
  return validModes.includes(raw as AppMode) ? (raw as AppMode) : 'objects';
}

let currentMode: AppMode = getStoredMode();
let onModeChange: ((mode: AppMode) => void) | null = null;

export function initModeToggle(callback: (mode: AppMode) => void): void {
  onModeChange = callback;

  // Handle both nav rail (desktop) and bottom nav (mobile)
  const allButtons = document.querySelectorAll('[data-mode]');

  allButtons.forEach((btn) => {
    const modeBtn = btn as HTMLElement;
    if (modeBtn.dataset.mode === currentMode) {
      setActiveButtons(modeBtn.dataset.mode as AppMode);
    }

    btn.addEventListener('click', () => {
      const newMode = modeBtn.dataset.mode as AppMode;
      if (newMode === currentMode) return;
      currentMode = newMode;
      localStorage.setItem(STORAGE_KEY, currentMode);
      setActiveButtons(currentMode);
      onModeChange?.(currentMode);
    });
  });
}

function setActiveButtons(mode: AppMode): void {
  // Update all nav elements that have data-mode
  document.querySelectorAll('[data-mode]').forEach((b) => {
    const el = b as HTMLElement;
    el.classList.toggle('active', el.dataset.mode === mode);
  });
}

export function getCurrentMode(): AppMode {
  return currentMode;
}
