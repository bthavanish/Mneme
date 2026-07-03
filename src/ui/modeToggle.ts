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
  const buttons = document.querySelectorAll('.nav-rail-item');

  buttons.forEach((btn) => {
    const modeBtn = btn as HTMLElement;
    if (modeBtn.dataset.mode === currentMode) {
      setActiveButton(modeBtn);
    }

    btn.addEventListener('click', () => {
      const newMode = modeBtn.dataset.mode as AppMode;
      if (newMode === currentMode) return;
      currentMode = newMode;
      localStorage.setItem(STORAGE_KEY, currentMode);
      setActiveButton(modeBtn);
      onModeChange?.(currentMode);
    });
  });
}

function setActiveButton(activeBtn: HTMLElement): void {
  document.querySelectorAll('.nav-rail-item').forEach((b) => {
    b.classList.remove('active');
  });
  activeBtn.classList.add('active');
}

export function getCurrentMode(): AppMode {
  return currentMode;
}
