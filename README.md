# Mneme

Point your camera at things. Get labeled boxes around objects, or recognize faces you have saved. Everything runs in your browser, nothing leaves your device.

## What it does

Two detection modes, running at the same time if you want:

- **Object detection** using COCO-SSD. Identifies 80 common objects (person, dog, car, cup, etc.) with bounding boxes and labels.
- **Face recognition** using a local face library you build yourself. Save a face with a name, and the app matches it on sight. Unknown faces show as "Unknown."

You pick which mode to run: objects only, faces only, or both.

## Getting started

**Requirements:** Node.js 18+, a camera, and a modern browser (Chrome, Firefox, Safari, Edge).

```bash
npm install
npm run dev
```

Open the URL printed in your terminal. Allow camera access when prompted.

**To test on Android:**

```bash
npm run dev -- --host 0.0.0.0
```

Find your laptop IP (`hostname -I` on Linux, `ipconfig getifaddr en0` on Mac), then open `http://<your-ip>:5173` on your phone. Same Wi-Fi required.

## Building for production

```bash
npm run build
npm run preview -- --host 0.0.0.0
```

Output goes to `dist/`. Deploy it anywhere static files are served.

## How it works

All ML runs in the browser via TensorFlow.js (WebGL backend). No server, no API keys, no accounts.

**Object detection** loads COCO-SSD with MobileNet v2 as the base model. On mobile it uses lite_mobilenet_v2 to save GPU time. Weights come from TensorFlow Hub automatically. Detection runs at 12fps on desktop, 8fps on mobile.

**Face recognition** uses vladmandic/face-api (a maintained fork of face-api.js). The TinyFaceDetector runs at 5fps desktop, 3fps mobile. Face descriptors are 128-dimensional vectors compared with Euclidean distance. The threshold is configurable (default 0.5).

Face data is stored in IndexedDB. A consent dialog appears before any storage happens.

## Settings

Open the settings panel from the top bar gear icon:

| Setting | What it does |
|---------|-------------|
| Show confidence scores | Display percentage on object boxes |
| Mirror camera | Flip the video feed horizontally |
| Detection threshold | Minimum confidence for object detection (0.3-0.9) |
| Face match distance | Maximum distance for a face match (0.3-0.7) |
| Dark mode | Override system preference |
| Delete all face data | Wipe IndexedDB face store |

## Project structure

```
src/
  lib/
    camera.ts        getUserMedia wrapper
    detector.ts      COCO-SSD wrapper with throttled loop
    device.ts        shared mobile/desktop detection
    faceEngine.ts    face-api detection and matching
    faceStore.ts     IndexedDB read/write for face descriptors
    consent.ts       localStorage consent gate
  ui/
    canvas.ts        bounding box drawing on overlay canvases
    sidebar.ts       face gallery panel
    toast.ts         snackbar notifications
    modeToggle.ts    object/face/both mode switcher
  styles/
    tokens.css       MD3 color, shape, elevation, motion tokens
    layout.css       app shell, nav rail, camera overlay, sidebar
    animations.css   keyframes for toast, skeleton, nav indicator
  main.ts            entry point, bootstraps everything
  types.ts           shared TypeScript types
public/
  models/            face-api model weights (committed to repo)
```

## Tech stack

- Vite + vanilla TypeScript
- TensorFlow.js (WebGL backend)
- COCO-SSD (MobileNet v2 / lite_mobilenet_v2)
- vladmandic/face-api
- Material Web Components for interactive elements
- MD3 design tokens via CSS custom properties

All ML libraries load from CDN. The JS bundle is under 15KB. Model weights for face-api are hosted alongside the built site (~6.5MB total).

## Deploying to GitHub Pages

Push to `main`. The GitHub Actions workflow builds the project and deploys to Pages automatically.

One-time setup: repo Settings > Pages > Source > GitHub Actions.

## License

MIT
