/**
 * Color palettes for the instrument and the desk around it. The colors themselves live in
 * styles.css (`:root[data-palette=…]`); this list names them and gives the swatch colors.
 */

export const PALETTES = [
  { id: "classic", label: "Classic", body: "#000052", accent: "#ffdf3f" },
  { id: "bubblegum", label: "Bubblegum", body: "#9d174d", accent: "#99f6e4" },
  { id: "mint", label: "Mint", body: "#0b5d55", accent: "#ffd166" },
  { id: "sunset", label: "Sunset", body: "#a8330a", accent: "#ffe08a" },
  { id: "retro", label: "Retro beige", body: "#d8cdb2", accent: "#c62828" },
  { id: "night", label: "Night", body: "#24275a", accent: "#8be9fd" },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

export const isPalette = (v: unknown): v is PaletteId => PALETTES.some((p) => p.id === v);

/** Puts the palette on the page (and the phone's address bar color). */
export function applyPalette(id: PaletteId) {
  const root = document.documentElement;
  if (id === "classic") delete root.dataset.palette;
  else root.dataset.palette = id;
  const p = PALETTES.find((x) => x.id === id)!;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", p.body);
}
