import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  ChevronLeft, Settings, FileText, Heart, LayoutGrid, Sparkles, Image as ImageIcon,
  Music, Video, Clock, Monitor, Search, Copy, Send, Wand2, X, Maximize2, Minimize2,
  Folder, FolderPlus, Plus, Upload, Download, Save, RefreshCw, Check, Film, Camera,
  Layers, Workflow as WorkflowIcon, Drama, Lock, Eye, Volume2, Scissors, Type,
  MousePointer2, ArrowRightLeft, Play, AlertTriangle, ChevronRight, Target, RotateCcw
} from "lucide-react";

/* ============================================================================
 * GPM CORE (INLINED) — real prompt logic ported from GPM v13.2.4.
 * In the fork these come from the shared core package; artifacts can't import
 * local files, so the engines live here verbatim and genuinely compute.
 * ========================================================================== */

// ---- Performance engine (faithful subset of the 24 families) ----------------
const PERF_FAMILIES = [
  { family: "Sadness", subtext: "carrying weight that won't put down", waypoints: [
    { name: "Melancholy", va: { v: -0.4, a: -0.3 }, facs: ["AU1","AU4","AU15","AU41"], anat: "inner brows subtly raised and drawn together, lip corners barely turned down, upper eyelids slightly heavy", perf: "stillness, slow blink rate, breath quiet and even, gaze unfocused on middle distance" },
    { name: "Grief Contained", va: { v: -0.85, a: 0.6 }, facs: ["AU1","AU4","AU15","AU17"], anat: "inner brows knitted up and together with vertical furrow, mouth corners drawn down, chin pushed up beneath a tensed lower lip, eyes wet but not spilling", perf: "rigid stillness, breath held in the chest, jaw locked, single tear pooling without falling, micro-tremor in lower lip" },
    { name: "Grief Breaking", va: { v: -0.95, a: 0.9 }, facs: ["AU1","AU4","AU6","AU15","AU17","AU25"], anat: "inner brows pulled sharply up, eyes squeezed partly shut with tears overflowing, mouth corners pulled hard down, lower lip protruded and trembling", perf: "shoulders shaking, breath in catching gasps, head dropping forward" },
  ]},
  { family: "Fear", subtext: "watching for the thing that hasn't arrived yet", waypoints: [
    { name: "Anxiety", va: { v: -0.5, a: 0.6 }, facs: ["AU1","AU2","AU4","AU5","AU24"], anat: "inner brows raised and slightly drawn together, eyes alert with mild upper-lid lift, lips pressed thin", perf: "restless micro-movements, shallow upper-chest breathing, eyes scanning, jaw subtly tight" },
    { name: "Dread", va: { v: -0.75, a: 0.7 }, facs: ["AU1","AU2","AU4","AU5","AU20","AU24"], anat: "brows raised and pulled together, eyes wide and tense with upper lids elevated, lips slightly stretched, color drained", perf: "stillness with held breath, swallow visible, slow shake of head, body weight pulled back" },
    { name: "Terror", va: { v: -0.95, a: 1.0 }, facs: ["AU1","AU2","AU4","AU5","AU20","AU26"], anat: "brows pulled high and tight, eyes stretched wide showing white above the iris, mouth open and pulled sideways into a frozen grimace", perf: "head recoiled, body frozen mid-motion, breath stopped, hands raised defensively" },
  ]},
  { family: "Anger", subtext: "the line that cannot be crossed has been crossed", waypoints: [
    { name: "Sternness", va: { v: -0.3, a: 0.2 }, facs: ["AU4","AU7","AU24"], anat: "brows lowered and slightly drawn together, lids tightened into a level gaze, lips pressed firmly, jaw set", perf: "minimal movement, breathing slow and controlled, posture squared, gaze unwavering" },
    { name: "Cold Anger", va: { v: -0.7, a: 0.5 }, facs: ["AU4","AU5","AU7","AU23"], anat: "brows pulled down with a vertical crease, hard stare, lips pressed into a thin tense line, nostrils slightly flared", perf: "unnatural stillness, jaw muscles working, breath controlled with effort, slight forward lean" },
    { name: "Rage", va: { v: -0.9, a: 1.0 }, facs: ["AU4","AU5","AU7","AU10","AU23","AU25"], anat: "brows pulled violently down with deep furrows, eyes bulging, lips pulled back to bare clenched teeth, jaw thrust forward", perf: "breath heavy and audible, shoulders heaving, body coiled forward, hands clenched" },
  ]},
  { family: "Joy", subtext: "the good thing is actually happening", waypoints: [
    { name: "Contentment", va: { v: 0.6, a: -0.3 }, facs: ["AU6","AU12"], anat: "lip corners gently turned up with cheeks softly raised, eyes relaxed and warm, brow smooth", perf: "slow easy breath, soft blink rate, head settled, gaze present and unhurried" },
    { name: "Felt Joy", va: { v: 0.8, a: 0.5 }, facs: ["AU6","AU12","AU25"], anat: "mouth pulled up and outward while cheeks lift, outer eye corners crinkle, upper teeth just visible — a genuine felt smile", perf: "light forward energy, easier breath, eyes engaged with what produced the feeling" },
    { name: "Elation", va: { v: 0.95, a: 0.9 }, facs: ["AU6","AU12","AU25","AU26"], anat: "wide open smile with teeth visible, cheeks pushed high, eyes shining, head tilted back, jaw dropped in laughter", perf: "body loose and bouncing, breath catching with laughter, head thrown back" },
  ]},
  { family: "Surprise", subtext: "the world just rearranged itself", waypoints: [
    { name: "Mild Surprise", va: { v: 0, a: 0.5 }, facs: ["AU1","AU2","AU5"], anat: "brows lifted with horizontal forehead lines, upper lids slightly raised, mouth neutral or just parted", perf: "head pulls back a touch, blink, brief breath catch, quick re-orientation" },
    { name: "Shock", va: { v: -0.4, a: 0.95 }, facs: ["AU1","AU2","AU5","AU27"], anat: "brows shot up and arched, eyes stretched wide with white all around the iris, mouth dropped fully open in a slack oval", perf: "body frozen, breath caught, hand may rise toward mouth, total stillness for a beat" },
  ]},
  { family: "Disgust", subtext: "the body rejecting what it sees", waypoints: [
    { name: "Distaste", va: { v: -0.4, a: 0.2 }, facs: ["AU9","AU10","AU15"], anat: "subtle nose wrinkle, upper lip slightly raised on one side, mouth corners faintly down", perf: "small head turn away, slight backward lean, gaze averted briefly" },
    { name: "Revulsion", va: { v: -0.9, a: 0.8 }, facs: ["AU9","AU10","AU15","AU16","AU25"], anat: "deeply wrinkled nose, upper lip pulled hard up to bare teeth, lower lip pulled down and out, eyes squinted", perf: "full body recoil, gag reflex visible, hand clamped over mouth, head turned sharply away" },
  ]},
  { family: "Determination", subtext: "the decision is already made", waypoints: [
    { name: "Resolve", va: { v: 0.1, a: 0.5 }, facs: ["AU4","AU7","AU24"], anat: "brows lowered with a focused furrow, eyes locked forward, lips pressed firmly, jaw set, chin level", perf: "controlled breath in through nose, steady posture, gaze unwavering, small nod possible" },
    { name: "Fierce Will", va: { v: 0.2, a: 0.85 }, facs: ["AU4","AU5","AU7","AU24"], anat: "brows pulled down with focused intensity, eyes wide and locked, lips pressed hard, masseter visibly tensed", perf: "breath drawn in and held, body coiled and ready, slight forward lean, hands clenched" },
  ]},
  { family: "Tenderness", subtext: "looking at someone you would protect with your life", waypoints: [
    { name: "Soft Warmth", va: { v: 0.6, a: -0.2 }, facs: ["AU6","AU12","AU43"], anat: "gentle smile with cheeks softly raised, eyelids relaxed, gaze warm and steady, head tilted slightly", perf: "slow soft breathing, unhurried blink, the faintest forward lean, gaze resting with ease" },
    { name: "Deep Tenderness", va: { v: 0.7, a: 0.2 }, facs: ["AU1","AU6","AU12","AU43"], anat: "inner brows raised softly with a tender smile, eyes glistening slightly, cheeks raised, lips parted", perf: "breath caught with feeling, eyes welling faintly, hand may rise toward the other's face" },
  ]},
  { family: "Awe", subtext: "encountering something far larger than yourself", waypoints: [
    { name: "Wonder", va: { v: 0.5, a: 0.5 }, facs: ["AU1","AU2","AU5","AU25"], anat: "brows raised high and smooth, eyes wide and bright taking everything in, lips parted softly, head lifting", perf: "breath drawn in and held, slow head shake, gaze sweeping upward, body still and absorbed" },
    { name: "Overwhelmed Awe", va: { v: 0.4, a: 0.8 }, facs: ["AU1","AU2","AU5","AU26"], anat: "brows raised high, eyes stretched wide and welling, mouth fallen open, head tilted back", perf: "breath catching, hand rising slowly to chest or mouth, body frozen, a barely audible exhale" },
  ]},
  { family: "Sinister", subtext: "already knowing how this ends for you", waypoints: [
    { name: "Calculating Menace", va: { v: -0.3, a: -0.1 }, facs: ["AU7","AU12","AU43"], anat: "a slow controlled half-smile that does not reach the eyes, lids slightly lowered, unblinking gaze, head very still", perf: "near-total stillness, slow deliberate blink, breathing quiet and even, the calm of someone in control" },
    { name: "Cruel Relish", va: { v: -0.5, a: 0.3 }, facs: ["AU6","AU7","AU12","AU14"], anat: "a tightening smile with cheeks raised but eyes cold and narrowed, gaze locked and savoring, head tilted", perf: "a slow lean forward, savoring quality, a quiet exhale of pleasure, tracking the other's discomfort" },
    { name: "Overt Malice", va: { v: -0.8, a: 0.7 }, facs: ["AU4","AU5","AU7","AU9","AU12","AU23"], anat: "brows lowered over wide cold eyes, a predatory stare, a hard baring smile with teeth showing, jaw set", perf: "stillness coiled into forward intent, a deliberate step closer, the threat fully surfaced" },
  ]},
  { family: "Hope", subtext: "afraid to believe it but unable not to", waypoints: [
    { name: "Fragile Hope", va: { v: 0.2, a: 0.4 }, facs: ["AU1","AU2","AU5","AU12"], anat: "inner brows raised softly, eyes widening with a tentative light, a small uncertain smile beginning, head lifting slightly", perf: "breath held in anticipation, a forward lean, the smile flickering between belief and fear" },
    { name: "Rising Hope", va: { v: 0.5, a: 0.6 }, facs: ["AU1","AU2","AU5","AU6","AU12"], anat: "brows raised high, eyes wide and shining and welling, a growing genuine smile lifting the cheeks, head coming up", perf: "breath quickening, hand rising to chest, body straightening, caution giving way to joy" },
  ]},
  { family: "Exhaustion", subtext: "running on empty and past pretending otherwise", waypoints: [
    { name: "Weariness", va: { v: -0.3, a: -0.5 }, facs: ["AU41","AU43","AU15"], anat: "heavy upper eyelids drooping, faint downturn at the mouth, slack facial muscles, gaze unfocused", perf: "slow heavy blinks, delayed reactions, a long exhale, shoulders sagging" },
    { name: "Depletion", va: { v: -0.5, a: -0.7 }, facs: ["AU41","AU43","AU15","AU54"], anat: "eyes barely open and unfocused, whole face gone slack, mouth slightly open from fatigue, head low", perf: "eyes closing involuntarily, head dropping and jerking back up, body held up by effort alone" },
  ]},
];

