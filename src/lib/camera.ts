/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * camera.ts - wraps getUserMedia, pretty straightforward
 */

let stream: MediaStream | null = null;

export async function startCamera(
  videoEl: HTMLVideoElement,
  facingMode: 'user' | 'environment' = 'user'
): Promise<void> {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode },
    });
    videoEl.srcObject = stream;
    await videoEl.play();
  } catch (err: any) {
    if (err.name === 'NotAllowedError') throw new Error('Camera blocked. Check browser settings.');
    if (err.name === 'NotFoundError') throw new Error('No camera found.');
    throw err;
  }
}

export function stopCamera(): void {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
}
