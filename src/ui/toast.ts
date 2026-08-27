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
  toast.title = 'Click to copy';
  toast.setAttribute('role', 'status');
  toast.tabIndex = 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.textContent = 'Copied';
    } catch {
      // Text remains selectable when Clipboard API is unavailable.
    }
  };
  toast.addEventListener('click', () => void copy());
  toast.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void copy(); } });
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}