const lerp = (a, b, t) => a + (b - a) * t;
function perfWaypointPair(fam, intensity) {
  const w = fam.waypoints;
  if (w.length === 2) return { a: w[0], b: w[1], t: intensity };
  if (intensity <= 0.5) return { a: w[0], b: w[1], t: intensity * 2 };
  return { a: w[1], b: w[2], t: (intensity - 0.5) * 2 };
}
function perfIntensityWord(i) {
  if (i < 0.15) return "trace"; if (i < 0.4) return "slight";
  if (i < 0.65) return "moderate"; if (i < 0.85) return "pronounced"; return "maximum";
}
function perfLabel(fam, i) {
  const w = fam.waypoints;
  if (w.length === 2) { if (i < 0.33) return w[0].name; if (i > 0.67) return w[1].name; return `${w[0].name} → ${w[1].name}`; }
  if (i < 0.2) return w[0].name; if (i < 0.4) return `${w[0].name} → ${w[1].name}`;
  if (i < 0.6) return w[1].name; if (i < 0.8) return `${w[1].name} → ${w[2].name}`; return w[2].name;
}
function perfAsymNote(a) {
  if (a < 0.3) return null;
  if (a < 0.55) return "with slight left-right asymmetry across the brow or mouth";
  if (a < 0.8) return "with visible facial asymmetry — one side more active than the other";
  return "with strong facial asymmetry, the expression noticeably stronger on one side";
}
function perfDeliveryNote(d) {
  if (d === "slow") return "speaking slowly, weighing each word, leaving silence between phrases";
  if (d === "halting") return "halting delivery, starting and stopping, searching for the words";
  return null;
}
function assemblePerformance({ familyIndex = 0, intensity = 0.5, asymmetry = 0.25, dialogue = "", delivery = "natural" }) {
  const fam = PERF_FAMILIES[familyIndex];
  const line = (dialogue || "").trim();
  const { a, b, t } = perfWaypointPair(fam, intensity);
  const v = lerp(a.va.v, b.va.v, t), ar = lerp(a.va.a, b.va.a, t);
  const wp = t < 0.5 ? a : b;
  const iw = perfIntensityWord(intensity);
  const asym = perfAsymNote(asymmetry);
  const anat = asym ? `${wp.anat}, ${asym}` : wp.anat;
  const label = `${fam.family} — ${perfLabel(fam, intensity)}`;
  const layers = [
    { k: "V/A", v: `valence ${v.toFixed(2)}, arousal ${ar.toFixed(2)}` },
    { k: "FACS", v: `${wp.facs.join(" + ")} at ${iw} intensity` },
    { k: "Anatomical", v: anat },
    { k: "Performance", v: wp.perf },
    { k: "Subtext", v: fam.subtext },
  ];
  if (line) {
    layers.push({ k: "Dialogue", v: `"${line}"` });
    const dn = perfDeliveryNote(delivery);
    if (dn) layers.push({ k: "Delivery", v: dn });
    layers.push({ k: "Lip sync", v: "Be sure to get dialogue and lip sync perfectly aligned." });
  } else {
    layers.push({ k: "No dialogue", v: "No dialogue. The character does not speak; lips remain still and at rest." });
  }
  return { label, layers, text: layers.map((l) => `${l.k}: ${l.v}`).join("\n") };
}

