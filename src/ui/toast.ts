/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * toast.ts - simple snackbar notifications
 */

export function showToast(message: string, duration = 3000): void {
  const container = document.getElementById('toast-container')!;
  const toast = document.createElement('div');
  toast.className = 'md3-toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}
