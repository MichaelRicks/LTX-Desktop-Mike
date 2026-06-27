/**
 * gpm-core / workflow builder
 *
 * PURE module. Role-bound reference slots assembled into an @imageN directive,
 * ported from `ltx-gpm.jsx` (buildWorkflowPrompt). An optional embedded
 * performance spec is appended when enabled.
 */

export type WfRole = "character" | "location" | "style" | "storyboard" | "asset" | "general";

export interface WfRoleOption {
  value: WfRole;
  label: string;
}

export interface WfSlot {
  id: string;
  role: WfRole;
  note: string;
  filled: boolean;
  /** Bound reference image from the Images library (optional). */
  imgId?: string;
  imgName?: string;
}

export interface WfPerformance {
  enabled: boolean;
}

export interface WfState {
  name: string;
  slots: WfSlot[];
  directive: string;
  aspectRatio: string;
  motionHint: string;
  performance: WfPerformance;
}

export const WF_ROLES: WfRoleOption[] = [
  { value: "character", label: "👤 Character Ref" },
  { value: "location", label: "📍 Location Ref" },
  { value: "style", label: "🎨 Style Ref" },
  { value: "storyboard", label: "🎞 Storyboard Frame" },
  { value: "asset", label: "📦 Asset / Prop" },
  { value: "general", label: "🖼 General Ref" },
];

export function wfRoleLabel(v: WfRole): string {
  return WF_ROLES.find((r) => r.value === v)?.label ?? "🖼 General Ref";
}

/**
 * Assemble the workflow prompt. `perfText` is the current Performance Studio
 * output, appended only when `wf.performance.enabled` is true.
 */
export function buildWorkflowPrompt(wf: WfState, perfText: string): string {
  const filled = wf.slots.map((s, i) => ({ s, i })).filter((e) => e.s.filled);
  if (filled.length === 0 && !wf.directive.trim()) return "";

  const parts: string[] = [];
  if (filled.length) {
    const refs = filled
      .map(({ s, i }) => {
        const role = wfRoleLabel(s.role).replace(/^\S+ /, "");
        const note = s.note ? ` (${s.note})` : "";
        return `@image${i + 1} = ${role}${note}`;
      })
      .join(", ");
    parts.push(`Using these reference images: ${refs}.`);
  }
  if (wf.directive.trim()) parts.push(wf.directive.trim());

  const extras: string[] = [];
  if (wf.aspectRatio && wf.aspectRatio !== "16:9") extras.push(`Aspect ratio: ${wf.aspectRatio}`);
  if (wf.motionHint.trim()) extras.push(wf.motionHint.trim());
  if (extras.length) parts.push(extras.join(". ") + ".");

  if (wf.performance.enabled && perfText) parts.push(perfText);

  return parts.join(" ");
}
