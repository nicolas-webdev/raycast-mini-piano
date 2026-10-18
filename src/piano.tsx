import { Action, ActionPanel, Cache, Grid, Icon, Keyboard, environment, getPreferenceValues } from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Engine } from "./engine";
import {
  DEFAULT_KEY_REPEAT,
  isAutoRepeat,
  KeyRepeatSettings,
  LastKey,
  readKeyRepeatSettings,
  releaseDelay,
} from "./hold";
import {
  HOLD_MARK,
  HOLD_MARK_MS,
  isBlackKey,
  keyLabelFor,
  MAX_OCTAVE,
  midiFor,
  midiForChar,
  MIN_OCTAVE,
  noteName,
  OCTAVE_DOWN_KEY,
  OCTAVE_UP_KEY,
  parseMelody,
} from "./keymap";
import { NoteLength, prewarm, Sound, Tone } from "./synth";
import { tilePath } from "./tiles";

interface PianoPreferences {
  tone: Tone;
  noteLength: NoteLength;
}

/** Semitone offsets of the white keys within an octave; the black key, if any, is the next semitone up. */
const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11];

/** Hold length of a note played from the grid or replayed as a plain tap. */
const TAP_HOLD_MS = 250;
const REPLAY_STEP_MS = 230;
const MAX_HOLD_MARKS = 16;
const OCTAVE_CACHE_KEY = "typing-octave";

const cache = new Cache();

function initialOctave(): number {
  const stored = Number(cache.get(OCTAVE_CACHE_KEY));
  return Number.isInteger(stored) && stored >= MIN_OCTAVE && stored <= MAX_OCTAVE ? stored : 4;
}

function displayName(midi: number): string {
  return noteName(midi).replace("#", "♯");
}

function melodyNoteNames(melody: string, octave: number): string {
  return parseMelody(melody, octave)
    .filter((note): note is { midi: number; holdMs: number } => note.midi !== null)
    .map((note) => displayName(note.midi) + HOLD_MARK.repeat(Math.round(note.holdMs / HOLD_MARK_MS)))
    .join(" ");
}

interface PressedKey {
  char: string;
  midi: number;
  /** Index of the first character of this press in the melody text. */
  index: number;
  pressedAt: number;
  last: LastKey;
}

