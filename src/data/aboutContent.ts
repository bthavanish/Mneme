export interface TeamMember {
  file: string;
  name: string;
  role?: string;
}

export interface AboutManifest {
  team: TeamMember[];
}

const SHAPES = [
  'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
  'polygon(25% 0%, 100% 0%, 75% 100%, 0% 100%)',
  'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  'polygon(30% 0%, 100% 0%, 100% 70%, 70% 100%, 0% 100%, 0% 30%)',
  'ellipse(48% 42% at 50% 50%)',
  'polygon(50% 0%, 90% 20%, 100% 60%, 75% 100%, 25% 100%, 0% 60%, 10% 20%)',
  'polygon(20% 0%, 80% 0%, 100% 20%, 100% 80%, 80% 100%, 20% 100%, 0% 80%, 0% 20%)',
  'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
  'polygon(50% 0%, 85% 10%, 100% 43%, 94% 82%, 68% 100%, 32% 100%, 6% 82%, 0% 43%, 15% 10%)',
  'polygon(40% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 60%)',
  'circle(45% at 50% 50%)',
  'polygon(50% 5%, 90% 25%, 95% 70%, 65% 100%, 35% 100%, 5% 70%, 10% 25%)',
];

const GRADIENTS = [
  'linear-gradient(135deg, var(--md-sys-color-primary-container), var(--md-sys-color-tertiary-container))',
  'linear-gradient(160deg, var(--md-sys-color-secondary-container), var(--md-sys-color-primary-container))',
  'linear-gradient(120deg, var(--md-sys-color-tertiary-container), var(--md-sys-color-error-container))',
  'linear-gradient(145deg, var(--md-sys-color-primary-container), var(--md-sys-color-secondary-container))',
  'linear-gradient(130deg, var(--md-sys-color-error-container), var(--md-sys-color-tertiary-container))',
  'linear-gradient(155deg, var(--md-sys-color-secondary-container), var(--md-sys-color-tertiary-container))',
];

export function getRandomShape(seed: number): string {
  return SHAPES[seed % SHAPES.length];
}

export function getRandomGradient(seed: number): string {
  return GRADIENTS[seed % GRADIENTS.length];
}

export function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
