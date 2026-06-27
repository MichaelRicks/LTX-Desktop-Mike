/**
 * gpm-core / performance engine
 *
 * PURE module: no DOM, no storage, no React. Ported from the inlined logic in
 * `ltx-gpm.jsx` (assemblePerformance) and completed to the full 24 emotion
 * families. The first 12 families are faithful to the prototype; the remaining
 * 12 are authored to the identical waypoint schema (FACS + anatomical +
 * performance + valence/arousal).
 */

export interface ValenceArousal {
  /** valence, -1 (negative) … +1 (positive) */
  v: number;
  /** arousal, -1 (calm) … +1 (activated) */
  a: number;
}

export interface PerfWaypoint {
  name: string;
  va: ValenceArousal;
  /** Facial Action Coding System action units, e.g. "AU1", "AU4". */
  facs: string[];
  /** Anatomical description of the face at this waypoint. */
  anat: string;
  /** Performance / body description at this waypoint. */
  perf: string;
}

export interface PerfFamily {
  family: string;
  subtext: string;
  /** Two or three ordered waypoints the intensity slider interpolates between. */
  waypoints: PerfWaypoint[];
}

export type PerfDelivery = "natural" | "slow" | "halting";

export interface PerfInput {
  familyIndex?: number;
  /** 0 … 1 */
  intensity?: number;
  /** 0 … 1 */
  asymmetry?: number;
  dialogue?: string;
  delivery?: PerfDelivery;
}

export interface PerfLayer {
  k: string;
  v: string;
}

export interface PerfResult {
  label: string;
  layers: PerfLayer[];
  /** The assembled prompt: each layer rendered as "k: v" on its own line. */
  text: string;
}