// ---- Shot engine (faithful subset) ------------------------------------------
const SHOT_PRESETS = [
  { name: "Front", icon: "👁", rot: 0, tilt: 0, zoom: 8, phrase: "create a straight-on front view of the subject at eye level" },
  { name: "Hero ¾", icon: "🦸", rot: 35, tilt: -8, zoom: 9, phrase: "create a three-quarter hero angle shot of the subject, viewed slightly from below" },
  { name: "Profile", icon: "◐", rot: 90, tilt: 0, zoom: 9, phrase: "create a side profile shot of the subject" },
  { name: "Worm's Eye", icon: "🐛", rot: 0, tilt: -40, zoom: 7, phrase: "create a low worm's-eye angle shot looking up at the subject" },
  { name: "Bird's Eye", icon: "🦅", rot: 0, tilt: 42, zoom: 5, phrase: "create a high bird's-eye angle shot looking down at the subject" },
  { name: "Dutch Tilt", icon: "📐", rot: 15, tilt: 0, zoom: 9, phrase: "create a dutch tilt shot of the subject, camera rolled at a diagonal angle" },
  { name: "Extreme CU", icon: "🔬", rot: 0, tilt: 0, zoom: 19, phrase: "create an extreme close-up of the subject's face" },
  { name: "Medium Wide", icon: "🖼", rot: 0, tilt: 0, zoom: 4, phrase: "create a medium-wide shot of the subject, showing them head to toe" },
];
const SHOT_ANCHORS = [
  { id: "positions", label: "Positions", text: "every person stays in their exact same position, seat, and pose" },
  { id: "faces", label: "Faces & marks", text: "all facial features, expressions, tattoos, scars, and skin marks remain identical" },
  { id: "wardrobe", label: "Wardrobe", text: "all clothing, armor, gloves, and accessories stay exactly the same" },
  { id: "props", label: "Props", text: "all props and objects keep their exact same positions, shapes, and details" },
  { id: "background", label: "Background", text: "the background, set, furniture, and environment stay completely fixed" },
  { id: "lighting", label: "Lighting", text: "the lighting direction, color, shadows, and highlights remain consistent" },
];
function shotZoomWord(z) {
  if (z <= 3) return "wide shot"; if (z <= 5) return "medium-wide shot"; if (z <= 8) return "medium shot";
  if (z <= 11) return "medium close-up"; if (z <= 14) return "close-up"; if (z <= 17) return "tight close-up"; return "extreme close-up";
}
function shotSentence(s) {
  const bits = [];
  const zw = shotZoomWord(s.zoom);
  bits.push((/^[aeiou]/i.test(zw) ? "an " : "a ") + zw, "of the subject");
  if (s.rot !== 0) {
    const ab = Math.abs(s.rot), dir = s.rot > 0 ? "right" : "left";
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
function buildShotPrompt(s) {
  let lead = s.preset ? s.preset.phrase : `create ${shotSentence(s)}`;
  lead = lead.charAt(0).toUpperCase() + lead.slice(1);
  if (!/[.!?]$/.test(lead)) lead += ".";
  let p = lead + " Everything else in the scene stays exactly the same.";
  const locked = SHOT_ANCHORS.filter((a) => s.anchors[a.id]).map((a) => a.text);
  if (locked.length) p += ` Keep these identical: ${locked.join("; ")}.`;
  return p;
}

// ---- Camera technique library (cinematography reference cards) ---------------
const CAM_CATS = ["All", "Angles", "Sizes", "Framing", "Movement", "Lighting", "Film Stocks", "Movie Looks"];
const CAM_CARDS = [
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

// ---- Prompt library (folders + cards) ---------------------------------------
const PROMPT_FOLDERS = [
  { name: "Cinematic Basics", cards: [
    { id: "cb1", title: "Slow Push-In", text: "A slow cinematic push-in on the subject, shallow depth of field, soft volumetric light." },
    { id: "cb2", title: "Establishing Wide", text: "A sweeping wide establishing shot of the location at golden hour, anamorphic flare." },
  ]},
  { name: "Action Scenes", cards: [
    { id: "as1", title: "Hero Reveal", text: "Low three-quarter hero angle, dust and embers in the air, backlit silhouette resolving into the figure." },
    { id: "as2", title: "Tracking Run", text: "Cinematic tracking shot gliding alongside the running subject, motion blur on the background." },
  ]},
  { name: "Video Modifiers", cards: [
    { id: "vm1", title: "Hold Still / Camera Only", text: "The subject holds their exact pose; only the camera moves, one slow continuous move." },
    { id: "vm2", title: "Lip-Sync Pass", text: "Be sure to get dialogue and lip sync perfectly aligned." },
  ]},
];

/* ============================================================================
 * Theme tokens (sampled from the LTX / GPM screenshots)
 * ========================================================================== */
const C = {
  app: "#0a0a0c", panel: "#0e0e12", card: "#16161b", elev: "#1c1c22", hover: "#23232a",
  border: "#26262d", borderLt: "#34343d",
  text: "#f3f3f6", muted: "#8c8c95", faint: "#5c5c65",
  blue: "#1f8fff", blueDeep: "#0a84ff", green: "#28c76f", red: "#ef4757", amber: "#f5a623",
};

// ---- Workflow engine (role-bound slots → @imageN prompt) --------------------
const WF_ROLES = [
  { value: "character", label: "👤 Character Ref" },
  { value: "location", label: "📍 Location Ref" },
  { value: "style", label: "🎨 Style Ref" },
  { value: "storyboard", label: "🎞 Storyboard Frame" },
  { value: "asset", label: "📦 Asset / Prop" },
  { value: "general", label: "🖼 General Ref" },
];
const wfRoleLabel = (v) => (WF_ROLES.find((r) => r.value === v)?.label || "🖼 General Ref");
function buildWorkflowPrompt(wf, perfText) {
  const filled = wf.slots.map((s, i) => ({ s, i })).filter((e) => e.s.filled);
  if (filled.length === 0 && !wf.directive.trim()) return "";
  const parts = [];
  if (filled.length) {
    const refs = filled.map(({ s, i }) => {
      const role = wfRoleLabel(s.role).replace(/^[^\s]+ /, "");
      const note = s.note ? ` (${s.note})` : "";
      return `@image${i + 1} = ${role}${note}`;
    }).join(", ");
    parts.push(`Using these reference images: ${refs}.`);
  }
  if (wf.directive.trim()) parts.push(wf.directive.trim());
  const extras = [];
  if (wf.aspectRatio && wf.aspectRatio !== "16:9") extras.push(`Aspect ratio: ${wf.aspectRatio}`);
  if (wf.motionHint.trim()) extras.push(wf.motionHint.trim());
  if (extras.length) parts.push(extras.join(". ") + ".");
  if (wf.performance.enabled && perfText) parts.push(perfText);
  return parts.join(" ");
}

/* ============================================================================
 * UI atoms
 * ========================================================================== */
function Slider({ value, min, max, step, onChange, left, mid, right }) {
  return (
    <div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 cursor-pointer" style={{ accentColor: C.blue, background: "transparent" }} />
      <div className="flex justify-between mt-1 text-[10px] tracking-wide" style={{ color: C.faint }}>
        <span>{left}</span><span>{mid}</span><span>{right}</span>
      </div>
    </div>
  );
}

function Btn({ children, onClick, color = C.elev, text = C.text, border, className = "", icon: Ic, title }) {
  return (
    <button onClick={onClick} title={title}
      className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${className}`}
      style={{ background: color, color: text, border: border ? `1px solid ${border}` : "1px solid transparent" }}
      onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.15)")}
      onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}>
      {Ic && <Ic size={13} />}{children}
    </button>
  );
}

function Label({ children, className = "" }) {
  return <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${className}`} style={{ color: C.muted }}>{children}</div>;
}
function Chip({ children }) {
  return <span className="px-1 rounded tabular-nums" style={{ background: C.elev, color: C.blue, fontSize: 9 }}>{children}</span>;
}
function SearchBar({ value, onChange, placeholder }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-3 py-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <Search size={14} style={{ color: C.faint }} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-xs" style={{ color: C.text }} />
    </div>
  );
}

/* Collapsible section — every panel is foldable to save vertical space.
 * open = explicit override (sectionsOpen[id]) else the global allOpen default. */
function Section({ id, title, sectionsOpen, setSectionsOpen, allOpen, right, children }) {
  const open = sectionsOpen[id] ?? allOpen;
  const toggle = () => setSectionsOpen((s) => ({ ...s, [id]: !(s[id] ?? allOpen) }));
  return (
    <div className="rounded-lg mb-2 overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
      <button onClick={toggle} className="w-full flex items-center justify-between px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ background: C.card }}>
        <span className="flex items-center gap-1.5">
          <ChevronRight size={13} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", color: C.muted }} />
          {title}
        </span>
        {right}
      </button>
      {open && <div className="p-3" style={{ borderTop: `1px solid ${C.border}` }}>{children}</div>}
    </div>
  );
}

/* ============================================================================
 * Main App
 * ========================================================================== */
export default function App() {
  const [topTab, setTopTab] = useState("gpm");
  const [gpmTab, setGpmTab] = useState("performance");
  const [enlarged, setEnlarged] = useState(false);
  const [search, setSearch] = useState("");
  const [working, setWorking] = useState("");
  const [toast, setToast] = useState(null);
  const [gen, setGen] = useState({ active: false, pct: 0 });

  // collapsible state (shared across dock tabs) + global toggle-all
  const [sectionsOpen, setSectionsOpen] = useState({});
  const [allOpen, setAllOpen] = useState(true);
  const toggleAll = () => { setAllOpen((a) => !a); setSectionsOpen({}); };

  const [perf, setPerf] = useState({ familyIndex: 0, intensity: 0.5, asymmetry: 0.25, dialogue: "I don't know how to do this without you.", delivery: "natural" });
  const perfOut = useMemo(() => assemblePerformance(perf), [perf]);

  const [shot, setShot] = useState({ rot: 35, tilt: -8, zoom: 9, preset: SHOT_PRESETS[1], anchors: { faces: true } });
  const shotOut = useMemo(() => buildShotPrompt(shot), [shot]);

  const [wf, setWf] = useState({
    name: "Untitled Workflow",
    slots: [
      { id: "s1", role: "character", note: "STORM", filled: true },
      { id: "s2", role: "location", note: "ruined town", filled: true },
      { id: "s3", role: "general", note: "", filled: false },
    ],
    directive: "STORM walks toward camera down the ruined main street, dust drifting.",
    aspectRatio: "16:9", motionHint: "slow push-in",
    performance: { enabled: false },
  });
  const wfOut = useMemo(() => buildWorkflowPrompt(wf, perfOut.text), [wf, perfOut]);

  const [camCat, setCamCat] = useState("All");

  // timeline + selection
  const [clips, setClips] = useState([
    { id: 1, label: 'Her Dialogue: "I don\'t know ho..."', dur: "5.0s", res: "1088p", color: "#1f6fd0" },
    { id: 2, label: 'Dialogue: "Hey. I\'ve got you."', dur: "4.4s", res: "704p", color: "#c0432e" },
  ]);
  const [selectedClipId, setSelectedClipId] = useState(1);
  const [tiles, setTiles] = useState(["#2a3340", "#3a2f2a", "#26323a", "#1d2730", "#332a30", "#222a26"]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1700); };
  const selectedClip = clips.find((c) => c.id === selectedClipId) || null;

  const copyText = (txt) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (_) {}
      document.body.removeChild(ta);
      if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
    } catch (_) {}
    flash("Copied to clipboard");
  };

  const runRegen = (id) => {
    const t0 = Date.now(), dur = 1200;
    const iv = setInterval(() => {
      const pct = Math.min(100, Math.round(((Date.now() - t0) / dur) * 100));
      setClips((c) => c.map((cl) => (cl.id === id ? { ...cl, regen: pct } : cl)));
      if (pct >= 100) {
        clearInterval(iv);
        setClips((c) => c.map((cl) => (cl.id === id ? { ...cl, regen: undefined, updated: true } : cl)));
      }
    }, 50);
  };

  // Apply the composed prompt to the SELECTED shot (re-gen in place, keeping its
  // reference image). With no shot selected, it falls back to a fresh generation.
  const applyToShot = (txt, label) => {
    if (selectedClipId == null) {
      const id = Date.now();
      setClips((c) => [...c, { id, label: label || "New shot", dur: "6.0s", res: "1080p", color: "#1f6fd0", prompt: txt }]);
      setSelectedClipId(id);
      runRegen(id);
      flash("New shot generated");
      return;
    }
    setClips((c) => c.map((cl) => (cl.id === selectedClipId ? { ...cl, prompt: txt } : cl)));
    runRegen(selectedClipId);
    flash(`Re-generating "${(selectedClip?.label || "shot").slice(0, 22)}…"`);
  };

  const generate = () => {
    if (gen.active) return;
    setGen({ active: true, pct: 0 });
    const t0 = Date.now(), dur = 1500;
    const iv = setInterval(() => {
      const pct = Math.min(100, Math.round(((Date.now() - t0) / dur) * 100));
      setGen({ active: true, pct });
      if (pct >= 100) {
        clearInterval(iv);
        const palette = ["#2a3340", "#3a2f2a", "#26323a", "#332a30"];
        setTiles((tl) => [palette[tl.length % palette.length], ...tl]);
        setGen({ active: false, pct: 0 });
        flash("Render complete · added to Gen Space");
      }
    }, 60);
  };

  const dockProps = {
    gpmTab, setGpmTab, setEnlarged, search, setSearch,
    perf, setPerf, perfOut, shot, setShot, shotOut, wf, setWf, wfOut,
    camCat, setCamCat, working, setWorking,
    copyText, applyToShot, selectedClip,
    sectionsOpen, setSectionsOpen, allOpen, toggleAll,
  };

  return (
    <div className="w-full font-sans select-none" style={{ background: C.app, color: C.text, height: 780, borderRadius: 10, overflow: "hidden", border: `1px solid ${C.border}` }}>
      {/* Title bar */}
      <div className="flex items-center justify-between px-3" style={{ height: 30, background: C.blueDeep }}>
        <div className="flex items-center gap-2 text-[11px] font-medium text-white">
          <div className="w-3.5 h-3.5 rounded-sm bg-white/90 flex items-center justify-center" style={{ color: C.blueDeep, fontSize: 7, fontWeight: 800 }}>L</div>
          LTX Desktop
        </div>
        <div className="flex items-center gap-3 text-white/80 text-xs"><span>—</span><span>▢</span><span>✕</span></div>
      </div>

      {/* App top bar */}
      <div className="flex items-center justify-between px-4" style={{ height: 56, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-3">
          <ChevronLeft size={18} style={{ color: C.muted }} />
          <span className="text-2xl font-bold tracking-tight" style={{ fontFamily: "Georgia, serif" }}>Ltx</span>
          <span className="text-sm" style={{ color: C.muted }}>Storm</span>
        </div>
        <div className="flex items-center gap-1 rounded-full p-1" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <TopTab id="gen" cur={topTab} set={setTopTab} icon={Sparkles}>Gen Space</TopTab>
          <TopTab id="editor" cur={topTab} set={setTopTab} icon={Film}>Video Editor</TopTab>
          <TopTab id="gpm" cur={topTab} set={setTopTab} icon={Wand2}>Prompt Manager Pro</TopTab>
        </div>
        <div className="flex items-center gap-3" style={{ color: C.muted }}><FileText size={17} /><Settings size={17} /></div>
      </div>

      {/* Body */}
      <div className="flex" style={{ height: 694 }}>
        <div className="flex-1 min-w-0 flex flex-col" style={{ background: C.app }}>
          {topTab === "gen"
            ? <GenView tiles={tiles} working={working} setWorking={setWorking} gen={gen} generate={generate} />
            : <EditorView clips={clips} tiles={tiles} selectedClipId={selectedClipId} onSelect={setSelectedClipId} compact={topTab === "gpm"} />}
        </div>

        {topTab === "gpm" && !enlarged && <GpmDock {...dockProps} />}
      </div>

      {/* Enlarged modal */}
      {topTab === "gpm" && enlarged && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50 }} className="flex items-center justify-center p-8">
          <div className="w-full max-w-3xl rounded-xl overflow-hidden flex flex-col" style={{ maxHeight: "86%", background: C.panel, border: `2px solid ${C.blue}`, boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
              <span className="text-sm font-semibold">{gpmTab === "camera" ? "Camera Techniques" : "Performance Studio"}</span>
              <Btn icon={Minimize2} onClick={() => setEnlarged(false)} color={C.blue} text="#fff">Shrink</Btn>
            </div>
            <div className="overflow-y-auto p-5">
              {gpmTab === "camera"
                ? <CameraGrid camCat={camCat} setCamCat={setCamCat} search={search} setSearch={setSearch} big onPick={(p) => { setWorking((w) => (w ? w + ", " : "") + p); flash("Appended to prompt"); }} />
                : <PerformancePanel perf={perf} setPerf={setPerf} perfOut={perfOut} copyText={copyText} applyToShot={applyToShot} selectedClip={selectedClip} sectionsOpen={sectionsOpen} setSectionsOpen={setSectionsOpen} allOpen={allOpen} big />}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium" style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: C.elev, border: `1px solid ${C.borderLt}`, zIndex: 60, boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}>
          <Check size={14} style={{ color: C.green }} />{toast}
        </div>
      )}
    </div>
  );
}

