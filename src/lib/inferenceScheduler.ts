/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * inferenceScheduler.ts - time-based scheduling, only one inference at a time
 * replaced the dumb frame-skipping approach
 */

export interface SchedulerConfig {
  objectIntervalMs: number;
  faceIntervalMs: number;
}

type TaskKind = 'object' | 'face';

interface TaskState {
  targetIntervalMs: number;
  lastRunMs: number;
  busy: boolean;
  generation: number;
  avgDurationMs: number;
  durationSamples: number[];
}

export class InferenceScheduler {
  private tasks: Record<TaskKind, TaskState> = {
    object: { targetIntervalMs: 150, lastRunMs: 0, busy: false, generation: 0, avgDurationMs: 0, durationSamples: [] },
    face: { targetIntervalMs: 300, lastRunMs: 0, busy: false, generation: 0, avgDurationMs: 0, durationSamples: [] },
  };
  private paused = false;
  private rafId = 0;
  private onObjectDetect: ((gen: number) => Promise<void>) | null = null;
  private onFaceDetect: ((gen: number) => Promise<void>) | null = null;
  private enabledModes = { objects: true, faces: false };

  constructor(config: SchedulerConfig) {
    this.tasks.object.targetIntervalMs = config.objectIntervalMs;
    this.tasks.face.targetIntervalMs = config.faceIntervalMs;
  }

  setCallbacks(onObject: (gen: number) => Promise<void>, onFace: (gen: number) => Promise<void>): void {
    this.onObjectDetect = onObject;
    this.onFaceDetect = onFace;
  }

  setEnabledModes(objects: boolean, faces: boolean): void {
    this.enabledModes = { objects, faces };
  }

  setIntervals(objectIntervalMs: number, faceIntervalMs: number): void {
    this.tasks.object.targetIntervalMs = objectIntervalMs;
    this.tasks.face.targetIntervalMs = faceIntervalMs;
  }

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
  getGeneration(kind: TaskKind): number { return this.tasks[kind].generation; }

  start(): void {
    this.paused = false;
    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      if (this.paused) return;
      if (this.enabledModes.objects && this.onObjectDetect) this.maybeRun('object', now);
      if (this.enabledModes.faces && this.onFaceDetect && !this.tasks.object.busy) this.maybeRun('face', now);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private maybeRun(kind: TaskKind, nowMs: number): void {
    const task = this.tasks[kind];
    if (task.busy) return;
    if (nowMs - task.lastRunMs < task.targetIntervalMs) return;
    task.busy = true;
    task.lastRunMs = nowMs;
    task.generation++;
    const gen = task.generation;
    const start = performance.now();
    const run = kind === 'object' ? this.onObjectDetect! : this.onFaceDetect!;
    run(gen).then(() => {
      this.recordDuration(kind, performance.now() - start);
      task.busy = false;
    }).catch(() => { task.busy = false; });
  }

  private recordDuration(kind: TaskKind, ms: number): void {
    const task = this.tasks[kind];
    task.durationSamples.push(ms);
    if (task.durationSamples.length > 10) task.durationSamples.shift();
    task.avgDurationMs = task.durationSamples.reduce((a, b) => a + b, 0) / task.durationSamples.length;
    const newTarget = Math.max(50, Math.min(1000, task.avgDurationMs * 1.5));
    task.targetIntervalMs = Math.round(task.targetIntervalMs * 0.8 + newTarget * 0.2);
  }
}
