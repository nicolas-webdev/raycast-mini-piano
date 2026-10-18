import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { environment } from "@raycast/api";

const TILES_DIR = join(environment.supportPath, "tiles");
const written = new Set<string>();

export interface TileSpec {
  /** Display name such as "C♯4". */
  name: string;
  /** Keyboard hint shown in the badge, if the key is reachable from the typing octave. */
  keyLabel?: string;
  black: boolean;
  pressed: boolean;
  appearance: "light" | "dark";
}

interface Palette {
  face: string;
  edge: string;
  text: string;
  octave: string;
  badge: string;
  badgeText: string;
}

function paletteFor(spec: TileSpec): Palette {
  if (spec.pressed) {
    return {
      face: "#FFB547",
      edge: "#E8961E",
      text: "#2B1B03",
      octave: "#7A5311",
      badge: "#F39A1C",
      badgeText: "#2B1B03",
    };
  }
  if (spec.black) {
    return {
      face: "#1F1F24",
      edge: "#3A3A42",
      text: "#F3EFE8",
      octave: "#9B968E",
      badge: "#36363E",
      badgeText: "#EDE8DF",
    };
  }
  const dark = spec.appearance === "dark";
  return {
    face: dark ? "#ECE6DA" : "#F7F3EB",
    edge: dark ? "#CFC7B8" : "#DED6C7",
    text: "#1F1C18",
    octave: "#8D867A",
    badge: dark ? "#D9D1C2" : "#E6DFD1",
    badgeText: "#4A453E",
  };
}

const FONT = "-apple-system, 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tileSvg(spec: TileSpec): string {
  const p = paletteFor(spec);
  const match = spec.name.match(/^([A-G]♯?)(-?\d+)$/);
  const letter = match ? match[1] : spec.name;
  const octave = match ? match[2] : "";
  const badge = spec.keyLabel
    ? `<rect x="176" y="18" width="46" height="36" rx="11" fill="${p.badge}"/>` +
      `<text x="199" y="43" text-anchor="middle" font-family="${FONT}" font-size="21" font-weight="700" fill="${p.badgeText}">${escapeXml(spec.keyLabel)}</text>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180" viewBox="0 0 240 180">` +
    `<rect x="0" y="0" width="240" height="180" rx="24" fill="${p.edge}"/>` +
    `<rect x="0" y="0" width="240" height="172" rx="24" fill="${p.face}"/>` +
    badge +
    `<text x="22" y="146" font-family="${FONT}" font-weight="600" fill="${p.text}">` +
    `<tspan font-size="46">${escapeXml(letter)}</tspan>` +
    `<tspan font-size="24" dx="3" fill="${p.octave}">${escapeXml(octave)}</tspan>` +
    `</text>` +
    `</svg>`
  );
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
