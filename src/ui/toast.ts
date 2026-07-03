/**
 * MD3 Snackbar / Toast notification.
 */
const container = document.getElementById('toast-container')!;

export function showToast(message: string, duration = 3000): void {
  const toast = document.createElement('div');
  toast.className = 'md3-toast';
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}
