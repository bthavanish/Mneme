const CONSENT_KEY = 'mneme_consent_given';

export function hasConsent(): boolean {
  return localStorage.getItem(CONSENT_KEY) === 'true';
}

export function setConsent(value: boolean): void {
  localStorage.setItem(CONSENT_KEY, String(value));
}
