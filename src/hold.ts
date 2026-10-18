import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** macOS key-repeat timing. The `defaults` values are in units of 15 ms; the system defaults are 25 and 6. */
export interface KeyRepeatSettings {
  initialMs: number;
  repeatMs: number;
}

export const DEFAULT_KEY_REPEAT: KeyRepeatSettings = { initialMs: 375, repeatMs: 90 };

async function readDefault(key: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/defaults", ["read", "-g", key]);
    const value = parseFloat(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function readKeyRepeatSettings(): Promise<KeyRepeatSettings> {
  const [initial, repeat] = await Promise.all([readDefault("InitialKeyRepeat"), readDefault("KeyRepeat")]);
  return {
    initialMs: initial !== undefined ? initial * 15 : DEFAULT_KEY_REPEAT.initialMs,
    repeatMs: Math.max(15, repeat !== undefined ? repeat * 15 : DEFAULT_KEY_REPEAT.repeatMs),
  };
}

/** The last key event, used to tell auto-repeat from a fresh press of the same key. */
export interface LastKey {
  char: string;
  /** When the most recent character of this press arrived. */
  at: number;
  /** How many auto-repeat characters have followed the first one. */
  repeats: number;
}

/** Tolerance on the first repeat, which lands one initial delay after the press give or take bridge jitter. */
export function firstRepeatTolerance(settings: KeyRepeatSettings): number {
  return Math.max(80, settings.initialMs * 0.35);
}

export function isAutoRepeat(
  last: LastKey | undefined,
  char: string,
  now: number,
  settings: KeyRepeatSettings,
): boolean {
  if (!last || last.char !== char) return false;
  const gap = now - last.at;
  if (last.repeats === 0) return Math.abs(gap - settings.initialMs) <= firstRepeatTolerance(settings);
  return gap <= settings.repeatMs * 2.5 + 40;
}

/** How long to wait after the latest character before deciding the key was let go. */
export function releaseDelay(last: LastKey, settings: KeyRepeatSettings): number {
  if (last.repeats === 0) return settings.initialMs + firstRepeatTolerance(settings) + settings.repeatMs;
  return settings.repeatMs * 2.5 + 60;
}
