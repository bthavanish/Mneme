import { loadFaces, deleteFace } from '../lib/faceStore';
import { rebuildMatcher } from '../lib/faceEngine';
import { showToast } from './toast';

let sidebar: HTMLElement;
let faceList: HTMLElement;
let sidebarEmpty: HTMLElement;
let btnClose: HTMLElement;
let faceCountBadge: HTMLElement | null;
let btnFaceLibrary: HTMLElement | null;

function isDesktop(): boolean {
  return window.innerWidth >= 1200;
}

export function initSidebar(): void {
  sidebar = document.getElementById('sidebar')!;
  faceList = document.getElementById('face-list')!;
  sidebarEmpty = document.getElementById('sidebar-empty')!;
  btnClose = document.getElementById('btn-close-sidebar')!;
  faceCountBadge = document.getElementById('face-count-badge');
  btnFaceLibrary = document.getElementById('btn-face-library');

  btnClose.addEventListener('click', closeSidebar);

  btnFaceLibrary?.addEventListener('click', () => {
    openSidebar();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      closeSidebar();
    }
  });

  // clicking scrim closes sidebar
  const scrim = document.getElementById('scrim');
  scrim?.addEventListener('click', () => {
    closeSidebar();
    // also close settings if open
    document.getElementById('settings-sheet')?.classList.remove('open');
    scrim.classList.remove('visible');
  });
}

export function openSidebar(): void {
  if (isDesktop()) return; // permanent on desktop
  sidebar.classList.add('open');
  const scrim = document.getElementById('scrim');
  scrim?.classList.add('visible');
  renderFaceList();
}

export function closeSidebar(): void {
  sidebar.classList.remove('open');
  const scrim = document.getElementById('scrim');
  // only hide scrim if settings is also closed
  if (!document.getElementById('settings-sheet')?.classList.contains('open')) {
    scrim?.classList.remove('visible');
  }
}

export async function renderFaceList(): Promise<void> {
  if (!faceList) return;
  const faces = await loadFaces();
  faceList.innerHTML = '';

  // update badge
  if (faceCountBadge) {
    faceCountBadge.setAttribute('value', String(faces.length));
  }

  if (faces.length === 0) {
    sidebarEmpty.style.display = 'flex';
    faceList.style.display = 'none';
    return;
  }

  sidebarEmpty.style.display = 'none';
  faceList.style.display = '';

  for (const face of faces) {
    const item = document.createElement('md-list-item');
    item.setAttribute('headline', face.name);

    const date = new Date(face.addedAt);
    const timeAgo = getTimeAgo(date);
    item.setAttribute('supporting-text', timeAgo);

    if (face.thumbnail) {
      const img = document.createElement('img');
      img.slot = 'start';
      img.src = face.thumbnail;
      img.alt = face.name;
      img.style.borderRadius = '50%';
      img.style.width = '40px';
      img.style.height = '40px';
      img.style.objectFit = 'cover';
      item.appendChild(img);
    }

    const deleteBtn = document.createElement('md-icon-button');
    deleteBtn.slot = 'end';
    deleteBtn.setAttribute('aria-label', `Delete ${face.name}`);
    deleteBtn.innerHTML = '<md-icon>delete</md-icon>';
    deleteBtn.addEventListener('click', async () => {
      await deleteFace(face.id);
      await rebuildMatcher();
      showToast(`Removed ${face.name}`);
      renderFaceList();
    });
    item.appendChild(deleteBtn);

    faceList.appendChild(item);
  }
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
