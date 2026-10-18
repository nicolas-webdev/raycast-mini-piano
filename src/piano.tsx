import { Action, ActionPanel, Cache, Grid, Icon, Keyboard, environment, getPreferenceValues } from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isBlackKey,
  keyLabelFor,
  MAX_OCTAVE,
  melodyToMidis,
  midiFor,
  midiForChar,
  MIN_OCTAVE,
  noteName,
  OCTAVE_DOWN_KEY,
  OCTAVE_UP_KEY,
} from "./keymap";
import { NoteLength, playNote, prewarm, Sound, Tone } from "./synth";
import { tilePath } from "./tiles";

interface PianoPreferences {
  tone: Tone;
  noteLength: NoteLength;
}

/** Semitone offsets of the white keys within an octave; the black key, if any, is the next semitone up. */
const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11];

const PRESS_MS = 320;
const REPLAY_STEP_MS = 230;
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
  return melodyToMidis(melody, octave)
    .filter((midi): midi is number => midi !== null)
    .map(displayName)
    .join(" ");
}

export default function Command() {
  const { tone, noteLength } = getPreferenceValues<PianoPreferences>();
  const sound = useMemo<Sound>(() => ({ tone, length: noteLength }), [tone, noteLength]);
  const [octave, setOctaveState] = useState(initialOctave);
  const [melody, setMelodyState] = useState("");
  const [pressed, setPressed] = useState<Record<number, number>>({});
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const octaveRef = useRef(octave);
  const melodyRef = useRef(melody);
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

  const play = useCallback(
    (midi: number) => {
      void playNote(midi, sound);
      const token = Math.random();
      setPressed((current) => ({ ...current, [midi]: token }));
      setSelectedId(String(isBlackKey(midi) ? midi - 1 : midi));
      setTimeout(() => {
        setPressed((current) => {
          if (current[midi] !== token) return current;
          const rest = { ...current };
          delete rest[midi];
          return rest;
        });
      }, PRESS_MS);
    },
    [sound],
  );

  const stopReplay = useCallback(() => {
    if (replayTimer.current) clearTimeout(replayTimer.current);
    replayTimer.current = undefined;
  }, []);

  const replay = useCallback(() => {
    stopReplay();
    const midis = melodyToMidis(melodyRef.current, octaveRef.current);
    let index = 0;
    const step = () => {
      if (index >= midis.length) return;
      const midi = midis[index++];
      if (midi !== null) play(midi);
      replayTimer.current = setTimeout(step, REPLAY_STEP_MS);
    };
    step();
  }, [play, stopReplay]);

  useEffect(() => stopReplay, [stopReplay]);

  useEffect(() => {
    const midis: number[] = [];
    for (let semitone = 0; semitone < 24; semitone++) midis.push(midiFor(octave, semitone));
    void prewarm(midis, sound);
  }, [octave, sound]);

  const onSearchTextChange = useCallback(
    (text: string) => {
      const previous = melodyRef.current;
      if (text.length === previous.length + 1) {
        let i = 0;
        while (i < previous.length && previous[i] === text[i]) i++;
        const char = text[i];
        if (char === OCTAVE_DOWN_KEY || char === OCTAVE_UP_KEY) {
          setOctave(octaveRef.current + (char === OCTAVE_UP_KEY ? 1 : -1));
        } else {
          const midi = midiForChar(char, octaveRef.current);
          if (midi !== undefined) play(midi);
        }
      }
      // The field always keeps what Raycast has (octave shifts included) so the controlled value never drifts.
      setMelody(text);
    },
    [play, setMelody, setOctave],
  );

  const playFromGrid = useCallback(
    (midi: number) => {
      play(midi);
      const label = keyLabelFor(midi, octaveRef.current);
      if (label) setMelody(melodyRef.current + label);
    },
    [play, setMelody],
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
      searchBarPlaceholder="Type to play · a s d f g h j k · w e t y u · z/x octave · English input"
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
              white: { name, keyLabel: keyLabelFor(midi, octave), pressed: pressed[midi] !== undefined },
              black:
                blackMidi !== undefined && blackName
                  ? {
                      name: blackName,
                      keyLabel: keyLabelFor(blackMidi, octave),
                      pressed: pressed[blackMidi] !== undefined,
                    }
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
