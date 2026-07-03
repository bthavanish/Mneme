import type { AppMode } from '../types';

const STORAGE_KEY = 'vision_mode';

let currentMode: AppMode = (localStorage.getItem(STORAGE_KEY) as AppMode) || 'objects';
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
