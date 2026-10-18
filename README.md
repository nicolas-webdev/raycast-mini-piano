# Mini Piano for Raycast

A tiny piano that opens instantly from Raycast. Type on your keyboard to hear notes; no browser tab, no sample download, no ads.

## Install (local extension)

```sh
pnpm install
pnpm dev
```

`pnpm dev` runs `ray develop`, which registers the extension with the Raycast app on this Mac. It stays installed after you stop the dev server; it shows up under **Mini Piano** in Raycast's root search. Give it a hotkey or alias in Raycast Settings → Extensions.

Two one-time things:

- Switch to **English input** before playing: with a Japanese IME active, letters go into romaji composition and don't reach the search field one keystroke at a time.
- Turn off the accent popup for Raycast so holding `a`, `e`, `u` or `o` repeats instead of offering `à á â`: `defaults write com.raycast.macos ApplePressAndHoldEnabled -bool false`, then relaunch Raycast. Revert with `defaults delete com.raycast.macos ApplePressAndHoldEnabled`.

The first launch builds a small real-time synth with the Swift compiler from the Xcode Command Line Tools (about 10 seconds, with a toast). Without the tools the piano still works through `afplay`, just without sustain.

## Playing

The search field is the keyboard. Each character you type plays immediately and stays in the field as your melody. **Hold a key to sustain** the note; let go and it fades like a damper. A held note is written into the melody as the key followed by hold marks (`a–––`), so replay holds it for as long as you did.

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
| Arrow keys + `Enter`    | Play the selected white key; ⌘↩ plays the black key on that tile |
| ⌘R                      | Replay the melody in the search field                                                                                               |
| ⌘⇧C                     | Copy the melody as note names (`C4 E4 G4`)                                                                                          |
| ⌃X                      | Clear the melody                                                                                                                    |

The grid is laid out like the instrument: one row of seven white keys per octave, each black key sitting on the upper right of its white key, for the typing octave and the one above it. Tiles carry the note name and the key that plays it, and flash amber while the note sounds.

## Preferences

- **Tone**: Electric Piano (default), Pure Sine, or Organ.
- **Note Length**: Short (default), Medium, or Long. Short keeps fast runs from piling up.

## How the sound works

Raycast extensions have no audio API, so the sound comes from `assets/helper.swift`, a ~300-line AVAudioEngine synth compiled on first launch into the extension's support directory and driven over stdin (`on <midi> <tone> <length>`, `off <midi>`). Each voice is a handful of additive partials with per-partial decay, slight inharmonicity and a detuned second "string"; while a key is held the note decays slowly, on release it decays like a plucked note. Sustain detection reads macOS key repeat (`defaults read -g InitialKeyRepeat` / `KeyRepeat`): the first repeat of a key lands one initial delay after the press, so a run of the same character at repeat spacing is a hold and the note is released when the repeats stop. Offline check of the same code path: `helper --render out.wav < commands.txt` with `wait <ms>` lines.

If the helper can't be built or crashes, notes fall back to WAVs rendered by `src/synth.ts` and played with `afplay` (no sustain).

## Development

```sh
pnpm lint      # ray lint: manifest, ESLint, Prettier
pnpm build     # ray build -e dist -o dist (also type-checks)
node scripts/make-icon.mjs   # regenerate assets/extension-icon.png
```

Bump `HELPER_VERSION` in `src/engine.ts` when `assets/helper.swift` changes so the binary is rebuilt, and `SYNTH_VERSION` in `src/synth.ts` when the fallback WAV synthesis changes.
