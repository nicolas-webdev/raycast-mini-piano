export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export const MIN_OCTAVE = 1;
export const MAX_OCTAVE = 6;

/** Semitone offset from the root C of the typing octave, GarageBand/Ableton style. */
export const KEY_TO_SEMITONE: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ";": 16,
  "'": 17,
};

const SEMITONE_TO_KEY: string[] = [];
for (const [key, semitone] of Object.entries(KEY_TO_SEMITONE)) {
  if (SEMITONE_TO_KEY[semitone] === undefined) SEMITONE_TO_KEY[semitone] = key;
}

export function midiFor(octave: number, semitone: number): number {
  return (octave + 1) * 12 + semitone;
}

export function noteName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function isBlackKey(midi: number): boolean {
  return NOTE_NAMES[midi % 12].includes("#");
}

/** Keyboard letter that plays `midi` with the given typing octave; uppercase means "one octave up". */
export function keyLabelFor(midi: number, typingOctave: number): string | undefined {
  const offset = midi - midiFor(typingOctave, 0);
  const lower = SEMITONE_TO_KEY[offset];
  if (lower) return lower;
  const upper = SEMITONE_TO_KEY[offset - 12];
  if (upper && /[a-z]/.test(upper)) return upper.toUpperCase();
  return undefined;
}

/** Resolve a typed character to a midi note. Shifted letters play an octave higher. */
export function midiForChar(char: string, typingOctave: number): number | undefined {
  const lower = char.toLowerCase();
  const semitone = KEY_TO_SEMITONE[lower];
  if (semitone === undefined) return undefined;
  const shift = char !== lower && /[a-z]/.test(lower) ? 12 : 0;
  return midiFor(typingOctave, semitone + shift);
}
