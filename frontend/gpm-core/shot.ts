/**
 * gpm-core / shot (virtual-camera) composer
 *
 * PURE module. Ported from the inlined shot engine in `ltx-gpm.jsx`
 * (buildShotPrompt + helpers). A Shot transform is described as rotation,
 * tilt, zoom plus a set of consistency anchors, and assembled into a single
 * re-generation instruction that preserves everything else in the frame.
 */

export interface ShotPreset {
  name: string;
  /** Decorative glyph used by the UI; carried here so presets stay self-describing. */
  icon: string;
  rot: number;
  tilt: number;
  zoom: number;
  phrase: string;
}

export interface ShotAnchor {
  id: string;
  label: string;
  text: string;
}

export interface ShotState {
  rot: number;
  tilt: number;
  zoom: number;
  /** When a preset is active its phrase leads the prompt; null once a slider is moved. */
  preset: ShotPreset | null;
  /** Map of anchor id → enabled. */
  anchors: Record<string, boolean>;
}

export const SHOT_PRESETS: ShotPreset[] = [
  { name: "Front", icon: "👁", rot: 0, tilt: 0, zoom: 8, phrase: "create a straight-on front view of the subject at eye level" },
  { name: "Hero ¾", icon: "🦸", rot: 35, tilt: -8, zoom: 9, phrase: "create a three-quarter hero angle shot of the subject, viewed slightly from below" },
  { name: "Profile", icon: "◐", rot: 90, tilt: 0, zoom: 9, phrase: "create a side profile shot of the subject" },
  { name: "Worm's Eye", icon: "🐛", rot: 0, tilt: -40, zoom: 7, phrase: "create a low worm's-eye angle shot looking up at the subject" },
  { name: "Bird's Eye", icon: "🦅", rot: 0, tilt: 42, zoom: 5, phrase: "create a high bird's-eye angle shot looking down at the subject" },
  { name: "Dutch Tilt", icon: "📐", rot: 15, tilt: 0, zoom: 9, phrase: "create a dutch tilt shot of the subject, camera rolled at a diagonal angle" },
  { name: "Extreme CU", icon: "🔬", rot: 0, tilt: 0, zoom: 19, phrase: "create an extreme close-up of the subject's face" },
  { name: "Medium Wide", icon: "🖼", rot: 0, tilt: 0, zoom: 4, phrase: "create a medium-wide shot of the subject, showing them head to toe" },
];

export const SHOT_ANCHORS: ShotAnchor[] = [
  { id: "positions", label: "Positions", text: "every person stays in their exact same position, seat, and pose" },
  { id: "faces", label: "Faces & marks", text: "all facial features, expressions, tattoos, scars, and skin marks remain identical" },
  { id: "wardrobe", label: "Wardrobe", text: "all clothing, armor, gloves, and accessories stay exactly the same" },
  { id: "props", label: "Props", text: "all props and objects keep their exact same positions, shapes, and details" },
  { id: "background", label: "Background", text: "the background, set, furniture, and environment stay completely fixed" },
  { id: "lighting", label: "Lighting", text: "the lighting direction, color, shadows, and highlights remain consistent" },
];

export function shotZoomWord(z: number): string {
  if (z <= 3) return "wide shot";
  if (z <= 5) return "medium-wide shot";
  if (z <= 8) return "medium shot";
  if (z <= 11) return "medium close-up";
  if (z <= 14) return "close-up";
  if (z <= 17) return "tight close-up";
  return "extreme close-up";
}

export function shotSentence(s: Pick<ShotState, "rot" | "tilt" | "zoom">): string {
  const bits: string[] = [];
  const zw = shotZoomWord(s.zoom);
  bits.push((/^[aeiou]/i.test(zw) ? "an " : "a ") + zw, "of the subject");
  if (s.rot !== 0) {
    const ab = Math.abs(s.rot);
    const dir = s.rot > 0 ? "right" : "left";
    if (ab >= 75) bits.push(`from the ${dir} side in profile`);
    else if (ab >= 30) bits.push(`from about ${ab} degrees to the ${dir}`);
    else bits.push(`turned slightly to the ${dir}`);
  }
  if (s.tilt !== 0) {
    const ab = Math.abs(s.tilt);
    if (s.tilt > 0) bits.push(ab >= 30 ? "looking down from a high angle" : "from slightly above");
    else bits.push(ab >= 30 ? "looking up from a low angle" : "from slightly below");
  }
  return bits.join(" ");
}

export function buildShotPrompt(s: ShotState): string {
  let lead = s.preset ? s.preset.phrase : `create ${shotSentence(s)}`;
  lead = lead.charAt(0).toUpperCase() + lead.slice(1);
  if (!/[.!?]$/.test(lead)) lead += ".";
  let p = lead + " Everything else in the scene stays exactly the same.";
  const locked = SHOT_ANCHORS.filter((a) => s.anchors[a.id]).map((a) => a.text);
  if (locked.length) p += ` Keep these identical: ${locked.join("; ")}.`;
  return p;
}
