import { loadFaces, deleteFace } from '../lib/faceStore';
import { rebuildMatcher } from '../lib/faceEngine';
import { showToast } from './toast';

const sidebar = document.getElementById('sidebar')!;
const faceList = document.getElementById('face-list')!;
const sidebarEmpty = document.getElementById('sidebar-empty')!;
const btnClose = document.getElementById('btn-close-sidebar')!;

export function initSidebar(): void {
  btnClose.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      closeSidebar();
    }
  });
}

export function openSidebar(): void {
  sidebar.classList.add('open');
  renderFaceList();
}

export function closeSidebar(): void {
  sidebar.classList.remove('open');
}

export async function renderFaceList(): Promise<void> {
  const faces = await loadFaces();
  faceList.innerHTML = '';

  if (faces.length === 0) {
    sidebarEmpty.style.display = 'flex';
    faceList.style.display = 'none';
    return;
  }

  sidebarEmpty.style.display = 'none';
  faceList.style.display = 'block';

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
