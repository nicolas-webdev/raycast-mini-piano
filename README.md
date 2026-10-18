# Mini Piano for Raycast

A tiny piano that opens instantly from Raycast. Type on your keyboard to hear notes; no browser tab, no sample download, no ads.

## Install (local extension)

```sh
pnpm install
pnpm dev
```

`pnpm dev` runs `ray develop`, which registers the extension with the Raycast app on this Mac. It stays installed after you stop the dev server; it shows up under **Mini Piano** in Raycast's root search. Give it a hotkey or alias in Raycast Settings → Extensions.

Switch to **English input** before playing: with a Japanese IME active, letters go into romaji composition and don't reach the search field one keystroke at a time.

## Playing

The search field is the keyboard. Each character you type plays immediately and stays in the field as your melody.

```
 w e   t y u   o p
a s d f g h j k l ; '
C D E F G A B C D E F
```

| Keys                    | What they do                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `a s d f g h j k l ; '` | White keys, from C of the typing octave up to F of the next                                                                         |
| `w e t y u o p`         | Black keys in between                                                                                                               |
| `Shift` + letter        | Same note one octave higher                                                                                                         |
| `z` / `x`               | Typing octave down / up (also the dropdown at the top right, or ⌘[ / ⌘]). They stay in the melody as markers so replay follows them |
| `Space`                 | A short rest in the melody                                                                                                          |
| Arrow keys + `Enter`    | Play the selected key tile                                                                                                          |
| ⌘R                      | Replay the melody in the search field                                                                                               |
| ⌘⇧C                     | Copy the melody as note names (`C4 E4 G4`)                                                                                          |
| ⌃X                      | Clear the melody                                                                                                                    |

The grid shows the typing octave and the one above it. Each tile is labelled with its note and the key that plays it; the tile flashes amber while the note sounds.

## Preferences

- **Tone**: Electric Piano (default), Pure Sine, or Organ.
- **Key Tiles**: Drawn keys (default) or plain color tiles with labels underneath.

## How the sound works

There are no audio assets. Each note is synthesised once as a short 44.1 kHz WAV (additive partials with a per-partial decay, slight inharmonicity and a detuned second "string") into Raycast's support directory for the extension and played with macOS's built-in `afplay`. Rendering a note takes 15–35 ms and happens ahead of time for the visible octaves; afterwards a keypress only spawns `afplay`.

## Development

```sh
pnpm lint      # ray lint: manifest, ESLint, Prettier
pnpm build     # ray build -e dist -o dist (also type-checks)
node scripts/make-icon.mjs   # regenerate assets/extension-icon.png
```

Bump `SYNTH_VERSION` in `src/synth.ts` whenever the synthesis changes so cached WAVs are regenerated.
