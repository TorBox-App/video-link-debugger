import { describe, expect, test } from "bun:test";
import { cellOf, renderCdnMap, MAP_W, MAP_H } from "./map";

describe("cellOf", () => {
  test("projects Chicago into the upper-left quadrant", () => {
    const { col, row } = cellOf(41.8781, -87.6298);
    expect(col).toBe(17);
    expect(row).toBe(6);
    expect(col).toBeLessThan(MAP_W / 2);
    expect(row).toBeLessThan(MAP_H / 2);
  });

  test("projects Sydney into the lower-right quadrant", () => {
    const { col, row } = cellOf(-33.8688, 151.2093);
    expect(col).toBeGreaterThan(MAP_W / 2);
    expect(row).toBeGreaterThan(MAP_H / 2);
  });

  test("clamps out-of-range coordinates onto the map", () => {
    const { col, row } = cellOf(-89, -200);
    expect(col).toBe(0);
    expect(row).toBe(MAP_H - 1);
  });
});

describe("renderCdnMap", () => {
  test("returns null when no CDN has coordinates", () => {
    expect(renderCdnMap([{ region: "weur", name: "nexus-001" }])).toBeNull();
  });

  test("renders markers and a legend", () => {
    const out = renderCdnMap([
      {
        region: "cnam",
        name: "nexus-090",
        closest: true,
        coordinates: { lat: 41.8781, lng: -87.6298 },
      },
      {
        region: "apac",
        name: "nexus-201",
        coordinates: { lat: -33.8688, lng: 151.2093 },
      },
    ]);
    expect(out).not.toBeNull();
    expect(out).toContain("CDN Locations");
    expect(out).toContain("1  cnam — nexus-090 *");
    expect(out).toContain("2  apac — nexus-201");
  });

  test("merges CDNs sharing a map cell into one marker", () => {
    const out = renderCdnMap([
      { region: "cnam", name: "nexus-090", coordinates: { lat: 41.88, lng: -87.63 } },
      { region: "cnam", name: "nexus-091", coordinates: { lat: 41.87, lng: -87.62 } },
    ]);
    expect(out).toContain("1  cnam — nexus-090, cnam — nexus-091");
  });
});
