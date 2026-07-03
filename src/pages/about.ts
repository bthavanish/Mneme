import { getRandomShape, getRandomGradient, shuffleWithSeed } from '../data/aboutContent';
import type { TeamMember } from '../data/aboutContent';

const PIC_BASE = import.meta.env.BASE_URL + 'pics/';

let manifestCache: TeamMember[] | null = null;

async function fetchManifest(): Promise<TeamMember[]> {
  if (manifestCache) return manifestCache;
  try {
    const res = await fetch(PIC_BASE + 'manifest.json');
    if (!res.ok) return [];
    manifestCache = await res.json();
    return manifestCache || [];
  } catch {
    return [];
  }
}

export function prefetchManifest(): void {
  fetchManifest().catch(() => {});
}

export async function renderAboutPage(): Promise<void> {
  const container = document.getElementById('about-page');
  if (!container) return;

  // Re-render guard: only render once
  const contentContainer = document.getElementById('about-page-content');
  if (!contentContainer) return;
  if (contentContainer.dataset.rendered === 'true') return;
  contentContainer.dataset.rendered = 'true';

  const team = await fetchManifest();
  const seed = Date.now() % 1000;
  const shuffled = shuffleWithSeed(team, seed);

  let teamHTML = '';
  shuffled.forEach((member, i) => {
    const shape = getRandomShape(seed + i);
    const gradient = getRandomGradient(seed + i);
    teamHTML += `
      <div class="about-team-card" style="--shape: ${shape}; --card-gradient: ${gradient};">
        <div class="about-team-img-wrap">
          <img src="${PIC_BASE}${member.file}" alt="${member.name}" loading="eager" class="about-team-img">
        </div>
        <span class="about-team-name">${member.name}</span>
        ${member.role ? `<span class="about-team-role">${member.role}</span>` : ''}
      </div>
    `;
  });

  contentContainer.innerHTML = `
    <div class="about-content">
      <div class="about-hero">
        <div class="about-hero-bg">
          <div class="about-hero-shape about-hero-shape--1"></div>
          <div class="about-hero-shape about-hero-shape--2"></div>
          <div class="about-hero-shape about-hero-shape--3"></div>
        </div>
        <span class="material-symbols-outlined about-hero-icon">visibility</span>
        <h1 class="about-title">Mneme</h1>
        <p class="about-subtitle">Object detection and face recognition, running right in your browser.</p>
      </div>

      <section class="about-section">
        <h2 class="about-section-title">Team</h2>
        <div class="about-team-grid">
          ${teamHTML || '<p class="about-empty">No team images yet.</p>'}
        </div>
      </section>

      <section class="about-section">
        <h2 class="about-section-title">How It Works</h2>
        <div class="about-how-grid">
          <div class="about-how-card">
            <div class="about-how-icon-wrap about-how-icon-wrap--camera">
              <span class="material-symbols-outlined">videocam</span>
            </div>
            <h3>Live Camera Feed</h3>
            <p>Mneme reads your camera feed frame by frame. Nothing leaves your device — the entire pipeline runs locally in your browser.</p>
          </div>
          <div class="about-how-card">
            <div class="about-how-icon-wrap about-how-icon-wrap--objects">
              <span class="material-symbols-outlined">category</span>
            </div>
            <h3>Object Detection</h3>
            <p>A TensorFlow.js model identifies 80 types of objects in real time: people, vehicles, animals, furniture, electronics, and more. Each detection includes a confidence score and bounding box.</p>
          </div>
          <div class="about-how-card">
            <div class="about-how-icon-wrap about-how-icon-wrap--face">
              <span class="material-symbols-outlined">face</span>
            </div>
            <h3>Face Recognition</h3>
            <p>Register a face with a name, and Mneme remembers it. The next time that person appears, Mneme matches them against stored face descriptors and displays their name.</p>
          </div>
          <div class="about-how-card">
            <div class="about-how-icon-wrap about-how-icon-wrap--local">
              <span class="material-symbols-outlined">smart_toy</span>
            </div>
            <h3>All On-Device</h3>
            <p>TensorFlow.js runs inference through WebGL and WebAssembly. No cloud APIs, no server round-trips. The models load once and run at 5–15 frames per second.</p>
          </div>
          <div class="about-how-card">
            <div class="about-how-icon-wrap about-how-icon-wrap--privacy">
              <span class="material-symbols-outlined">lock</span>
            </div>
            <h3>Privacy by Design</h3>
            <p>Face data stays as 128-number fingerprints in your browser's IndexedDB. No photos are stored. No data is transmitted. Delete everything with one tap.</p>
          </div>
          <div class="about-how-card">
            <div class="about-how-icon-wrap about-how-icon-wrap--platform">
              <span class="material-symbols-outlined">phone_iphone</span>
            </div>
            <h3>Works Everywhere</h3>
            <p>Desktop, tablet, phone — Mneme adapts to your screen. On mobile, it uses a bottom navigation bar. On desktop, a navigation rail and side panel.</p>
          </div>
        </div>
      </section>

      <section class="about-section">
        <h2 class="about-section-title">Technology Stack</h2>
        <div class="about-stack">
          <div class="about-stack-item">
            <span class="material-symbols-outlined about-stack-icon">memory</span>
            <div>
              <strong>TensorFlow.js</strong>
              <span>Machine learning inference in the browser via WebGL/WebAssembly</span>
            </div>
          </div>
          <div class="about-stack-item">
            <span class="material-symbols-outlined about-stack-icon">category</span>
            <div>
              <strong>COCO-SSD</strong>
              <span>Object detection model trained on 80 common categories</span>
            </div>
          </div>
          <div class="about-stack-item">
            <span class="material-symbols-outlined about-stack-icon">face</span>
            <div>
              <strong>face-api.js</strong>
              <span>Face detection, landmark extraction, and 128-dimensional descriptors</span>
            </div>
          </div>
          <div class="about-stack-item">
            <span class="material-symbols-outlined about-stack-icon">palette</span>
            <div>
              <strong>Material Web</strong>
              <span>Google's Material Design 3 web components</span>
            </div>
          </div>
          <div class="about-stack-item">
            <span class="material-symbols-outlined about-stack-icon">colorize</span>
            <div>
              <strong>material-color-utilities</strong>
              <span>Dynamic color theming from a single seed color</span>
            </div>
          </div>
          <div class="about-stack-item">
            <span class="material-symbols-outlined about-stack-icon">build</span>
            <div>
              <strong>Vite + TypeScript</strong>
              <span>Fast builds, strict typing, modern tooling</span>
            </div>
          </div>
        </div>
      </section>

      <section class="about-section">
        <h2 class="about-section-title">Capstone Project</h2>
        <div class="about-capstone">
          <div class="about-capstone-highlight">
            <span class="material-symbols-outlined">school</span>
            <span>Capstone Project</span>
          </div>
          <p>Mneme is a capstone project that proves real-time computer vision can run entirely inside a web browser. It combines WebGL-accelerated inference, WebAssembly, and the MediaDevices API to deliver frame-by-frame detection without any server dependency.</p>
          <p>The system registers faces as 128-dimensional descriptor vectors stored in IndexedDB. When a face appears on camera, the app computes its descriptor and matches it against registered faces using Euclidean distance. This happens at 5–15 FPS on consumer hardware.</p>
          <p>The interface uses Material Design 3 with dynamic color theming. It switches between mobile (bottom nav) and desktop (rail + side panel) layouts at a 600px breakpoint. The camera feed sits in a rounded container with overlay canvases for detection boxes.</p>
          <div class="about-capstone-name">
            <span class="material-symbols-outlined">auto_awesome</span>
            <p><strong>Why "Mneme"?</strong> In Greek mythology, Mneme is the goddess of memory. The name reflects the app's core ability: remembering faces across sessions.</p>
          </div>
        </div>
      </section>
    </div>
  `;
}
