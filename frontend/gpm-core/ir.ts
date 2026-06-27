/**
 * gpm-core / intermediate representation
 *
 * PURE type-only module. The locked content model: a Project is composed of
 * Acts → Scenes → Beats → Shots, and the Shot is the atomic generated unit.
 * These are declarations only — no runtime behaviour lives here.
 */

import type { LtxAspectRatio, LtxPipeline, LtxResolution } from "./renderer";
import type { PerfInput } from "./performance";
import type { ShotState } from "./shot";
import type { WfState } from "./workflow";

/** The atomic unit. Everything the engines can produce hangs off a Shot. */
export interface Shot {
  id: string;
  title?: string;
  /** The composed prompt last applied to this shot. */
  prompt?: string;
  /** Existing frame used as the source for in-place re-generation. */
  imagePath?: string | null;
  /** Optional engine inputs captured so a shot can be recomposed. */
  performance?: PerfInput;
  camera?: ShotState;
  workflow?: WfState;
  /** Generation parameters carried with the shot. */
  resolution?: LtxResolution;
  model?: LtxPipeline;
  aspectRatio?: LtxAspectRatio;
}

export interface Beat {
  id: string;
  title?: string;
  shots: Shot[];
}

export interface Scene {
  id: string;
  title?: string;
  beats: Beat[];
}

export interface Act {
  id: string;
  title?: string;
  scenes: Scene[];
}

export interface Project {
  id: string;
  name: string;
  acts: Act[];
}
