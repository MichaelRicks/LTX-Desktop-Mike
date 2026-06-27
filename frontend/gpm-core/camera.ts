/**
 * gpm-core / camera technique library
 *
 * PURE module. Cinematography reference cards ported from `ltx-gpm.jsx`. Each
 * card contributes a phrase that can be appended to a working prompt.
 */

export type CameraCategory =
  | "Angles"
  | "Sizes"
  | "Framing"
  | "Movement"
  | "Lighting"
  | "Film Stocks"
  | "Movie Looks";

export interface CameraCard {
  id: string;
  cat: CameraCategory;
  label: string;
  phrase: string;
}

/** Category filter values for the UI, including the "All" pseudo-category. */
export const CAM_CATS: Array<"All" | CameraCategory> = [
  "All",
  "Angles",
  "Sizes",
  "Framing",
  "Movement",
  "Lighting",
  "Film Stocks",
  "Movie Looks",
];

export const CAM_CARDS: CameraCard[] = [
  { id: "high", cat: "Angles", label: "High Angle", phrase: "high camera angle looking down at the subject" },
  { id: "eye", cat: "Angles", label: "Eye Level", phrase: "neutral eye-level camera angle" },
  { id: "low", cat: "Angles", label: "Low Angle", phrase: "low camera angle looking up, imposing perspective" },
  { id: "dutch", cat: "Angles", label: "Dutch Angle", phrase: "dutch tilt, camera rolled at a diagonal" },
  { id: "worm", cat: "Angles", label: "Worm's Eye", phrase: "extreme low worm's-eye view looking straight up" },
  { id: "bird", cat: "Angles", label: "Bird's Eye", phrase: "overhead bird's-eye view looking straight down" },
  { id: "xwide", cat: "Sizes", label: "Extreme Wide", phrase: "extreme wide establishing shot, subject small in frame" },
  { id: "wide", cat: "Sizes", label: "Wide Shot", phrase: "wide shot showing the subject full-length in context" },
  { id: "medium", cat: "Sizes", label: "Medium Shot", phrase: "medium shot framed from the waist up" },
  { id: "cu", cat: "Sizes", label: "Close-Up", phrase: "close-up on the face and shoulders" },
  { id: "xcu", cat: "Sizes", label: "Extreme CU", phrase: "extreme close-up filling the frame with the eyes" },
  { id: "rule", cat: "Framing", label: "Rule of Thirds", phrase: "composed on the rule of thirds, subject off-center" },
  { id: "center", cat: "Framing", label: "Center Frame", phrase: "symmetrical centered composition" },
  { id: "ots", cat: "Framing", label: "Over Shoulder", phrase: "over-the-shoulder framing with foreground figure soft" },
  { id: "lead", cat: "Framing", label: "Leading Lines", phrase: "strong leading lines drawing the eye to the subject" },
  { id: "dolly", cat: "Movement", label: "Dolly In", phrase: "slow dolly push-in toward the subject" },
  { id: "orbit", cat: "Movement", label: "Orbit", phrase: "smooth orbiting camera circling the subject" },
  { id: "track", cat: "Movement", label: "Tracking", phrase: "cinematic tracking shot gliding alongside the subject" },
  { id: "crane", cat: "Movement", label: "Crane", phrase: "rising crane move revealing the scene" },
  { id: "rembrandt", cat: "Lighting", label: "Rembrandt", phrase: "Rembrandt lighting, triangle of light on the shadow cheek" },
  { id: "rim", cat: "Lighting", label: "Rim Light", phrase: "strong rim light separating subject from background" },
  { id: "lowkey", cat: "Lighting", label: "Low Key", phrase: "low-key dramatic lighting, deep shadows" },
  { id: "golden", cat: "Lighting", label: "Golden Hour", phrase: "warm golden-hour light, long soft shadows" },
  { id: "portra", cat: "Film Stocks", label: "Kodak Portra", phrase: "Kodak Portra film aesthetic, soft natural skin tones" },
  { id: "cinestill", cat: "Film Stocks", label: "CineStill 800T", phrase: "CineStill 800T look, tungsten night palette, halation glow" },
  { id: "trix", cat: "Film Stocks", label: "Tri-X B&W", phrase: "Kodak Tri-X black-and-white, gritty grain" },
  { id: "teal", cat: "Movie Looks", label: "Teal & Orange", phrase: "cinematic teal-and-orange grade, warm skin cool shadows" },
  { id: "bleach", cat: "Movie Looks", label: "Bleach Bypass", phrase: "bleach-bypass look, desaturated, crushed contrast" },
  { id: "noir", cat: "Movie Looks", label: "Film Noir", phrase: "high-contrast black-and-white noir, hard chiaroscuro" },
];

/** Filter helper mirroring the prototype's category + free-text search. */
export function filterCameraCards(cat: "All" | CameraCategory, search: string): CameraCard[] {
  const q = search.trim().toLowerCase();
  return CAM_CARDS.filter(
    (c) =>
      (cat === "All" || c.cat === cat) &&
      (!q || c.label.toLowerCase().includes(q) || c.phrase.toLowerCase().includes(q)),
  );
}
