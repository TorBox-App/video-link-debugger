import { ok, dim } from "./progress";
import { padVisible } from "./tables";

// World landmass bitmap, rasterized from Natural Earth 110m land polygons
// (public domain) at braille-dot resolution: 140x88 dots = 70x22 chars,
// equirectangular projection, latitude clipped to [-60, 85] (no Antarctica).
// Regenerate with a rasterizer script if the dimensions ever change.
const DOTS_W = 140;
const DOTS_H = 88;
const LAT_TOP = 85;
const LAT_BOT = -60;
const BITMAP =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAPwD/wMAAAAAAAAAAAAAAAAA+u///wAAAAIADAAAAAAAAADADv//B8ADAACAAwAAAAAAAATy+P8/AFAAAABAAAAAAAAAoE0A/P8DAAAADsA/gAEAAABgAAAA/z8AAAAYAP8BAAAAAAD+rQfg/wEAAMAg/v8PAwABAgAf+gP8HwAAAQj7////AQD47+d78sD/AAB+ALb/////98H//7c/Hf4BAPC//vv///////7////h4w8OgH/8////////hP///z8fPMAAvP////////8H/P//P4DAAQDw/f/////////A9///AQcYAADf////////1wG48P8fcAEAAPDh//////8vAwAG/P8DPwAAEIj//////x8YAACA///wAwAAofz/////f4ABAAD4/7//AAAo0v//////BxgAAAD///sPAMDz////////gwAAAPD//38AAPD///////8/AAAAAPz//woAAPz///////8DAAAAwP//nwEA8P///////w8AAAAA/P//AwAA/v+e/////wAAAADA//8fAADg9+H8////JwAAAAD8/z8AAMBHHsz///8fAwAAAMD//wMAAHjIzfn///8AAAAAAPz/HwAAwCP0n////w4BAAAAwP//AQAAOEj/+f//jxAAAAAA+P8fAAAAPGD/////iQEAAACA//8AAAD4A/D///+PDgAAAADw/wcAAIB/AP////8xAAAAAAD8PwAAAPzP+P///x8AAAAAAOB/AgAAwP//3////wEAAAAAAPhAAAAA/v///f//HwAAAAAAwA8MAADg/38/////AQAAAAAA9AAAAAD///8L//8PAAAAAAAADgAAAPD///7h/38AAAAAAQDggAAAgP//7x/+/AMAAAAgAACOEAAA8P///MDHBwAAAAAAAMAPAgAA///fD3x4IAAAAAAAAPgAAADw//95gIMPAgAAAAAAADwAAID//78DGPAAAAAAAAAAgAMAAPj//wuAAR8AAAAAAAAAEAAAAP//fwAY0CAAAAAAAAAA4gMA8P//PwABCQAAAAAAAABAfwAA/v//AyAQQAAAAAAAAADwBwDA//8fAAKCBAAAAAAAAAD/AwAs//8BACgIAAAAAAAAAPA/AADA/w8AAMMAAAAAAAAAgP8DAAD8/wAAcA4AAAAAAAAA+D8AAMD/BwAA8gAAAAAAAACA/w8AAPw/AABgNgIAAAAAAAD4/wcAwP8DAABk0wEAAAAAAMD//wAA+B8AAEAQeAAAAAAAAPj/DwCA/wEAAAgARwAAAAAAgP//AAD4HwAAAAawAAAAAAAA8P8PAID/AQAAAAUIAQAAAAAA//8AAPg/AAAAACIAAAAAAADw/wcAgP8DAAAAYAIAAAAAAAD/fwAA+D8CAACAJwAAAAAAAOD/BwCA/xkAAAD8BgAAAAAAAPx/AAD4jwEAAMB/AAAAAAAAgP8HAID/GAAAAP4HAAAAAAAA+D8AAPiPAQAA+P9AAAAAAACA/wMAAP8YAADA/x8AAAAAAAD4DwAA8I8AAAD8/wEAAAAAAMB/AAAAfwAAAMD/PwAAAAAAAPwHAADwBwAAAPz/AwAAAAAAwH8AAAA+AAAAgP8/AAAAAAAA/AMAAOADAAAA+P8DAAAAAADAPwAAAB4AAACAxx8AAAAAAAB8AQAAIAAAAAAI+AEAAAAAAMAPAAAAAAAAAAAADwAAAAAAAP4AAAAAAAAAAADgAAQAAAAA4AMAAAAAAAAAAAAAQAAAAAAAPgAAAAAAAAAAAMAABAAAAADAAQAAAAAAAAAAAAgQAAAAAAAcAAAAAAAAAAAAAIABAAAAAOAAAAAAAAAAAAAAAAgAAAAAAA4AAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

