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
  document.querySelectorAll('[data-mode]').forEach((b) => {
    const el = b as HTMLElement;
    const wasActive = el.classList.contains('active');
    el.classList.toggle('active', el.dataset.mode === mode);

    // Spring-bounce the icon on newly active item
    if (el.dataset.mode === mode && !wasActive) {
      const icon = el.querySelector('.material-symbols-outlined') as HTMLElement;
      if (icon) {
        icon.style.transition = 'none';
        icon.style.transform = 'scale(0.7) rotate(-10deg)';
        requestAnimationFrame(() => {
          icon.style.transition = 'transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)';
          icon.style.transform = '';
        });
      }
    }
  });
}

export function getCurrentMode(): AppMode {
  return currentMode;
}
