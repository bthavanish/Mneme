/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * modeToggle.ts - syncs nav rail (desktop) and bottom nav (mobile)
 */

import type { AppTab } from '../types';

const STORAGE_KEY = 'mneme_tab';
let currentTab: AppTab = (localStorage.getItem(STORAGE_KEY) as AppTab) || 'detect';
let onTabChange: ((tab: AppTab) => void) | null = null;

export function initTabToggle(callback: (tab: AppTab) => void): void {
  onTabChange = callback;
  document.querySelectorAll('[data-tab]').forEach(btn => {
    const el = btn as HTMLElement;
    el.classList.toggle('active', el.dataset.tab === currentTab);
    el.addEventListener('click', () => {
      const tab = el.dataset.tab as AppTab;
      if (tab === currentTab) return;
      currentTab = tab;
      localStorage.setItem(STORAGE_KEY, currentTab);
      document.querySelectorAll('[data-tab]').forEach(b => (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.tab === currentTab));
      onTabChange?.(currentTab);
    });
  });
}

export function getCurrentTab(): AppTab { return currentTab; }