const bits = Buffer.from(BITMAP, "base64");

function dotAt(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= DOTS_W || y >= DOTS_H) return false;
  const idx = y * DOTS_W + x;
  return (bits[idx >> 3]! & (1 << (idx & 7))) !== 0;
}

export const MAP_W = DOTS_W / 2;
export const MAP_H = DOTS_H / 4;

// braille dot bit values for (dy, dx) within a 2x4 cell
const BRAILLE = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

export function cellOf(lat: number, lng: number): { col: number; row: number } {
  const x = ((lng + 180) / 360) * DOTS_W;
  const y = ((LAT_TOP - lat) / (LAT_TOP - LAT_BOT)) * DOTS_H;
  return {
    col: Math.min(MAP_W - 1, Math.max(0, Math.floor(x / 2))),
    row: Math.min(MAP_H - 1, Math.max(0, Math.floor(y / 4))),
  };
}

const SYMBOLS = "123456789abcdefghijklmnopqrstuvwxyz";

export type CdnPoint = {
  region: string;
  name: string;
  closest?: boolean;
  coordinates?: { lat: number; lng: number };
};

export function renderCdnMap(cdns: CdnPoint[]): string | null {
  const located = cdns.filter((c) => c.coordinates);
  if (located.length === 0) return null;
  // A narrow terminal would wrap the map into noise; skip it there.
  if (process.stdout.columns && process.stdout.columns < MAP_W + 4) return null;

  // CDNs sharing a map cell (same city) share one marker.
  const groups = new Map<string, { col: number; row: number; cdns: CdnPoint[] }>();
  for (const c of located) {
    const { col, row } = cellOf(c.coordinates!.lat, c.coordinates!.lng);
    const key = `${col},${row}`;
    const group = groups.get(key) ?? { col, row, cdns: [] };
    group.cdns.push(c);
    groups.set(key, group);
  }

  const markers = new Map<string, string>();
  const legend: string[] = [];
  let i = 0;
  for (const { col, row, cdns: group } of groups.values()) {
    const symbol = SYMBOLS[i] ?? "+";
    i++;
    const hasClosest = group.some((c) => c.closest);
    const label = `${symbol}  ${group.map((c) => `${c.region} — ${c.name}`).join(", ")}${hasClosest ? " *" : ""}`;
    markers.set(`${col},${row}`, hasClosest ? ok(symbol) : symbol);
    legend.push(hasClosest ? ok(label) : label);
  }

  const lines: string[] = [];
  for (let row = 0; row < MAP_H; row++) {
    let line = "";
    let run = "";
    const flush = () => {
      if (run) {
        line += dim(run);
        run = "";
      }
    };
    for (let col = 0; col < MAP_W; col++) {
      const marker = markers.get(`${col},${row}`);
      if (marker) {
        flush();
        line += marker;
        continue;
      }
      let mask = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (dotAt(col * 2 + dx, row * 4 + dy)) mask += BRAILLE[dy]![dx]!;
        }
      }
      run += mask === 0 ? " " : String.fromCharCode(0x2800 + mask);
    }
    flush();
    lines.push(line);
  }

  const titleBar = " CDN Locations ";
  const top = `╭${titleBar}${"─".repeat(Math.max(0, MAP_W + 2 - titleBar.length))}╮`;
  const bot = `╰${"─".repeat(MAP_W + 2)}╯`;
  const boxed = [
    top,
    ...lines.map((l) => `│ ${l} │`),
    `├${"─".repeat(MAP_W + 2)}┤`,
    ...legend.map((l) => `│ ${padVisible(l, MAP_W)} │`),
    bot,
  ];
  return boxed.join("\n");
}