function TopTab({ id, cur, set, icon: Ic, children }) {
  const active = cur === id;
  return (
    <button onClick={() => set(id)} className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all"
      style={{ background: active ? C.elev : "transparent", color: active ? C.text : C.muted, boxShadow: active ? "inset 0 0 0 1px " + C.borderLt : "none" }}>
      <Ic size={14} style={{ color: active ? (id === "gpm" ? C.blue : C.text) : C.muted }} />{children}
    </button>
  );
}

/* ---------- Gen Space ---------- */
function GenView({ tiles, working, setWorking, gen, generate }) {
  return (
    <>
      <div className="flex items-center justify-end gap-4 px-5 py-3 text-xs" style={{ color: C.muted }}>
        <span className="flex items-center gap-1"><Heart size={14} /> Favorites</span><LayoutGrid size={15} />
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div className="grid grid-cols-3 gap-3">
          {tiles.map((t, i) => <div key={i} className="rounded-xl overflow-hidden" style={{ aspectRatio: "16/9", background: `linear-gradient(135deg, ${t}, #101216)`, border: `1px solid ${C.border}` }} />)}
        </div>
      </div>
      <div className="px-5 pb-5">
        <div className="rounded-2xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ border: `1px dashed ${C.borderLt}`, color: C.faint }}><ImageIcon size={16} /></div>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ border: `1px dashed ${C.borderLt}`, color: C.faint }}><Music size={16} /></div>
            <textarea value={working} onChange={(e) => setWorking(e.target.value)} placeholder="The woman sips from a cup of coffee…" rows={2}
              className="flex-1 bg-transparent outline-none text-sm resize-none" style={{ color: C.text, minHeight: 38 }} />
          </div>
          <div className="flex items-center justify-between mt-3 pt-3 text-xs" style={{ borderTop: `1px solid ${C.border}`, color: C.muted }}>
            <span className="flex items-center gap-1.5"><Video size={14} /> Video ⌄</span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><Sparkles size={13} style={{ color: C.amber }} /> LTX 2.3 Fast</span>
              <span className="flex items-center gap-1"><Clock size={12} /> 6s</span>
              <span className="flex items-center gap-1"><Monitor size={12} /> 1080</span><span>16:9</span>
              <button onClick={generate} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold" style={{ background: gen.active ? C.elev : C.blue, color: "#fff" }}>
                <Sparkles size={13} />{gen.active ? `Generating ${gen.pct}%` : "Generate"}
              </button>
            </div>
          </div>
          {gen.active && <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: C.elev }}><div className="h-full" style={{ width: `${gen.pct}%`, background: C.blue, transition: "width 0.06s linear" }} /></div>}
        </div>
      </div>
    </>
  );
}

