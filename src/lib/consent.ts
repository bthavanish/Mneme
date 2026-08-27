/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * consent.ts - localStorage gate for face recognition consent
 */

export function hasConsent(): boolean {
  // Keep users who enabled face memory in earlier releases enabled after an
  // upgrade that renamed the storage key.
  return localStorage.getItem('mneme_consent') === 'true' || localStorage.getItem('mneme_consent_given') === 'true';
}

export function setConsent(value: boolean): void {
  localStorage.setItem('mneme_consent', String(value));
  localStorage.setItem('mneme_consent_given', String(value));
}

const MODEL_DOWNLOAD_STATE = 'mneme_models_downloaded';

/** Records a completed local model download, separate from face-data consent. */
export function hasDownloadedModels(): boolean {
  return localStorage.getItem(MODEL_DOWNLOAD_STATE) === 'true';
}

export function setDownloadedModels(value: boolean): void {
  if (value) localStorage.setItem(MODEL_DOWNLOAD_STATE, 'true');
  else localStorage.removeItem(MODEL_DOWNLOAD_STATE);
}
