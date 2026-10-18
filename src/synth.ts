import { spawn } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { environment } from "@raycast/api";

export type Tone = "piano" | "sine" | "organ";
export type NoteLength = "short" | "medium" | "long";

export interface Sound {
  tone: Tone;
  length: NoteLength;
}

const SAMPLE_RATE = 44100;
// Bump when the synthesis changes so stale cached WAVs are regenerated.
const SYNTH_VERSION = 2;

const LENGTH_FACTOR: Record<NoteLength, number> = { short: 0.5, medium: 0.85, long: 1.4 };

const NOTES_DIR = join(environment.supportPath, "notes");

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface Partial {
  ratio: number;
  amplitude: number;
  decayScale: number;
}

interface Voice {
  partials: Partial[];
  duration: number;
  /** Returns the envelope at time t for a partial with the given decay scale. */
  envelope: (t: number, decayScale: number) => number;
  detuneCents: number;
}

function voiceFor({ tone, length }: Sound, frequency: number): Voice {
  const factor = LENGTH_FACTOR[length];
  // Lower strings ring longer, like on a real piano.
  const ringTime = clamp(1.3 * factor * Math.pow(261.63 / frequency, 0.35), 0.2, 2.0);
  const attack = (t: number) => 1 - Math.exp(-t / 0.0025);

  switch (tone) {
    case "sine":
      return {
        partials: [{ ratio: 1, amplitude: 1, decayScale: 1 }],
        duration: clamp(ringTime * 1.1, 0.4, 2.2),
        envelope: (t, decayScale) => attack(t) * Math.exp(-t / (ringTime * decayScale)),
        detuneCents: 0,
      };
    case "organ": {
      const drawbars: [number, number][] = [
        [1, 1],
        [2, 0.7],
        [3, 0.5],
        [4, 0.4],
        [6, 0.25],
        [8, 0.15],
      ];
      const hold = 0.5 * factor;
      return {
        partials: drawbars.map(([ratio, amplitude]) => ({ ratio, amplitude, decayScale: 1 })),
        duration: hold + 0.2,
        envelope: (t) => (t < hold ? attack(t) : Math.exp(-(t - hold) / 0.08)),
        detuneCents: 1.2,
      };
    }
    case "piano":
    default: {
      const partials: Partial[] = [];
      const inharmonicity = 0.0003;
      for (let n = 1; n <= 8; n++) {
        partials.push({
          ratio: n * Math.sqrt(1 + inharmonicity * n * n),
          amplitude: Math.pow(n, -1.35) * (n % 2 === 0 ? 0.85 : 1),
          decayScale: 1 / (1 + 0.45 * (n - 1)),
        });
      }
      return {
        partials,
        duration: clamp(ringTime * 1.15, 0.4, 2.4),
        envelope: (t, decayScale) => attack(t) * Math.exp(-t / (ringTime * decayScale)),
        detuneCents: 0.5,
      };
    }
  }
}

/** Render a single note to a 16-bit mono PCM WAV buffer. */
export function renderNote(midi: number, sound: Sound): Buffer {
  const frequency = midiToFrequency(midi);
  const voice = voiceFor(sound, frequency);
  const sampleCount = Math.floor(voice.duration * SAMPLE_RATE);
  const samples = new Float64Array(sampleCount);
  const nyquist = SAMPLE_RATE / 2;
  const detune = Math.pow(2, voice.detuneCents / 1200);
  const fadeOut = 0.12;

  for (const partial of voice.partials) {
    const base = frequency * partial.ratio;
    if (base >= nyquist * 0.9) continue;
    const omegaA = 2 * Math.PI * base * detune;
    const omegaB = 2 * Math.PI * (base / detune);
    const phase = (partial.ratio * 1.37) % (2 * Math.PI);
    for (let i = 0; i < sampleCount; i++) {
      const t = i / SAMPLE_RATE;
      const env = voice.envelope(t, partial.decayScale);
      samples[i] += partial.amplitude * env * (Math.sin(omegaA * t + phase) + Math.sin(omegaB * t)) * 0.5;
    }
  }

  let peak = 0;
  for (let i = 0; i < sampleCount; i++) {
    const remaining = voice.duration - i / SAMPLE_RATE;
    if (remaining < fadeOut) samples[i] *= remaining / fadeOut;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const gain = peak > 0 ? 0.8 / peak : 1;

  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < sampleCount; i++) {
    buffer.writeInt16LE(Math.round(clamp(samples[i] * gain, -1, 1) * 32767), 44 + i * 2);
  }
  return buffer;
}

const ready = new Map<string, Promise<string>>();

function notePath(midi: number, sound: Sound): string {
  return join(NOTES_DIR, `v${SYNTH_VERSION}-${sound.tone}-${sound.length}-${midi}.wav`);
}

/** Make sure the WAV for a note exists on disk, rendering it on first use. */
export function ensureNote(midi: number, sound: Sound): Promise<string> {
  const path = notePath(midi, sound);
  let pending = ready.get(path);
  if (!pending) {
    pending = (async () => {
      if (!existsSync(path)) {
        mkdirSync(NOTES_DIR, { recursive: true });
        await writeFile(path, renderNote(midi, sound));
      }
      return path;
    })();
    pending.catch(() => ready.delete(path));
    ready.set(path, pending);
  }
  return pending;
}

/** Render a set of notes ahead of time, yielding to the event loop between notes so the UI stays responsive. */
export async function prewarm(midis: number[], sound: Sound): Promise<void> {
  for (const midi of midis) {
    await ensureNote(midi, sound);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export async function playNote(midi: number, sound: Sound): Promise<void> {
  const path = await ensureNote(midi, sound);
  const child = spawn("/usr/bin/afplay", [path], { stdio: "ignore" });
  child.on("error", () => {
    /* afplay missing or audio unavailable; nothing useful to do per keystroke */
  });
  child.unref();
}