export const PERF_FAMILIES: PerfFamily[] = [
  { family: "Sadness", subtext: "carrying weight that won't put down", waypoints: [
    { name: "Melancholy", va: { v: -0.4, a: -0.3 }, facs: ["AU1", "AU4", "AU15", "AU41"], anat: "inner brows subtly raised and drawn together, lip corners barely turned down, upper eyelids slightly heavy", perf: "stillness, slow blink rate, breath quiet and even, gaze unfocused on middle distance" },
    { name: "Grief Contained", va: { v: -0.85, a: 0.6 }, facs: ["AU1", "AU4", "AU15", "AU17"], anat: "inner brows knitted up and together with vertical furrow, mouth corners drawn down, chin pushed up beneath a tensed lower lip, eyes wet but not spilling", perf: "rigid stillness, breath held in the chest, jaw locked, single tear pooling without falling, micro-tremor in lower lip" },
    { name: "Grief Breaking", va: { v: -0.95, a: 0.9 }, facs: ["AU1", "AU4", "AU6", "AU15", "AU17", "AU25"], anat: "inner brows pulled sharply up, eyes squeezed partly shut with tears overflowing, mouth corners pulled hard down, lower lip protruded and trembling", perf: "shoulders shaking, breath in catching gasps, head dropping forward" },
  ] },
  { family: "Fear", subtext: "watching for the thing that hasn't arrived yet", waypoints: [
    { name: "Anxiety", va: { v: -0.5, a: 0.6 }, facs: ["AU1", "AU2", "AU4", "AU5", "AU24"], anat: "inner brows raised and slightly drawn together, eyes alert with mild upper-lid lift, lips pressed thin", perf: "restless micro-movements, shallow upper-chest breathing, eyes scanning, jaw subtly tight" },
    { name: "Dread", va: { v: -0.75, a: 0.7 }, facs: ["AU1", "AU2", "AU4", "AU5", "AU20", "AU24"], anat: "brows raised and pulled together, eyes wide and tense with upper lids elevated, lips slightly stretched, color drained", perf: "stillness with held breath, swallow visible, slow shake of head, body weight pulled back" },
    { name: "Terror", va: { v: -0.95, a: 1.0 }, facs: ["AU1", "AU2", "AU4", "AU5", "AU20", "AU26"], anat: "brows pulled high and tight, eyes stretched wide showing white above the iris, mouth open and pulled sideways into a frozen grimace", perf: "head recoiled, body frozen mid-motion, breath stopped, hands raised defensively" },
  ] },
  { family: "Anger", subtext: "the line that cannot be crossed has been crossed", waypoints: [
    { name: "Sternness", va: { v: -0.3, a: 0.2 }, facs: ["AU4", "AU7", "AU24"], anat: "brows lowered and slightly drawn together, lids tightened into a level gaze, lips pressed firmly, jaw set", perf: "minimal movement, breathing slow and controlled, posture squared, gaze unwavering" },
    { name: "Cold Anger", va: { v: -0.7, a: 0.5 }, facs: ["AU4", "AU5", "AU7", "AU23"], anat: "brows pulled down with a vertical crease, hard stare, lips pressed into a thin tense line, nostrils slightly flared", perf: "unnatural stillness, jaw muscles working, breath controlled with effort, slight forward lean" },
    { name: "Rage", va: { v: -0.9, a: 1.0 }, facs: ["AU4", "AU5", "AU7", "AU10", "AU23", "AU25"], anat: "brows pulled violently down with deep furrows, eyes bulging, lips pulled back to bare clenched teeth, jaw thrust forward", perf: "breath heavy and audible, shoulders heaving, body coiled forward, hands clenched" },
  ] },
  { family: "Joy", subtext: "the good thing is actually happening", waypoints: [
    { name: "Contentment", va: { v: 0.6, a: -0.3 }, facs: ["AU6", "AU12"], anat: "lip corners gently turned up with cheeks softly raised, eyes relaxed and warm, brow smooth", perf: "slow easy breath, soft blink rate, head settled, gaze present and unhurried" },
    { name: "Felt Joy", va: { v: 0.8, a: 0.5 }, facs: ["AU6", "AU12", "AU25"], anat: "mouth pulled up and outward while cheeks lift, outer eye corners crinkle, upper teeth just visible — a genuine felt smile", perf: "light forward energy, easier breath, eyes engaged with what produced the feeling" },
    { name: "Elation", va: { v: 0.95, a: 0.9 }, facs: ["AU6", "AU12", "AU25", "AU26"], anat: "wide open smile with teeth visible, cheeks pushed high, eyes shining, head tilted back, jaw dropped in laughter", perf: "body loose and bouncing, breath catching with laughter, head thrown back" },
  ] },
  { family: "Surprise", subtext: "the world just rearranged itself", waypoints: [
    { name: "Mild Surprise", va: { v: 0, a: 0.5 }, facs: ["AU1", "AU2", "AU5"], anat: "brows lifted with horizontal forehead lines, upper lids slightly raised, mouth neutral or just parted", perf: "head pulls back a touch, blink, brief breath catch, quick re-orientation" },
    { name: "Shock", va: { v: -0.4, a: 0.95 }, facs: ["AU1", "AU2", "AU5", "AU27"], anat: "brows shot up and arched, eyes stretched wide with white all around the iris, mouth dropped fully open in a slack oval", perf: "body frozen, breath caught, hand may rise toward mouth, total stillness for a beat" },
  ] },
  { family: "Disgust", subtext: "the body rejecting what it sees", waypoints: [
    { name: "Distaste", va: { v: -0.4, a: 0.2 }, facs: ["AU9", "AU10", "AU15"], anat: "subtle nose wrinkle, upper lip slightly raised on one side, mouth corners faintly down", perf: "small head turn away, slight backward lean, gaze averted briefly" },
    { name: "Revulsion", va: { v: -0.9, a: 0.8 }, facs: ["AU9", "AU10", "AU15", "AU16", "AU25"], anat: "deeply wrinkled nose, upper lip pulled hard up to bare teeth, lower lip pulled down and out, eyes squinted", perf: "full body recoil, gag reflex visible, hand clamped over mouth, head turned sharply away" },
  ] },
  { family: "Determination", subtext: "the decision is already made", waypoints: [
    { name: "Resolve", va: { v: 0.1, a: 0.5 }, facs: ["AU4", "AU7", "AU24"], anat: "brows lowered with a focused furrow, eyes locked forward, lips pressed firmly, jaw set, chin level", perf: "controlled breath in through nose, steady posture, gaze unwavering, small nod possible" },
    { name: "Fierce Will", va: { v: 0.2, a: 0.85 }, facs: ["AU4", "AU5", "AU7", "AU24"], anat: "brows pulled down with focused intensity, eyes wide and locked, lips pressed hard, masseter visibly tensed", perf: "breath drawn in and held, body coiled and ready, slight forward lean, hands clenched" },
  ] },
  { family: "Tenderness", subtext: "looking at someone you would protect with your life", waypoints: [
    { name: "Soft Warmth", va: { v: 0.6, a: -0.2 }, facs: ["AU6", "AU12", "AU43"], anat: "gentle smile with cheeks softly raised, eyelids relaxed, gaze warm and steady, head tilted slightly", perf: "slow soft breathing, unhurried blink, the faintest forward lean, gaze resting with ease" },
    { name: "Deep Tenderness", va: { v: 0.7, a: 0.2 }, facs: ["AU1", "AU6", "AU12", "AU43"], anat: "inner brows raised softly with a tender smile, eyes glistening slightly, cheeks raised, lips parted", perf: "breath caught with feeling, eyes welling faintly, hand may rise toward the other's face" },
  ] },
  { family: "Awe", subtext: "encountering something far larger than yourself", waypoints: [
    { name: "Wonder", va: { v: 0.5, a: 0.5 }, facs: ["AU1", "AU2", "AU5", "AU25"], anat: "brows raised high and smooth, eyes wide and bright taking everything in, lips parted softly, head lifting", perf: "breath drawn in and held, slow head shake, gaze sweeping upward, body still and absorbed" },
    { name: "Overwhelmed Awe", va: { v: 0.4, a: 0.8 }, facs: ["AU1", "AU2", "AU5", "AU26"], anat: "brows raised high, eyes stretched wide and welling, mouth fallen open, head tilted back", perf: "breath catching, hand rising slowly to chest or mouth, body frozen, a barely audible exhale" },
  ] },
  { family: "Sinister", subtext: "already knowing how this ends for you", waypoints: [
    { name: "Calculating Menace", va: { v: -0.3, a: -0.1 }, facs: ["AU7", "AU12", "AU43"], anat: "a slow controlled half-smile that does not reach the eyes, lids slightly lowered, unblinking gaze, head very still", perf: "near-total stillness, slow deliberate blink, breathing quiet and even, the calm of someone in control" },
    { name: "Cruel Relish", va: { v: -0.5, a: 0.3 }, facs: ["AU6", "AU7", "AU12", "AU14"], anat: "a tightening smile with cheeks raised but eyes cold and narrowed, gaze locked and savoring, head tilted", perf: "a slow lean forward, savoring quality, a quiet exhale of pleasure, tracking the other's discomfort" },
    { name: "Overt Malice", va: { v: -0.8, a: 0.7 }, facs: ["AU4", "AU5", "AU7", "AU9", "AU12", "AU23"], anat: "brows lowered over wide cold eyes, a predatory stare, a hard baring smile with teeth showing, jaw set", perf: "stillness coiled into forward intent, a deliberate step closer, the threat fully surfaced" },
  ] },
  { family: "Hope", subtext: "afraid to believe it but unable not to", waypoints: [
    { name: "Fragile Hope", va: { v: 0.2, a: 0.4 }, facs: ["AU1", "AU2", "AU5", "AU12"], anat: "inner brows raised softly, eyes widening with a tentative light, a small uncertain smile beginning, head lifting slightly", perf: "breath held in anticipation, a forward lean, the smile flickering between belief and fear" },
    { name: "Rising Hope", va: { v: 0.5, a: 0.6 }, facs: ["AU1", "AU2", "AU5", "AU6", "AU12"], anat: "brows raised high, eyes wide and shining and welling, a growing genuine smile lifting the cheeks, head coming up", perf: "breath quickening, hand rising to chest, body straightening, caution giving way to joy" },
  ] },
  { family: "Exhaustion", subtext: "running on empty and past pretending otherwise", waypoints: [
    { name: "Weariness", va: { v: -0.3, a: -0.5 }, facs: ["AU41", "AU43", "AU15"], anat: "heavy upper eyelids drooping, faint downturn at the mouth, slack facial muscles, gaze unfocused", perf: "slow heavy blinks, delayed reactions, a long exhale, shoulders sagging" },
    { name: "Depletion", va: { v: -0.5, a: -0.7 }, facs: ["AU41", "AU43", "AU15", "AU54"], anat: "eyes barely open and unfocused, whole face gone slack, mouth slightly open from fatigue, head low", perf: "eyes closing involuntarily, head dropping and jerking back up, body held up by effort alone" },
  ] },

  // ---- Authored to the same waypoint schema (families 13–24) ----------------
  { family: "Longing", subtext: "reaching for what is just out of reach", waypoints: [
    { name: "Wistful Longing", va: { v: 0.1, a: -0.2 }, facs: ["AU1", "AU43"], anat: "inner brows raised and gently drawn up, gaze soft and fixed on the distance, lips slightly parted, head tilted", perf: "slow breath held a beat too long, eyes unfocused on something far off, faint forward lean toward the absent thing" },
    { name: "Aching Longing", va: { v: -0.3, a: 0.4 }, facs: ["AU1", "AU4", "AU15"], anat: "inner brows pulled up and together, eyes welling faintly, lips pressed then parting, throat tightening", perf: "a slow swallow, breath catching, a hand half-rising toward nothing, the body leaning into an absence" },
  ] },
  { family: "Pride", subtext: "having earned this and knowing it", waypoints: [
    { name: "Quiet Pride", va: { v: 0.6, a: 0.1 }, facs: ["AU6", "AU12"], anat: "a small contained smile with cheeks lightly raised, chin lifted, eyes steady and bright, shoulders settled back", perf: "an easy slow breath, head held high, gaze level and unhurried, the faint smile of self-possession" },
    { name: "Swelling Pride", va: { v: 0.8, a: 0.5 }, facs: ["AU6", "AU12", "AU25"], anat: "a broad smile with teeth showing, chest lifted and shoulders squared, chin raised, eyes shining", perf: "a deep breath filling the chest, head tilted slightly back, a radiant outward energy, standing taller" },
  ] },
  { family: "Shame", subtext: "wanting to disappear from your own skin", waypoints: [
    { name: "Self-Conscious Shame", va: { v: -0.5, a: 0.2 }, facs: ["AU15", "AU54"], anat: "lip corners turned down, gaze dropped and averted, head lowered, color rising in the cheeks", perf: "shoulders curling inward, a small step back, gaze unable to meet another's, breath shallow" },
    { name: "Crushing Shame", va: { v: -0.85, a: 0.5 }, facs: ["AU15", "AU17", "AU54"], anat: "mouth pulled down and chin tensed, head bowed low, eyes squeezed shut or fixed on the floor, whole face flushed", perf: "body folding in on itself, a hand covering the face, breath ragged and held, the wish to vanish made physical" },
  ] },
  { family: "Guilt", subtext: "the weight of what you did to someone", waypoints: [
    { name: "Pricking Guilt", va: { v: -0.4, a: 0.3 }, facs: ["AU1", "AU4", "AU15"], anat: "inner brows drawn up and together, gaze flicking away and back, lips pressed and downturned", perf: "restless small movements, an inability to hold eye contact, a swallow, weight shifting foot to foot" },
    { name: "Consuming Guilt", va: { v: -0.75, a: 0.55 }, facs: ["AU1", "AU4", "AU15", "AU17"], anat: "brows knitted high and together with a furrow, eyes wet and fixed downward, mouth pulled down, chin trembling", perf: "head dropping, a hand at the mouth, breath catching, the body braced against its own conscience" },
  ] },
  { family: "Contempt", subtext: "looking down on something beneath you", waypoints: [
    { name: "Cool Contempt", va: { v: -0.3, a: 0.0 }, facs: ["AU14"], anat: "one lip corner tightened and raised in a unilateral sneer, lids slightly lowered, head tilted back a fraction, gaze cool and downward", perf: "near stillness, a slow blink, a faint dismissive exhale, weight settled back and away" },
    { name: "Open Disdain", va: { v: -0.6, a: 0.3 }, facs: ["AU9", "AU10", "AU14"], anat: "asymmetric sneer with nose faintly wrinkled, upper lip raised on one side, chin lifted, eyes narrowed and looking down the nose", perf: "a slow shake of the head, a scoffing breath, a half-turn away as if the other is not worth facing" },
  ] },
  { family: "Envy", subtext: "wanting what is theirs and resenting that it is theirs", waypoints: [
    { name: "Quiet Envy", va: { v: -0.4, a: 0.3 }, facs: ["AU4", "AU7", "AU14"], anat: "brows subtly lowered, lids tightened, a thin pressed half-smile that does not warm the eyes, jaw set", perf: "a fixed sidelong gaze tracking the other, a tight swallow, stillness with tension underneath, a forced civil expression" },
    { name: "Bitter Envy", va: { v: -0.7, a: 0.55 }, facs: ["AU4", "AU7", "AU23", "AU24"], anat: "brows pulled down, eyes narrowed and hard, lips pressed thin and tight, nostrils faintly flared", perf: "jaw muscles working, a controlled bitter exhale, body angled away while the eyes stay locked on what is coveted" },
  ] },
  { family: "Confusion", subtext: "the pieces refusing to fit together", waypoints: [
    { name: "Mild Confusion", va: { v: -0.1, a: 0.3 }, facs: ["AU4", "AU7"], anat: "brows drawn together with a single vertical furrow, one brow slightly higher, eyes searching, lips pursed to one side", perf: "a slow tilt of the head, a blink, gaze flicking as if re-reading the situation, a small questioning pause" },
    { name: "Bewilderment", va: { v: -0.3, a: 0.6 }, facs: ["AU1", "AU2", "AU4", "AU5"], anat: "brows pulled together yet raised, forehead creased, eyes widened and darting, mouth slightly open in an unformed question", perf: "head drawing back, hands lifting in a small helpless gesture, breath suspended, the visible effort to make sense of it" },
  ] },
  { family: "Boredom", subtext: "time that refuses to pass", waypoints: [
    { name: "Listlessness", va: { v: -0.2, a: -0.5 }, facs: ["AU43", "AU15"], anat: "eyelids heavy and half-lowered, gaze unfocused and drifting, lips slack with a faint downturn, jaw loose", perf: "a slow exhale through the nose, a propped head, delayed wandering glances, fidgeting with something idle" },
    { name: "Deep Tedium", va: { v: -0.4, a: -0.7 }, facs: ["AU43", "AU54"], anat: "eyes nearly closing, face entirely slack, head sinking toward a hand, mouth parting in a suppressed yawn", perf: "a stifled yawn, the head slipping then catching, glazed unfocused stare, the body gone limp with monotony" },
  ] },
  { family: "Anticipation", subtext: "the moment before the thing you have waited for", waypoints: [
    { name: "Eager Anticipation", va: { v: 0.5, a: 0.5 }, facs: ["AU1", "AU2", "AU5", "AU12"], anat: "brows raised, eyes bright and widening, a smile beginning to form, body leaning forward toward what is coming", perf: "quickened shallow breath, a small bounce or shift of weight, eyes fixed expectantly, hands clasped or rubbing together" },
    { name: "Breathless Anticipation", va: { v: 0.6, a: 0.8 }, facs: ["AU1", "AU2", "AU5", "AU25", "AU26"], anat: "brows high, eyes wide and shining, lips parted and pulling toward a grin, head lifted and forward", perf: "breath held high in the chest, body coiled on the edge, a barely contained energy, eyes darting to the source of expectation" },
  ] },
  { family: "Relief", subtext: "the danger has finally passed", waypoints: [
    { name: "Quiet Relief", va: { v: 0.4, a: -0.2 }, facs: ["AU43", "AU12"], anat: "eyes closing briefly, brow smoothing and releasing its tension, a soft small smile, shoulders dropping", perf: "a long slow exhale, the head tipping back a touch, the whole body unclenching, a hand resting on the chest" },
    { name: "Overwhelming Relief", va: { v: 0.6, a: 0.4 }, facs: ["AU1", "AU6", "AU12", "AU43"], anat: "inner brows raised with eyes welling, a trembling smile breaking through, cheeks raised, face flushing warm", perf: "a shaky laugh or sob of release, hands covering the face then dropping, breath shuddering out, the body sagging as the weight lifts" },
  ] },
  { family: "Nostalgia", subtext: "warmed and saddened by something gone", waypoints: [
    { name: "Fond Nostalgia", va: { v: 0.4, a: -0.2 }, facs: ["AU6", "AU12", "AU43"], anat: "a soft wistful smile with cheeks gently raised, eyes warm and slightly unfocused, head tilted, gaze on the middle distance", perf: "a slow easy breath, a faint private smile, eyes drifting as if watching a memory, stillness with warmth" },
    { name: "Bittersweet Nostalgia", va: { v: 0.1, a: 0.0 }, facs: ["AU1", "AU6", "AU12", "AU15"], anat: "inner brows lifting softly, a smile tinged with downturned corners, eyes glistening, head lowered slightly", perf: "a quiet sigh, the smile flickering toward sadness, a slow blink releasing a bright film over the eyes, gaze turned inward" },
  ] },
  { family: "Curiosity", subtext: "drawn toward something you do not yet understand", waypoints: [
    { name: "Piqued Curiosity", va: { v: 0.3, a: 0.4 }, facs: ["AU1", "AU2"], anat: "brows raised with one slightly higher, eyes widening and fixing on the object of interest, lips parted faintly, head tilting", perf: "a slow lean in, a narrowing focus, an unconscious step closer, breath light and attentive" },
    { name: "Intense Fascination", va: { v: 0.5, a: 0.7 }, facs: ["AU1", "AU2", "AU5", "AU25"], anat: "brows high, eyes wide and bright and locked on, mouth slightly open, head extended forward", perf: "the body drawn fully toward the subject, breath quickening, complete absorption, hands reaching or hovering as if to touch" },
  ] },
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface WaypointPair {
  a: PerfWaypoint;
  b: PerfWaypoint;
  /** 0 … 1 blend factor from a → b */
  t: number;
}

function perfWaypointPair(fam: PerfFamily, intensity: number): WaypointPair {
  const w = fam.waypoints;
  if (w.length <= 2) {
    return { a: w[0], b: w[w.length - 1], t: intensity };
  }
  if (intensity <= 0.5) return { a: w[0], b: w[1], t: intensity * 2 };
  return { a: w[1], b: w[2], t: (intensity - 0.5) * 2 };
}

function perfIntensityWord(i: number): string {
  if (i < 0.15) return "trace";
  if (i < 0.4) return "slight";
  if (i < 0.65) return "moderate";
  if (i < 0.85) return "pronounced";
  return "maximum";
}

export function perfLabel(fam: PerfFamily, i: number): string {
  const w = fam.waypoints;
  if (w.length <= 2) {
    if (i < 0.33) return w[0].name;
    if (i > 0.67) return w[w.length - 1].name;
    return `${w[0].name} → ${w[w.length - 1].name}`;
  }
  if (i < 0.2) return w[0].name;
  if (i < 0.4) return `${w[0].name} → ${w[1].name}`;
  if (i < 0.6) return w[1].name;
  if (i < 0.8) return `${w[1].name} → ${w[2].name}`;
  return w[2].name;
}

function perfAsymNote(a: number): string | null {
  if (a < 0.3) return null;
  if (a < 0.55) return "with slight left-right asymmetry across the brow or mouth";
  if (a < 0.8) return "with visible facial asymmetry — one side more active than the other";
  return "with strong facial asymmetry, the expression noticeably stronger on one side";
}

function perfDeliveryNote(d: PerfDelivery): string | null {
  if (d === "slow") return "speaking slowly, weighing each word, leaving silence between phrases";
  if (d === "halting") return "halting delivery, starting and stopping, searching for the words";
  return null;
}

export function assemblePerformance(input: PerfInput): PerfResult {
  const {
    familyIndex = 0,
    intensity = 0.5,
    asymmetry = 0.25,
    dialogue = "",
    delivery = "natural",
  } = input;

  const fam = PERF_FAMILIES[familyIndex] ?? PERF_FAMILIES[0];
  const line = dialogue.trim();
  const { a, b, t } = perfWaypointPair(fam, intensity);
  const v = lerp(a.va.v, b.va.v, t);
  const ar = lerp(a.va.a, b.va.a, t);
  const wp = t < 0.5 ? a : b;
  const iw = perfIntensityWord(intensity);
  const asym = perfAsymNote(asymmetry);
  const anat = asym ? `${wp.anat}, ${asym}` : wp.anat;
  const label = `${fam.family} — ${perfLabel(fam, intensity)}`;

  const layers: PerfLayer[] = [
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