export default function Command() {
  const { tone, noteLength } = getPreferenceValues<PianoPreferences>();
  const sound = useMemo<Sound>(() => ({ tone, length: noteLength }), [tone, noteLength]);
  const engine = useMemo(() => new Engine(), []);
  const [octave, setOctaveState] = useState(initialOctave);
  const [melody, setMelodyState] = useState("");
  const [pressed, setPressed] = useState<Set<number>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const octaveRef = useRef(octave);
  const melodyRef = useRef(melody);
  const keyRepeat = useRef<KeyRepeatSettings>(DEFAULT_KEY_REPEAT);
  const releaseTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const lastPress = useRef<PressedKey | undefined>(undefined);
  const lastShift = useRef<LastKey | undefined>(undefined);
  const replayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setOctave = useCallback((next: number) => {
    const clamped = Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, next));
    octaveRef.current = clamped;
    cache.set(OCTAVE_CACHE_KEY, String(clamped));
    setOctaveState(clamped);
  }, []);

  const setMelody = useCallback((next: string) => {
    melodyRef.current = next;
    setMelodyState(next);
  }, []);

  const noteOff = useCallback(
    (midi: number) => {
      const timer = releaseTimers.current.get(midi);
      if (timer) clearTimeout(timer);
      releaseTimers.current.delete(midi);
      engine.noteOff(midi);
      setPressed((current) => {
        if (!current.has(midi)) return current;
        const next = new Set(current);
        next.delete(midi);
        return next;
      });
    },
    [engine],
  );

  const scheduleRelease = useCallback(
    (midi: number, delay: number, onRelease?: () => void) => {
      const existing = releaseTimers.current.get(midi);
      if (existing) clearTimeout(existing);
      releaseTimers.current.set(
        midi,
        setTimeout(() => {
          noteOff(midi);
          onRelease?.();
        }, delay),
      );
    },
    [noteOff],
  );

  const noteOn = useCallback(
    (midi: number) => {
      engine.noteOn(midi, sound);
      setPressed((current) => new Set(current).add(midi));
      setSelectedId(String(isBlackKey(midi) ? midi - 1 : midi));
    },
    [engine, sound],
  );

  /** A note with a fixed hold: grid actions and replay. */
  const tap = useCallback(
    (midi: number, holdMs = TAP_HOLD_MS) => {
      noteOn(midi);
      scheduleRelease(midi, holdMs);
    },
    [noteOn, scheduleRelease],
  );

  /** Once a held key is let go, fold its auto-repeat characters into hold marks so the melody stays readable. */
  const collapseRun = useCallback(
    (press: PressedKey) => {
      const run = press.char.repeat(1 + press.last.repeats);
      const text = melodyRef.current;
      if (press.last.repeats === 0 || text.slice(press.index, press.index + run.length) !== run) return;
      const heldMs = press.last.at - press.pressedAt;
      const marks = Math.min(MAX_HOLD_MARKS, Math.max(1, Math.round(heldMs / HOLD_MARK_MS)));
      setMelody(
        text.slice(0, press.index) + press.char + HOLD_MARK.repeat(marks) + text.slice(press.index + run.length),
      );
    },
    [setMelody],
  );

  const stopReplay = useCallback(() => {
    if (replayTimer.current) clearTimeout(replayTimer.current);
    replayTimer.current = undefined;
  }, []);

  const replay = useCallback(() => {
    stopReplay();
    const notes = parseMelody(melodyRef.current, octaveRef.current);
    let index = 0;
    const step = () => {
      if (index >= notes.length) return;
      const note = notes[index++];
      const holdMs = TAP_HOLD_MS + note.holdMs;
      if (note.midi !== null) tap(note.midi, holdMs);
      replayTimer.current = setTimeout(step, Math.max(REPLAY_STEP_MS, holdMs + 80));
    };
    step();
  }, [tap, stopReplay]);

  useEffect(() => {
    void readKeyRepeatSettings().then((settings) => {
      keyRepeat.current = settings;
    });
    void engine.start().then(() => {
      if (engine.mode !== "live") {
        const midis: number[] = [];
        for (let semitone = 0; semitone < 24; semitone++) midis.push(midiFor(octaveRef.current, semitone));
        void prewarm(midis, sound);
      }
    });
    const timers = releaseTimers.current;
    return () => {
      stopReplay();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      engine.stop();
    };
    // Runs once: the engine lives as long as the command does.
  }, []);

  const onSearchTextChange = useCallback(
    (text: string) => {
      const previous = melodyRef.current;
      const now = Date.now();
      let i = 0;
      while (i < previous.length && i < text.length && previous[i] === text[i]) i++;
      const appended = text.length > previous.length && i === previous.length ? text.slice(i) : "";
      // Raycast may hand us the field after we rewrote it, so the diff can be messy; the newest character is
      // then the one at the end and it is what the user just typed.
      const inserted = text.length === previous.length + 1 ? text[i] : "";
      const chars = appended || inserted || (text.length > previous.length ? text.slice(-1) : "");
      const sameChar = chars.length > 0 && [...chars].every((char) => char === chars[0]);
      if (sameChar) {
        const char = chars[0];
        let count = chars.length;
        const index = appended || inserted ? i : text.length - count;
        const press = lastPress.current;
        if (press && isAutoRepeat(press.last, char, now, keyRepeat.current)) {
          press.last.repeats += count;
          press.last.at = now;
          scheduleRelease(press.midi, releaseDelay(press.last, keyRepeat.current), () => collapseRun(press));
          count = 0;
        }
        if (count > 0) {
          if (char === OCTAVE_DOWN_KEY || char === OCTAVE_UP_KEY) {
            // A held z/x repeats too; shift once per press, not once per repeat.
            const shift = lastShift.current;
            if (!isAutoRepeat(shift, char, now, keyRepeat.current)) {
              setOctave(octaveRef.current + (char === OCTAVE_UP_KEY ? 1 : -1));
              lastShift.current = { char, at: now, repeats: 0 };
            } else {
              shift!.repeats += count;
              shift!.at = now;
            }
          } else {
            const midi = midiForChar(char, octaveRef.current);
            if (midi !== undefined) {
              const next: PressedKey = {
                char,
                midi,
                index,
                pressedAt: now,
                last: { char, at: now, repeats: count - 1 },
              };
              lastPress.current = next;
              noteOn(midi);
              scheduleRelease(midi, releaseDelay(next.last, keyRepeat.current), () => collapseRun(next));
            }
          }
        }
      }
      // The field always keeps what Raycast has so the controlled value never drifts from the native one.
      setMelody(text);
    },
    [collapseRun, noteOn, scheduleRelease, setMelody, setOctave],
  );

  const playFromGrid = useCallback(
    (midi: number) => {
      tap(midi);
      const label = keyLabelFor(midi, octaveRef.current);
      if (label) setMelody(melodyRef.current + label);
    },
    [tap, setMelody],
  );

  const octaves = [octave, octave + 1];

  return (
    <Grid
      navigationTitle="Mini Piano"
      columns={7}
      aspectRatio="3/4"
      inset={Grid.Inset.Zero}
      fit={Grid.Fit.Fill}
      filtering={false}
      searchText={melody}
      onSearchTextChange={onSearchTextChange}
      searchBarPlaceholder="Type to play, hold to sustain · a s d f g h j k · w e t y u · z/x octave · English input"
      selectedItemId={selectedId}
      onSelectionChange={(id) => setSelectedId(id ?? undefined)}
      searchBarAccessory={
        <Grid.Dropdown tooltip="Typing octave" value={String(octave)} onChange={(value) => setOctave(Number(value))}>
          {Array.from({ length: MAX_OCTAVE - MIN_OCTAVE + 1 }, (_, i) => MIN_OCTAVE + i).map((value) => (
            <Grid.Dropdown.Item key={value} value={String(value)} title={`Octave ${value}`} />
          ))}
        </Grid.Dropdown>
      }
    >
      {octaves.map((sectionOctave) => (
        <Grid.Section
          key={sectionOctave}
          title={`Octave ${sectionOctave}`}
          subtitle={
            sectionOctave === octave ? "a s d f g h j k  ·  w e t y u" : "k l ; '  ·  o p  ·  shift for the rest"
          }
        >
          {WHITE_KEYS.map((semitone) => {
            const midi = midiFor(sectionOctave, semitone);
            const blackMidi = isBlackKey(midi + 1) ? midi + 1 : undefined;
            const name = displayName(midi);
            const blackName = blackMidi !== undefined ? displayName(blackMidi) : undefined;
            const tile = tilePath({
              white: { name, keyLabel: keyLabelFor(midi, octave), pressed: pressed.has(midi) },
              black:
                blackMidi !== undefined && blackName
                  ? { name: blackName, keyLabel: keyLabelFor(blackMidi, octave), pressed: pressed.has(blackMidi) }
                  : undefined,
              appearance: environment.appearance,
            });
            return (
              <Grid.Item
                key={midi}
                id={String(midi)}
                content={{ source: tile }}
                actions={
                  <ActionPanel>
                    <ActionPanel.Section>
                      <Action title={`Play ${name}`} icon={Icon.Play} onAction={() => playFromGrid(midi)} />
                      {blackMidi !== undefined && (
                        <Action
                          title={`Play ${blackName}`}
                          icon={Icon.Play}
                          shortcut={{ modifiers: ["cmd"], key: "return" }}
                          onAction={() => playFromGrid(blackMidi)}
                        />
                      )}
                      <Action
                        title="Replay Melody"
                        icon={Icon.Repeat}
                        shortcut={Keyboard.Shortcut.Common.Refresh}
                        onAction={replay}
                      />
                      <Action.CopyToClipboard
                        title="Copy Note Names"
                        content={melodyNoteNames(melody, octave)}
                        shortcut={Keyboard.Shortcut.Common.Copy}
                      />
                      <Action
                        title="Clear Melody"
                        icon={Icon.Trash}
                        style={Action.Style.Destructive}
                        shortcut={Keyboard.Shortcut.Common.Remove}
                        onAction={() => {
                          stopReplay();
                          engine.allOff();
                          setMelody("");
                        }}
                      />
                    </ActionPanel.Section>
                    <ActionPanel.Section title="Octave">
                      <Action
                        title="Raise Octave"
                        icon={Icon.ArrowUp}
                        shortcut={{ modifiers: ["cmd"], key: "]" }}
                        onAction={() => setOctave(octaveRef.current + 1)}
                      />
                      <Action
                        title="Lower Octave"
                        icon={Icon.ArrowDown}
                        shortcut={{ modifiers: ["cmd"], key: "[" }}
                        onAction={() => setOctave(octaveRef.current - 1)}
                      />
                    </ActionPanel.Section>
                  </ActionPanel>
                }
              />
            );
          })}
        </Grid.Section>
      ))}
    </Grid>
  );
}
