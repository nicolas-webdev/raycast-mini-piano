import { Action, ActionPanel, Cache, Grid, Icon, Keyboard, environment, getPreferenceValues } from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { playNote, prewarm, Tone } from "./synth";
import { tilePath } from "./tiles";

interface PianoPreferences {
  tone: Tone;
  tileStyle: "drawn" | "plain";
}

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
  const { tone, tileStyle } = getPreferenceValues<PianoPreferences>();
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
      void playNote(midi, tone);
      const token = Math.random();
      setPressed((current) => ({ ...current, [midi]: token }));
      setSelectedId(String(midi));
      setTimeout(() => {
        setPressed((current) => {
          if (current[midi] !== token) return current;
          const rest = { ...current };
          delete rest[midi];
          return rest;
        });
      }, PRESS_MS);
    },
    [tone],
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
    void prewarm(midis, tone);
  }, [octave, tone]);

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
      columns={6}
      aspectRatio="4/3"
      inset={Grid.Inset.Small}
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
          {Array.from({ length: 12 }, (_, semitone) => midiFor(sectionOctave, semitone)).map((midi) => {
            const name = displayName(midi);
            const keyLabel = keyLabelFor(midi, octave);
            const black = isBlackKey(midi);
            const isPressed = pressed[midi] !== undefined;
            const content =
              tileStyle === "plain"
                ? { color: isPressed ? "#FFB547" : black ? "#1F1F24" : "#F7F3EB" }
                : {
                    source: tilePath({ name, keyLabel, black, pressed: isPressed, appearance: environment.appearance }),
                  };
            return (
              <Grid.Item
                key={midi}
                id={String(midi)}
                content={content}
                title={tileStyle === "plain" ? name : undefined}
                subtitle={tileStyle === "plain" ? keyLabel : undefined}
                actions={
                  <ActionPanel>
                    <ActionPanel.Section>
                      <Action title={`Play ${name}`} icon={Icon.Play} onAction={() => playFromGrid(midi)} />
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
