let stream: MediaStream | null = null;

export async function startCamera(videoEl: HTMLVideoElement): Promise<void> {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      },
    });
    videoEl.srcObject = stream;
    await videoEl.play();
  } catch (err: any) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Camera access blocked. Enable it in browser settings.');
    }
    if (err.name === 'NotFoundError') {
      throw new Error('No camera detected on this device.');
    }
    throw err;
  }
}

export function stopCamera(): void {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

export function getVideoDimensions(videoEl: HTMLVideoElement): { width: number; height: number } {
  return { width: videoEl.videoWidth || 1280, height: videoEl.videoHeight || 720 };
}