/* ---------- Video Editor (selectable clips + in-place re-gen) ---------- */
function EditorView({ clips, tiles, selectedClipId, onSelect, compact }) {
  const sel = clips.find((c) => c.id === selectedClipId);
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-5 px-4 py-2 text-xs" style={{ borderBottom: `1px solid ${C.border}`, color: C.muted }}>
        {["File", "Edit", "Clip", "Sequence", "Tools", "View"].map((m) => <span key={m}>{m}</span>)}
        <span className="ml-auto flex items-center gap-1"><LayoutGrid size={12} /> Layout</span>
      </div>
      <div className="flex flex-1 min-h-0">
        {!compact && (
          <div className="w-48 flex flex-col" style={{ borderRight: `1px solid ${C.border}`, background: C.panel }}>
            <div className="px-3 py-2 text-sm font-semibold">Assets</div>
            <div className="grid grid-cols-2 gap-2 px-3 overflow-y-auto">
              {tiles.slice(0, 6).map((t, i) => <div key={i} className="rounded-md" style={{ aspectRatio: "1", background: `linear-gradient(135deg, ${t}, #101216)`, border: `1px solid ${C.border}` }} />)}
            </div>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center min-w-0" style={{ background: "#000" }}>
          <div className="rounded-md relative overflow-hidden" style={{ width: "72%", aspectRatio: "16/9", background: `linear-gradient(135deg, ${sel ? sel.color : "#333"}, #0c0d10)`, border: `1px solid ${C.border}` }}>
            {sel?.regen !== undefined && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: "rgba(0,0,0,0.55)" }}>
                <RotateCcw size={20} className="animate-spin" style={{ color: C.blue }} />
                <span className="text-xs" style={{ color: "#fff" }}>Re-generating {sel.regen}%</span>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Timeline */}
      <div style={{ height: 150, borderTop: `1px solid ${C.border}`, background: C.panel }}>
        <div className="flex items-center justify-between px-3 py-1.5 text-[10px]" style={{ color: C.amber, borderBottom: `1px solid ${C.border}` }}>
          <span className="tabular-nums">00:00:00:00</span>
          <span style={{ color: C.muted }}>{sel ? "Selected: " + sel.label.slice(0, 30) : "click a clip to select"}</span>
          <span className="tabular-nums">00:00:30:00</span>
        </div>
        <div className="p-2 overflow-x-auto">
          <div className="text-[10px] mb-1" style={{ color: C.muted }}>V1</div>
          <div className="flex gap-1">
            {clips.map((c) => {
              const isSel = c.id === selectedClipId;
              return (
                <button key={c.id} onClick={() => onSelect(c.id)}
                  className="rounded h-14 flex flex-col justify-between p-1 text-[9px] overflow-hidden relative text-left"
                  style={{ background: c.color, width: 158, minWidth: 100, outline: isSel ? `2px solid ${C.blue}` : "none", outlineOffset: 1 }}>
                  <span className="truncate text-white/90 flex items-center gap-1">
                    {c.updated && <RotateCcw size={8} style={{ color: "#fff" }} />}{c.label}
                  </span>
                  <span className="text-white/60 tabular-nums">{c.dur} · {c.res}</span>
                  {c.regen !== undefined && (
                    <div className="absolute left-0 right-0 bottom-0 h-1" style={{ background: "rgba(0,0,0,0.4)" }}>
                      <div className="h-full" style={{ width: `${c.regen}%`, background: C.blue }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Prompt Manager Pro dock ---------- */
function GpmDock(props) {
  const { gpmTab, setGpmTab, setEnlarged, search, setSearch, perf, setPerf, perfOut,
    shot, setShot, shotOut, wf, setWf, wfOut, camCat, setCamCat, working, setWorking,
    copyText, applyToShot, selectedClip, sectionsOpen, setSectionsOpen, allOpen, toggleAll } = props;

  const TABS = [["prompts", "Prompts"], ["images", "Images"], ["camera", "Camera"], ["shot", "Shot Setup"], ["plates", "Plates"], ["workflow", "Workflow"]];
  const sectProps = { sectionsOpen, setSectionsOpen, allOpen };

  return (
    <div className="flex" style={{ width: 396, borderLeft: `1px solid ${C.border}`, background: C.panel }}>
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
          <span className="text-sm font-semibold">Prompt Manager Pro</span>
          <button onClick={toggleAll} title="Collapse / expand all sections" className="text-[11px] flex items-center gap-1 px-2 py-1 rounded" style={{ color: C.muted, background: C.card, border: `1px solid ${C.border}` }}>
            {allOpen ? "⊟ Collapse all" : "⊞ Expand all"}
          </button>
        </div>

        {/* Active shot banner */}
        <div className="flex items-center gap-2 px-4 py-2 text-[11px]" style={{ borderBottom: `1px solid ${C.border}`, background: selectedClip ? "rgba(31,143,255,0.08)" : "transparent" }}>
          <Target size={13} style={{ color: selectedClip ? C.blue : C.faint }} />
          {selectedClip
            ? <span style={{ color: C.text }}>Active shot: <b style={{ color: C.blue }}>{selectedClip.label.slice(0, 30)}</b> — "Apply to shot" re-gens it</span>
            : <span style={{ color: C.muted }}>No shot selected — "Apply" makes a new generation</span>}
        </div>

        {/* Tab grid */}
        <div className="p-3 grid grid-cols-3 gap-2" style={{ borderBottom: `1px solid ${C.border}` }}>
          {TABS.map(([id, lbl]) => (
            <button key={id} onClick={() => setGpmTab(id)} className="rounded-md py-2 text-xs font-medium transition-colors"
              style={{ background: gpmTab === id ? C.blue : C.card, color: gpmTab === id ? "#fff" : C.muted, border: `1px solid ${gpmTab === id ? C.blue : C.border}` }}>{lbl}</button>
          ))}
          <button onClick={() => setGpmTab("performance")} className="col-span-3 rounded-md py-2 text-xs font-semibold transition-colors"
            style={{ background: gpmTab === "performance" ? C.blue : C.card, color: gpmTab === "performance" ? "#fff" : C.text, border: `1px solid ${gpmTab === "performance" ? C.blue : C.border}` }}>Performance Studio</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {gpmTab === "performance" && (<>
            <PanelHeader title="Performance Studio" onEnlarge={() => setEnlarged(true)} />
            <PerformancePanel perf={perf} setPerf={setPerf} perfOut={perfOut} copyText={copyText} applyToShot={applyToShot} selectedClip={selectedClip} {...sectProps} />
          </>)}
          {gpmTab === "camera" && (<>
            <PanelHeader title="Camera Techniques" onEnlarge={() => setEnlarged(true)} />
            <CameraGrid camCat={camCat} setCamCat={setCamCat} search={search} setSearch={setSearch} onPick={(p) => setWorking((w) => (w ? w + ", " : "") + p)} />
          </>)}
          {gpmTab === "shot" && <ShotPanel shot={shot} setShot={setShot} shotOut={shotOut} copyText={copyText} applyToShot={applyToShot} selectedClip={selectedClip} {...sectProps} />}
          {gpmTab === "workflow" && <WorkflowPanel wf={wf} setWf={setWf} wfOut={wfOut} copyText={copyText} applyToShot={applyToShot} selectedClip={selectedClip} {...sectProps} />}
          {gpmTab === "prompts" && <PromptsPanel search={search} setSearch={setSearch} applyToShot={applyToShot} copyText={copyText} />}
          {(gpmTab === "images" || gpmTab === "plates") && <Stub tab={gpmTab} />}
        </div>
      </div>
      <div className="flex items-center justify-center" style={{ width: 26, background: C.card, borderLeft: `1px solid ${C.border}` }}>
        <span className="text-[10px] tracking-widest" style={{ color: C.muted, writingMode: "vertical-rl", transform: "rotate(180deg)" }}>CLOSE</span>
      </div>
    </div>
  );
}

function PanelHeader({ title, onEnlarge }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="text-sm font-semibold">{title}</span>
      <Btn icon={Maximize2} onClick={onEnlarge} color={C.card} border={C.border} text={C.blue} className="!px-2 !py-1">Enlarge</Btn>
    </div>
  );
}

/* shared action row: Copy + Apply to shot */
function ActionRow({ copyLabel, onCopy, onApply, selectedClip }) {
  return (
    <div className="grid grid-cols-2 gap-2 mt-3">
      <Btn icon={Copy} onClick={onCopy} color={C.blue} text="#fff">{copyLabel}</Btn>
      <Btn icon={selectedClip ? RotateCcw : Send} onClick={onApply} color={C.green} text="#fff" title={selectedClip ? "Re-generate the selected shot" : "Generate a new shot"}>
        {selectedClip ? "Apply to shot" : "Generate new"}
      </Btn>
    </div>
  );
}

/* ---------- Performance ---------- */
function PerformancePanel({ perf, setPerf, perfOut, copyText, applyToShot, selectedClip, sectionsOpen, setSectionsOpen, allOpen, big }) {
  const up = (k, v) => setPerf((p) => ({ ...p, [k]: v }));
  const S = { sectionsOpen, setSectionsOpen, allOpen };
  return (
    <div className={big ? "grid grid-cols-2 gap-6" : ""}>
      <div>
        <p className="text-[11px] mb-3" style={{ color: C.muted }}>24 emotion families with intensity, asymmetry, dialogue, and delivery pacing</p>
        <Section id="perf-controls" title="Controls" {...S}>
          <Label>Emotion Family</Label>
          <select value={perf.familyIndex} onChange={(e) => up("familyIndex", parseInt(e.target.value))} className="w-full rounded-md px-3 py-2 text-sm mb-4 outline-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}>
            {PERF_FAMILIES.map((f, i) => <option key={i} value={i}>{f.family}</option>)}
          </select>
          <div className="flex items-center justify-between">
            <Label>Intensity <span style={{ color: C.blue }}>{perfLabel(PERF_FAMILIES[perf.familyIndex], perf.intensity)}</span></Label>
            <span className="text-xs tabular-nums" style={{ color: C.blue }}>{perf.intensity.toFixed(2)}</span>
          </div>
          <Slider value={perf.intensity} min={0} max={1} step={0.01} onChange={(v) => up("intensity", v)} left="contained" mid="surfacing" right="breaking" />
          <div className="flex items-center justify-between mt-4">
            <Label>Asymmetry</Label><span className="text-xs tabular-nums" style={{ color: C.blue }}>{perf.asymmetry.toFixed(2)}</span>
          </div>
          <Slider value={perf.asymmetry} min={0} max={1} step={0.01} onChange={(v) => up("asymmetry", v)} left="symmetric" mid="" right="acted" />
          <div className="mt-4 mb-1 flex items-center gap-2">
            <Label>Dialogue</Label>{perf.dialogue.trim() && <span className="text-[10px]" style={{ color: C.amber }}>auto-appends lip sync</span>}
          </div>
          <textarea value={perf.dialogue} onChange={(e) => up("dialogue", e.target.value)} rows={2} className="w-full rounded-md px-3 py-2 text-sm outline-none resize-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }} />
          <Label className="mt-4">Delivery</Label>
          <select value={perf.delivery} onChange={(e) => up("delivery", e.target.value)} className="w-full rounded-md px-3 py-2 text-sm outline-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}>
            <option value="natural">Natural (let emotion set the pace)</option>
            <option value="slow">Slow (weigh each word)</option>
            <option value="halting">Halting (start, stop, search)</option>
          </select>
        </Section>
      </div>

      <div>
        <Section id="perf-assembled" title={`Assembled · ${perfOut.label}`} {...S}>
          <div className="space-y-1.5">
            {perfOut.layers.map((l, i) => (
              <div key={i} className="text-[11px] leading-snug">
                <span className="font-semibold" style={{ color: C.muted }}>{l.k}: </span><span style={{ color: C.text }}>{l.v}</span>
              </div>
            ))}
          </div>
        </Section>
        <ActionRow copyLabel="Copy full prompt" onCopy={() => copyText(perfOut.text)} onApply={() => applyToShot(perfOut.text, perfOut.label)} selectedClip={selectedClip} />
        <Section id="perf-help" title="How interpolation works" {...S}>
          <p className="text-[10px] leading-relaxed" style={{ color: C.faint }}>
            Intensity slides between waypoints — <Chip>0</Chip> contained, <Chip>0.5</Chip> surfacing, <Chip>1</Chip> breaking.
            V/A coordinates interpolate linearly; FACS intensity scales with the slider; subtext stays constant. Asymmetry above <Chip>0.3</Chip> appends a laterality note.
          </p>
        </Section>
      </div>
    </div>
  );
}

/* ---------- Shot Setup ---------- */
function ShotPanel({ shot, setShot, shotOut, copyText, applyToShot, selectedClip, sectionsOpen, setSectionsOpen, allOpen }) {
  const setSlider = (k, v) => setShot((s) => ({ ...s, [k]: v, preset: null }));
  const toggleAnchor = (id) => setShot((s) => ({ ...s, anchors: { ...s.anchors, [id]: !s.anchors[id] } }));
  const S = { sectionsOpen, setSectionsOpen, allOpen };
  return (
    <div>
      <p className="text-[11px] mb-3" style={{ color: C.muted }}>Virtual camera composer — a transformation applied to the selected shot's existing frame.</p>
      <Section id="shot-presets" title="Presets" {...S}>
        <div className="grid grid-cols-4 gap-1.5">
          {SHOT_PRESETS.map((p) => (
            <button key={p.name} onClick={() => setShot({ rot: p.rot, tilt: p.tilt, zoom: p.zoom, preset: p, anchors: shot.anchors })}
              className="rounded-md py-1.5 text-[10px] flex flex-col items-center gap-0.5"
              style={{ background: shot.preset?.name === p.name ? C.blue : C.elev, color: shot.preset?.name === p.name ? "#fff" : C.muted, border: `1px solid ${shot.preset?.name === p.name ? C.blue : C.border}` }}>
              <span style={{ fontSize: 13 }}>{p.icon}</span>{p.name}
            </button>
          ))}
        </div>
      </Section>
      <Section id="shot-camera" title="Camera" {...S}>
        {[["rot", "Rotate", -90, 90], ["tilt", "Tilt", -45, 45], ["zoom", "Zoom", 1, 20]].map(([k, lbl, mn, mx]) => (
          <div key={k} className="mb-3">
            <div className="flex justify-between"><Label>{lbl}</Label><span className="text-xs tabular-nums" style={{ color: C.blue }}>{shot[k]}</span></div>
            <Slider value={shot[k]} min={mn} max={mx} step={1} onChange={(v) => setSlider(k, v)} left={mn} mid="" right={mx} />
          </div>
        ))}
      </Section>
      <Section id="shot-anchors" title="Consistency anchors" {...S}>
        <div className="flex flex-wrap gap-1.5">
          {SHOT_ANCHORS.map((a) => (
            <button key={a.id} onClick={() => toggleAnchor(a.id)} className="rounded-full px-2.5 py-1 text-[10px]"
              style={{ background: shot.anchors[a.id] ? "rgba(31,143,255,0.15)" : C.elev, color: shot.anchors[a.id] ? C.blue : C.muted, border: `1px solid ${shot.anchors[a.id] ? C.blue : C.border}` }}>{a.label}</button>
          ))}
        </div>
      </Section>
      <div className="rounded-lg p-3 text-[11px] leading-snug" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}>{shotOut}</div>
      <ActionRow copyLabel="Copy prompt" onCopy={() => copyText(shotOut)} onApply={() => applyToShot(shotOut, "Shot transform")} selectedClip={selectedClip} />
    </div>
  );
}

/* ---------- Workflow (role-bound slots → @imageN) ---------- */
function WorkflowPanel({ wf, setWf, wfOut, copyText, applyToShot, selectedClip, sectionsOpen, setSectionsOpen, allOpen }) {
  const S = { sectionsOpen, setSectionsOpen, allOpen };
  const upSlot = (id, patch) => setWf((w) => ({ ...w, slots: w.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const addSlot = () => setWf((w) => ({ ...w, slots: [...w.slots, { id: "s" + Date.now(), role: "general", note: "", filled: false }] }));
  const up = (k, v) => setWf((w) => ({ ...w, [k]: v }));
  return (
    <div>
      <p className="text-[11px] mb-3" style={{ color: C.muted }}>Multi-reference assembly — each slot binds an image to a role as <Chip>@imageN</Chip>.</p>
      <Section id="wf-slots" title={`Reference slots (${wf.slots.filter((s) => s.filled).length} filled)`} {...S}
        right={<span onClick={(e) => { e.stopPropagation(); addSlot(); }} className="flex items-center gap-1 text-[10px]" style={{ color: C.blue }}><Plus size={11} /> Add</span>}>
        <div className="space-y-2">
          {wf.slots.map((s, i) => (
            <div key={s.id} className="rounded-lg p-2 flex gap-2 items-center" style={{ background: C.elev, border: `1px solid ${C.border}` }}>
              <button onClick={() => upSlot(s.id, { filled: !s.filled })}
                className="w-12 h-12 rounded flex items-center justify-center shrink-0 text-[9px] text-center"
                style={{ background: s.filled ? "linear-gradient(135deg,#2b2620,#14110d)" : "transparent", border: `1px dashed ${s.filled ? C.border : C.borderLt}`, color: C.faint }}>
                {s.filled ? <ImageIcon size={15} style={{ color: C.amber, opacity: 0.8 }} /> : "drop\nimage"}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[9px] px-1.5 py-0.5 rounded tabular-nums" style={{ background: C.card, color: C.blue }}>@image{i + 1}</span>
                  <select value={s.role} onChange={(e) => upSlot(s.id, { role: e.target.value })} className="flex-1 rounded px-1.5 py-1 text-[11px] outline-none" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}>
                    {WF_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <input value={s.note} onChange={(e) => upSlot(s.id, { note: e.target.value })} placeholder="note (e.g. STORM)" className="w-full rounded px-2 py-1 text-[11px] outline-none" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="wf-directive" title="Directive & output" {...S}>
        <Label>Directive</Label>
        <textarea value={wf.directive} onChange={(e) => up("directive", e.target.value)} rows={2} className="w-full rounded-md px-3 py-2 text-sm outline-none resize-none mb-3" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }} />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Aspect</Label>
            <select value={wf.aspectRatio} onChange={(e) => up("aspectRatio", e.target.value)} className="w-full rounded-md px-2 py-1.5 text-xs outline-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}>
              {["16:9", "9:16", "1:1", "2.39:1"].map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label>Motion hint</Label>
            <input value={wf.motionHint} onChange={(e) => up("motionHint", e.target.value)} className="w-full rounded-md px-2 py-1.5 text-xs outline-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }} />
          </div>
        </div>
      </Section>

      <Section id="wf-perf" title="Performance (embedded)" {...S}>
        <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: C.text }}>
          <input type="checkbox" checked={wf.performance.enabled} onChange={(e) => setWf((w) => ({ ...w, performance: { enabled: e.target.checked } }))} style={{ accentColor: C.blue }} />
          Append the current Performance Studio prompt to this workflow
        </label>
        <p className="text-[10px] mt-2" style={{ color: C.faint }}>Mirrors GPM's workflow <Chip>performance</Chip> sub-object — the shot carries its emotional spec alongside the reference bindings.</p>
      </Section>

      <div className="rounded-lg p-3 text-[11px] leading-snug" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, minHeight: 44 }}>
        {wfOut || <span style={{ color: C.faint }}>Fill a slot or write a directive to assemble the prompt…</span>}
      </div>
      <ActionRow copyLabel="Copy prompt" onCopy={() => copyText(wfOut)} onApply={() => applyToShot(wfOut, wf.name)} selectedClip={selectedClip} />
    </div>
  );
}

/* ---------- Camera grid ---------- */
function CameraGrid({ camCat, setCamCat, search, setSearch, onPick, big }) {
  const cards = CAM_CARDS.filter((c) => (camCat === "All" || c.cat === camCat) && (!search || c.label.toLowerCase().includes(search.toLowerCase()) || c.phrase.toLowerCase().includes(search.toLowerCase())));
  return (
    <div>
      <SearchBar value={search} onChange={setSearch} placeholder="Search camera techniques…" />
      <div className="flex flex-wrap gap-1.5 my-3">
        {CAM_CATS.map((cat) => (
          <button key={cat} onClick={() => setCamCat(cat)} className="rounded-full px-2.5 py-1 text-[10px]" style={{ background: camCat === cat ? C.blue : C.card, color: camCat === cat ? "#fff" : C.muted, border: `1px solid ${camCat === cat ? C.blue : C.border}` }}>{cat}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => (
          <button key={c.id} onClick={() => onPick(c.phrase)} className="rounded-lg overflow-hidden text-left transition-transform hover:scale-[1.02]" style={{ border: `1px solid ${C.border}`, background: C.card }}>
            <div style={{ aspectRatio: big ? "16/9" : "4/3", background: "linear-gradient(135deg, #2b2620, #14110d)" }} className="flex items-end p-2"><Camera size={14} style={{ color: C.amber, opacity: 0.7 }} /></div>
            <div className="px-2 py-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide">{c.label}</div>
              {big && <div className="text-[10px] mt-0.5" style={{ color: C.muted }}>{c.phrase}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Prompts ---------- */
function PromptsPanel({ search, setSearch, applyToShot, copyText }) {
  const [openFolder, setOpenFolder] = useState("Cinematic Basics");
  const [sel, setSel] = useState(null);
  const q = search.toLowerCase();
  return (
    <div>
      <SearchBar value={search} onChange={setSearch} placeholder="Search prompts…" />
      <div className="flex gap-2 my-3">
        <Btn icon={Plus} color={C.blue} text="#fff" className="flex-1">Add Prompt</Btn>
        <Btn icon={FolderPlus} color={C.card} border={C.border} className="flex-1">New Folder</Btn>
      </div>
      <div className="flex gap-2 mb-3">
        {[["Export", Upload], ["Import", Download], ["Backup", Save], ["Restore", RefreshCw]].map(([l, Ic]) => <Btn key={l} icon={Ic} color={C.card} border={C.border} className="flex-1 !px-1.5 !text-[10px]">{l}</Btn>)}
      </div>
      <div className="flex items-center gap-1.5 mb-3 text-[11px]" style={{ color: C.amber }}><AlertTriangle size={12} /> Never backed up</div>
      {PROMPT_FOLDERS.map((f) => {
        const cards = f.cards.filter((c) => !q || c.title.toLowerCase().includes(q) || c.text.toLowerCase().includes(q));
        const open = openFolder === f.name;
        return (
          <div key={f.name} className="mb-2 rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            <button onClick={() => setOpenFolder(open ? null : f.name)} className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ background: C.card }}>
              <span className="flex items-center gap-2"><ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", color: C.muted }} /> {f.name}</span>
              <span style={{ color: C.faint }}>{cards.length}</span>
            </button>
            {open && cards.map((c) => (
              <div key={c.id} onClick={() => setSel(c.id)} className="px-3 py-2 cursor-pointer" style={{ borderTop: `1px solid ${C.border}`, background: sel === c.id ? C.elev : "transparent" }}>
                <div className="text-xs font-medium">{c.title}</div>
                <div className="text-[11px] mt-0.5" style={{ color: C.muted }}>{c.text}</div>
                {sel === c.id && (
                  <div className="flex gap-2 mt-2">
                    <Btn icon={Copy} onClick={() => copyText(c.text)} color={C.blue} text="#fff" className="!px-2 !py-1 !text-[10px]">Copy</Btn>
                    <Btn icon={Send} onClick={() => applyToShot(c.text, c.title)} color={C.green} text="#fff" className="!px-2 !py-1 !text-[10px]">Apply to shot</Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Stub({ tab }) {
  const map = {
    images: ["Images", "Reference-image library with role bindings (@image1…@imageN). IndexedDB-backed in the fork."],
    plates: ["Plates", "Panorama → plate workflow. Stored in the panoramas IndexedDB store; re-platforms onto the LTX canvas."],
  };
  const [t, d] = map[tab];
  return (
    <div className="rounded-lg p-5 text-center" style={{ background: C.card, border: `1px dashed ${C.borderLt}` }}>
      <Layers size={22} style={{ color: C.faint, margin: "0 auto 8px" }} />
      <div className="text-sm font-semibold mb-1">{t}</div>
      <div className="text-[11px]" style={{ color: C.muted }}>{d}</div>
      <div className="text-[10px] mt-3 px-2 py-1 rounded inline-block" style={{ background: C.elev, color: C.faint }}>port pending</div>
    </div>
  );
}
