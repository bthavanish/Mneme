/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * deviceProfile.ts - figures out what tier the device is at
 * replaced the dumb isMobile UA check with actual capability probing
 */

export type DeviceTier = 'low' | 'medium' | 'high';
export type MLBackend = 'webgl' | 'wasm' | 'cpu';

export interface DeviceProfile {
  backend: MLBackend;
  tier: DeviceTier;
  objectInputSize: number;
  faceInputSize: number;
  objectIntervalMs: number;
  faceIntervalMs: number;
  detectorBase: 'lite_mobilenet_v2' | 'mobilenet_v2';
  maxDpr: number;
}

const TIER_CONFIGS: Record<DeviceTier, Omit<DeviceProfile, 'backend' | 'tier' | 'detectorBase' | 'maxDpr'>> = {
  low: { objectInputSize: 320, faceInputSize: 128, objectIntervalMs: 300, faceIntervalMs: 500 },
  medium: { objectInputSize: 416, faceInputSize: 160, objectIntervalMs: 150, faceIntervalMs: 300 },
  high: { objectInputSize: 640, faceInputSize: 224, objectIntervalMs: 100, faceIntervalMs: 200 },
};

function detectBackend(): MLBackend {
  const tf = (window as any).tf;
  if (tf?.getBackend?.() === 'webgl') return 'webgl';
  if (tf?.findBackendName?.('wasm')) return 'wasm';
  return 'cpu';
}

function probeHardwareScore(): number {
  let score = 0;
  const cores = navigator.hardwareConcurrency || 2;
  score += cores >= 8 ? 3 : cores >= 4 ? 2 : 1;

  const mem = (navigator as any).deviceMemory;
  if (mem >= 8) score += 3;
  else if (mem >= 4) score += 2;
  else if (mem >= 2) score += 1;

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL).toLowerCase();
        if (/apple|m[1-4]|radeon|geforce|adreno [67]/i.test(renderer)) score += 4;
        else if (/adreno [45]|mali|powervr|intel/i.test(renderer)) score += 2;
        else score += 1;
      }
    }
  } catch {}
  return score;
}

function tierFromScore(score: number): DeviceTier {
  if (score >= 8) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

let cachedProfile: DeviceProfile | null = null;

export function getDeviceProfile(): DeviceProfile {
  if (cachedProfile) return cachedProfile;
  const backend = detectBackend();
  const hwTier = tierFromScore(probeHardwareScore());
  const backendTier: DeviceTier = backend === 'webgl' ? 'medium' : 'low';
  const tierOrder: DeviceTier[] = ['low', 'medium', 'high'];
  const tier = tierOrder.indexOf(hwTier) < tierOrder.indexOf(backendTier) ? hwTier : backendTier;
  const config = TIER_CONFIGS[tier];
  cachedProfile = {
    backend, tier, ...config,
    detectorBase: tier === 'high' ? 'mobilenet_v2' : 'lite_mobilenet_v2',
    maxDpr: tier === 'high' ? 2 : tier === 'medium' ? 1.5 : 1,
  };
  return cachedProfile;
}

export function logDeviceProfile(): void {
  const p = getDeviceProfile();
  console.log(`[mneme] device: tier=${p.tier} backend=${p.backend} obj=${p.objectInputSize}px@${Math.round(1000 / p.objectIntervalMs)}fps face=${p.faceInputSize}px@${Math.round(1000 / p.faceIntervalMs)}fps`);
}
