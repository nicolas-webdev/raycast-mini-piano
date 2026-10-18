import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { environment } from "@raycast/api";

const TILES_DIR = join(environment.supportPath, "tiles");
const written = new Set<string>();

export interface KeyFace {
  /** Display name such as "C♯4". */
  name: string;
  /** Keyboard hint shown in the badge, if the key is reachable from the typing octave. */
  keyLabel?: string;
  pressed: boolean;
}

/** One tile is a white key plus, where the piano has one, the black key to its upper right. */
export interface TileSpec {
  white: KeyFace;
  black?: KeyFace;
  appearance: "light" | "dark";
}

const AMBER = {
  face: "#FFB547",
  edge: "#E8961E",
  text: "#2B1B03",
  muted: "#7A5311",
  badge: "#F39A1C",
  badgeText: "#2B1B03",
};
const FONT = "-apple-system, 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function splitName(name: string): { letter: string; octave: string } {
  const match = name.match(/^([A-G]♯?)(-?\d+)$/);
  return match ? { letter: match[1], octave: match[2] } : { letter: name, octave: "" };
}

function badge(x: number, y: number, label: string, fill: string, text: string): string {
  return (
    `<rect x="${x}" y="${y}" width="46" height="36" rx="11" fill="${fill}"/>` +
    `<text x="${x + 23}" y="${y + 25}" text-anchor="middle" font-family="${FONT}" font-size="21" font-weight="700" fill="${text}">${escapeXml(label)}</text>`
  );
}

function tileSvg(spec: TileSpec): string {
  const dark = spec.appearance === "dark";
  const white = spec.white.pressed
    ? AMBER
    : {
        face: dark ? "#ECE6DA" : "#F7F3EB",
        edge: dark ? "#CFC7B8" : "#DED6C7",
        text: "#1F1C18",
        muted: "#8D867A",
        badge: dark ? "#D9D1C2" : "#E6DFD1",
        badgeText: "#4A453E",
      };
  const { letter, octave } = splitName(spec.white.name);

  let svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 240 320">` +
    `<rect x="0" y="0" width="240" height="320" rx="26" fill="${white.edge}"/>` +
    `<rect x="0" y="0" width="240" height="310" rx="26" fill="${white.face}"/>`;
  if (spec.white.keyLabel) svg += badge(18, 18, spec.white.keyLabel, white.badge, white.badgeText);
  svg +=
    `<text x="22" y="284" font-family="${FONT}" font-weight="600" fill="${white.text}">` +
    `<tspan font-size="46">${escapeXml(letter)}</tspan>` +
    `<tspan font-size="24" dx="3" fill="${white.muted}">${escapeXml(octave)}</tspan>` +
    `</text>`;

  if (spec.black) {
    const black = spec.black.pressed
      ? AMBER
      : { face: "#1F1F24", edge: "#0E0E11", text: "#F3EFE8", muted: "#9B968E", badge: "#36363E", badgeText: "#EDE8DF" };
    // Square top-left corner, tile-radius top-right corner, rounded bottom: reads as a black key set into the white one.
    const keyPath = (height: number) =>
      `M150,0 H214 a26,26 0 0 1 26,26 V${height - 18} a18,18 0 0 1 -18,18 H168 a18,18 0 0 1 -18,-18 Z`;
    svg += `<path d="${keyPath(186)}" fill="${black.edge}"/>` + `<path d="${keyPath(178)}" fill="${black.face}"/>`;
    if (spec.black.keyLabel) svg += badge(172, 18, spec.black.keyLabel, black.badge, black.badgeText);
    svg += `<text x="195" y="150" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="600" fill="${black.text}">${escapeXml(splitName(spec.black.name).letter)}</text>`;
  }

  return svg + `</svg>`;
}

/** Returns the absolute path of an SVG tile for the spec, writing it on first use. Paths are content-hashed so Raycast's image cache never goes stale. */
export function tilePath(spec: TileSpec): string {
  const svg = tileSvg(spec);
  const hash = createHash("md5").update(svg).digest("hex").slice(0, 16);
  const path = join(TILES_DIR, `${hash}.svg`);
  if (!written.has(path)) {
    if (!existsSync(path)) {
      mkdirSync(TILES_DIR, { recursive: true });
      writeFileSync(path, svg);
    }
    written.add(path);
  }
  return path;
}
