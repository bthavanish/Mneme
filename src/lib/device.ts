export const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
export const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
