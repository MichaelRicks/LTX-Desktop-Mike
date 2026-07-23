# Fork Maintenance Guide

This fork of [Lightricks/LTX-Desktop](https://github.com/Lightricks/LTX-Desktop) carries
substantial custom work. This document exists so that **merging a new upstream release is a
checklist, not an archaeology expedition.**

When you hit a merge conflict, find the file in the map below to learn which feature owns it
and what must survive.

Last updated: 2026-07-21 · Fork base: upstream **LTX Desktop 1.1.0**
(`sync-public-preview/2026-07-19`, merged in `cd9395e`)

Branches: `feature/upstream-1.1.0` is the current line.
`feature/21-9-plus-save-video` is frozen at `5b5efbc` as the pre-1.1.0 backup —
falling back to it **requires** `cd backend && uv sync --extra test --extra dev`,
or you'll run 1.0.5 code against 1.1.0 libraries.

---

## 1. Fork shape (why merges are survivable)

| | Count |
|---|---|
| New files we added (never conflict) | 108 |
| Upstream files we modified (merge debt) | 69 |

Most of the fork is **additive**, which is deliberate — keep it that way. When adding a
feature, put the logic in a **new file** and touch upstream files with as few lines as
possible (ideally: one import, one call). The Save-video feature is the model to copy; the
color-palette feature is the one to be careful with, because it edits shared config.

---

## 2. Upstream tracking

```bash
git remote -v                          # 'upstream' should point at Lightricks/LTX-Desktop
git fetch upstream                     # do this weekly-ish
git log --oneline upstream/main -1     # current upstream release
git branch -r | grep sync-public-preview   # early warning: previews land here BEFORE main
```

Lightricks publishes `sync-public-preview/<date>-<sha>` branches ahead of tagging `main`, so
you generally get advance notice of a release. Also worth enabling GitHub **Watch → Releases
only** on the upstream repo.

**Merge every release, promptly.** Conflict pain is super-linear: two releases merged
separately is far cheaper than one two-release gap.

### Merge recipe

Never merge upstream straight into your working branch. Use a throwaway:

```bash
git fetch upstream
git checkout -b merge/upstream-X.Y.Z <your-working-branch>
git merge upstream/main                # resolve conflicts using the map below
pnpm run typecheck:ts                  # safety net 1
cd backend && uv run pytest -q         # safety net 2
# then the manual smoke test in section 5
git checkout <your-working-branch> && git merge merge/upstream-X.Y.Z
```

If it goes wrong: `git merge --abort`, delete the branch. Your working branch never moved.

**Merge, don't rebase.** Rebasing replays every fork commit and makes you re-resolve the same
conflicts repeatedly.

### ⚠️ Dependency pins: do NOT blindly take upstream's

Learned the hard way in the 1.1.0 merge. **Upstream being newer overall does not mean every
pin is newer.** Their `diffusers` rev was a strict *ancestor* of ours — 380 commits behind —
and predated `Krea2Pipeline`, so accepting it broke Krea 2 at import time.

For every conflicting pin in `backend/pyproject.toml`, check the ancestry before choosing:

```
https://api.github.com/repos/<owner>/<repo>/compare/<theirs>...<ours>
```
`status: ahead, behind_by: 0` means ours is strictly newer — keep ours. Only take theirs when
they're genuinely ahead, or when upstream code needs a version-specific API.

Pins we deliberately keep ahead of upstream (see the comments in `pyproject.toml`):
- **`diffusers`** — ours has `Krea2Pipeline`; upstream's does not.

### ⚠️ Tests cannot validate a merge — run the real app

Also learned in the 1.1.0 merge: 487 tests passed and the frontend typechecked while the app
**crashed on startup** (`Krea2Pipeline` import) and later blew up mid-generation
(`_hf_hook`). Neither path is covered by tests. Always work through section 5's manual
checklist before committing a merge, and prefer a **fresh app process per model** — chaining
several heavy pipelines in one session parks them all in RAM and produces misleading
slowness that looks like a regression.

---

## 3. What we changed, and what must survive

### A. Prompt Manager Pro (GPM) — the biggest addition
Ported prompt/camera/workflow manager mounted as a right-hand dock panel.

- **New:** `frontend/components/gpm/**`, `frontend/gpm-core/**`, `public/gpm-scene/**`,
  `electron/gpm-library-root.ts`
- **Modified:** `frontend/App.tsx` (dock mount), `electron/csp.ts`, `electron/config.ts`,
  `electron/main.ts`, `electron/preload.ts`, `shared/electron-api-schema.ts`
- **Must survive:** the CSP relaxations GPM needs; the library-root IPC; the dock mount point
  in `App.tsx`.
- **Note:** the panel is named **"Prompt Manager Pro"**. Its component/state names use
  `promptManagerPro*`. Don't let a merge revert it to "Studio Pro" — that name now collides
  with the app name.

### A2. SettingsDropdown — shared component carrying our fix
Upstream 1.1.0 extracted `SettingsDropdown` out of `GenSpace.tsx` into
`frontend/components/SettingsDropdown.tsx`, but **their version lacked our tag-popup
clipping fix**. We adopted their extraction and ported our fix into it, so the IC-LoRA panels
inherit it too.

- **Must survive:** the `createPortal` render into `document.body` (an `overflow-hidden`
  ancestor otherwise clips the popup invisible) and the viewport-aware
  `maxHeight: Math.max(120, rect.top - 16)` (the panel grows upward, so a long list can
  otherwise run off the top of the screen). Upstream's static `max-h-80` does **not** cover
  either case.
- **Test:** open a tag dropdown with 5+ tags — it must stay fully on screen and scroll.

### B. Krea 2 Turbo (second image model)
Self-hosted Krea 2 Turbo alongside Z-Image-Turbo, NF4-quantized with a disk cache.

- **New:** `backend/services/image_generation_pipeline/krea2_*`
- **Modified:** `backend/api_types.py` (`ModelCheckpointID`, `ImageGenerationModelCheckpointID`),
  `backend/runtime_config/model_download_specs.py`, `backend/handlers/image_generation_handler.py`,
  `backend/handlers/pipelines_handler.py`, `backend/pyproject.toml` (+`bitsandbytes`), `uv.lock`
- **Must survive:** the NF4 quantization **and its disk cache** (~3x speedup — expensive to
  regenerate), and the transformers-5.x compatibility fix. If image generation suddenly gets
  slow after a merge, the NF4 cache path is the first suspect.
- **Must survive:** our `diffusers` pin (see the dependency-pin warning in section 2) — it is
  the only rev that has `Krea2Pipeline`.
- **Must survive (both image pipelines):** `to()` installs accelerate hooks via
  `enable_model_cpu_offload()` **once per move-to-accelerator**. Calling it again while
  offload is already active leaves modules with accelerate's wrapped `forward` but no
  `_hf_hook`, which fails at inference (`'Qwen3Model' object has no attribute '_hf_hook'`) —
  and also causes needless CPU↔GPU shuttling. Don't "simplify" that guard away.

### B2. Free (don't park) image pipelines when loading video ⚠️ upstream divergence
`backend/handlers/pipelines_handler.py` — `_evict_gpu_pipeline_for_swap`.

Upstream parks an active image pipeline in host RAM (`park_image_generation_pipeline_on_cpu`
→ `CpuSlot`) so an image↔image switch stays warm. We changed it to **free** the image
pipeline (and drop any already-parked `cpu_slot`) instead, because every caller of that method
is loading a memory-hungry video/IC-LoRA/a2v pipeline, and a parked image model then thrashes
a 64 GB box: the video model's bf16-read + fp8-pin working set (~70 GB) plus a parked image
model exceeds RAM and spills to the pagefile. Measured: image→video went 5:04 (parked) →
3:42 (freed).

- **Must survive:** the free-not-park behavior. Guardrail:
  `tests/test_state_actions.py::test_image_pipeline_freed_not_parked_when_loading_video` — it
  fails if a merge silently restores upstream's parking (`cpu_slot` becomes a `CpuSlot`).
- `park_image_generation_pipeline_on_cpu` is now **unused** but intentionally left in place to
  keep the diff small and reduce merge friction; don't be surprised it has no callers.
- **This is a candidate to upstream** (it's a latent bug that hurts Z-Image too — Z-Image is
  bf16/unquantized, so parking it is *worse* than our NF4 Krea 2). If Lightricks takes a PR,
  drop this divergence. Root cause is that 64 GB RAM is below what upstream's design assumes;
  see the perf notes in section 6.

### B3. Diffusion stage cache — session-scoped streaming transformer
`backend/services/patches/diffusion_stage_cache.py` (monkey-patch on
`DiffusionStage._transformer_ctx`), plus eviction hooks in
`backend/handlers/generation_handler.py` (`evict_for_generation_start`) and
`backend/handlers/pipelines_handler.py` (unload/swap/image-load), gated from
`backend/ltx2_server.py` (`set_streaming_enabled`, streaming mode only).

Upstream rebuilds the transformer from the checkpoint on **every** DiffusionStage call
(43GB read + fp8 cast + pin, ~90-100s each on a 3090 — ~190s of a ~226s generation).
Two cached kinds: **resident** (32GB+ cards, generation-scoped — a VRAM-resident cache
surviving the generation double-books VRAM with the next gen's text-encoder/VAE builds,
measured ~42GB on a 32GB card) and **streaming** (24GB cards, ~23GB fp8 pinned host RAM,
**session-scoped** — survives across generations ComfyUI-style; warm generations skip the
model load entirely).

- **Must survive:** the `set_streaming_enabled` gate (IC-LoRA's `use_lora_in_stage_2`
  forces CPU-mode streaming even on 5090s — must NOT session-cache there); the
  builder-type + `cpu_slots_count` discriminants in the cache key; the eviction calls in
  `pipelines_handler` (video↔image swaps need the pinned RAM back); `teardown()` before
  the meta-swap when evicting a streaming entry.
- **Tests:** `tests/test_diffusion_stage_cache.py`.
- The patch reads DiffusionStage/StreamingModelBuilder privates — re-verify against
  `ltx_pipelines.utils.blocks` on every rev bump (the docstring lists the exact surface).

### B4. Aux-model session cache
`backend/services/patches/aux_block_cache.py` — Phase B companion to B3: caches the small
per-generation builds (VAE encoder — shared between ImageConditioner and VideoUpsampler —
spatial upsampler, video decoder, audio decoder, vocoder; ~3-4s/warm gen). Multi-slot,
VRAM-resident (~2-4GB), streaming-mode-gated, evicted at the same `pipelines_handler`
unload/swap/image-load sites (paired with `diffusion_stage_cache.evict()`), governed by the
same Settings toggle.

- **Must survive:** the streaming gate; the `SingleGPUModelBuilder` isinstance exclusion
  (multi-GPU custom decoder builders); the VideoDecoder cached iterator running WITHOUT
  `gpu_model` (its teardown would meta-swap the cached decoder) with checkout-at-first-next;
  the vocoder's effective-dtype key (fp32 on MPS); the paired eviction calls.
- **Tests:** `tests/test_aux_block_cache.py`. Patch reads `blocks.py` privates — re-verify
  each `__call__` body on rev bumps (the docstring lists the surface).

### B5. fp8 block-weight sidecar
`backend/services/patches/fp8_sidecar_cache.py` — persists the streaming transformer's
POST-downcast block weights to `<checkpoint stem>.fp8-blocks-cache.safetensors` beside the
checkpoint (~22GB; Krea-2 NF4 placement precedent). Cold session builds drop ~95s → ~40s
(23GB identity mmap read, zero cast compute); one-time synchronous write on the first-ever
build. Sits beneath both diffusion-stage-cache paths via a patched
`StreamingModelBuilder._build_pinned_source` + wrapping `StateDictLoader`.

- **Must survive:** the `__blocks` sd_ops-name intercept contract; the LoRA-free capture
  point (pre-fusion — LoRA changes never invalidate the sidecar); atomic writes (tmp +
  `os.replace`) with free-space preflight; stamp validation (original path/size/mtime/model-id
  + sd_ops chain + fp8 suffix list + exact key-set match) with delete-on-invalid.
- Stale sidecars for deleted checkpoints are acceptable user-deletable residue next to the
  models. Kill switch: `FP8_SIDECAR_CACHE=0`. **Tests:** `tests/test_fp8_sidecar_cache.py`.
- Patch reads `builder.py` privates (`_build_pinned_source` signature, `_model_loader`,
  `_filtered_sd_ops` naming) — re-verify on rev bumps.

### C. Qwen Multi-Angle
Camera-angle tool using Qwen-Image-Edit + GGUF + angle/Lightning LoRAs.

- **New:** `backend/services/qwen_multiangle_pipeline/**`, `backend/handlers/qwen_multiangle_handler.py`,
  `backend/_routes/qwen*`, `frontend/components/gpm/QwenMultiAnglePanel.tsx`
- **Modified:** `backend/api_types.py`, `backend/app_factory.py`, `backend/app_handler.py`,
  `backend/handlers/__init__.py`, `backend/pyproject.toml` (+`gguf`, `torchvision`)
- **Must survive:** the **SageAttention NaN workaround** (silent black/NaN output without it),
  and the state-lift fix that prevents losing state on panel enlarge/shrink.

### D. Video editor: export transitions & timeline
Color correction, fade-to-black/white, wipes, and dissolve now export correctly (matching
preview), plus timeline in/out persistence and playback fixes.

- **Modified:** `electron/export/export-handler.ts`, `electron/export/timeline.ts`,
  `electron/export/video-filter.ts`, `electron/export/ffmpeg-utils.ts`,
  `frontend/views/editor/**` (many)
- **Must survive:** the ffmpeg filter-graph construction for all four transition phases.
  Dissolve specifically needs the correct `xfade` type — a regression here is silent
  (exports look wrong rather than failing).

### E. Gen Space: tags/folders & asset safety
Tag/folder (bins) organization, plus fixes for real data-loss bugs.

- **Modified:** `frontend/views/GenSpace.tsx`, `frontend/contexts/ProjectContext.tsx`,
  `frontend/types/project-model.ts`
- **Must survive:** the **stale-autosave fix** — Gen Space and Video Editor stay mounted
  together, and a stale editor snapshot could clobber/resurrect assets (bins map, deleted
  assets, `binId`/`favorite` fields). This one caused real data loss; treat it as critical.

### F. 21:9 ultrawide video (local-only)
- **Modified:** `backend/api_types.py` (`aspectRatio` Literal includes `"21:9"`),
  `backend/handlers/video_generation_handler.py` (**two** maps: fast path + a2v path),
  `frontend/lib/video-generation-model-specs.ts` (`allowedAspectRatios`),
  `frontend/views/GenSpace.tsx`, `frontend/generated/backend-openapi.{ts,json}`
- **Must survive:** both `RESOLUTION_MAP_21_9` maps (540p/720p only; 1080p intentionally
  rejected), and the local-only gating (forced-API path must keep rejecting 21:9).
- **After merge:** regenerate OpenAPI (`pnpm openapi:generate`) if `api_types.py` changed.

### G. Save video / Save video frame (right-click menu)
- **New:** `frontend/lib/video-save-actions.ts`, `frontend/components/useVideoSaveMenu.tsx`
- **Modified:** `shared/electron-api-schema.ts` (`copyFileToPath`; `extractVideoFrame` gained
  `outputPath`), `electron/ipc/file-handlers.ts`, `electron/ipc/video-processing-handlers.ts`,
  `electron/export/ffmpeg-utils.ts` (`accurate` seek), `frontend/lib/file-url.ts`
  (`fileUrlToPath`), `frontend/views/GenSpace.tsx`, `frontend/components/gpm/media-preview.ts`
- **Must survive:** the `accurate` seek flag (frame-exactness depends on `-ss` *after* `-i`),
  and frame extraction happening in the **main process via ffmpeg** — a canvas grab would
  taint under production `webSecurity`.

### H. Render timer + cancel button
- **Modified:** `frontend/views/GenSpace.tsx`, `frontend/hooks/use-generation.ts`,
  `frontend/types/project-model.ts` (`renderMs`)
- **Must survive:** the `abortControllerRef.current?.signal.aborted` check in **both** the
  video and image paths. Without it, cancelling shows a false "Generation Failed" dialog,
  because the API client converts an aborted fetch into a synthetic error *result* rather
  than throwing `AbortError`.

### I. Color palette themes ⚠️ most merge-fragile
Six curated palettes, picker in Settings → Appearance, persisted in `localStorage`.

- **New:** `frontend/lib/theme.ts`
- **Modified:** `tailwind.config.js`, `frontend/index.css`, `frontend/main.tsx` (`initTheme()`),
  `frontend/components/SettingsModal.tsx` (Appearance tab)
- **Must survive:** the **Tailwind `zinc` scale redirect to CSS variables** in
  `tailwind.config.js`, and the matching `--zinc-50..950` defaults in `index.css`. The entire
  theming system depends on that indirection — if an upstream change reverts the zinc block,
  themes silently stop working (the app still renders, just always dark-default).
- These are shared config files upstream also edits. **Check this feature first after any merge.**

### J. Dev/runtime infrastructure
- **Modified:** `backend/handlers/base.py` (`LTX_MODELS_DIR` env override),
  `electron/app-paths.ts` (`APP_FOLDER_NAME`, `app.setName`), `frontend/App.tsx`
  (`requiredModelsGate`), `electron/python-backend.ts` (`LTX_HF_HOME` → `HF_HOME`),
  `scripts/launch-fork-dev.cmd` (new)
- **Must survive:**
  - **`LTX_MODELS_DIR` env override** — takes priority over persisted `models_dir`, because
    the settings.json round-trip proved unreliable. Also set in `launch-fork-dev.cmd`; the two
    must stay in sync.
  - **`LTX_HF_HOME` env override** — when set, `python-backend.ts` injects it as `HF_HOME`
    for the backend, redirecting the HuggingFace cache (Qwen Multi-Angle's ~17GB GGUF load
    obeys it) to a fast drive without touching the global env or other HF tools. App-scoped,
    portable (no-op when unset). `launch-fork-dev.cmd` sets it to `E:\hf-cache` because the
    user's global `HF_HOME` pointed at a SATA HDD (`D:\hf-cache`) that pinned at 99% and made
    cold Qwen loads take minutes.
  - **Startup gate fix** — don't block startup on missing local models when an LTX API key is
    present (otherwise a bogus ~25GB download prompt reappears).
  - **Dev userData isolation** — dev builds use a separate app folder so the fork doesn't
    collide with an installed LTX Desktop (shared single-instance lock).

### K. Branding
Partially rebranded; a full rebrand is still pending (see section 6).

- **Modified:** `index.html`, `package.json`, `frontend/App.tsx`, `frontend/views/Home.tsx`,
  `frontend/components/PythonSetup.tsx`, `frontend/components/SettingsModal.tsx`

### L. NOTICES.md
Third-party notices extended for our additions (Krea 2, the four Qwen artifacts,
`torchvision`/`bitsandbytes`/`gguf`, and several npm deps). **Re-check after every merge** —
upstream will edit this file too, and dropping our entries is a licensing problem, not just
a cosmetic one.

---

## 4. Hot-spot files (highest conflict probability)

These are files **both** we and upstream change regularly. They're mostly registration /
wiring points — unavoidable, since adding a feature means registering it.

```
backend/api_types.py                    backend/app_factory.py
backend/app_handler.py                  backend/handlers/__init__.py
backend/handlers/pipelines_handler.py   backend/handlers/video_generation_handler.py
backend/runtime_config/model_download_specs.py
backend/pyproject.toml + uv.lock        shared/electron-api-schema.ts
electron/preload.ts                     electron/ipc/file-handlers.ts
frontend/App.tsx                        frontend/views/GenSpace.tsx
frontend/components/SettingsModal.tsx   tailwind.config.js + frontend/index.css
frontend/generated/backend-openapi.{ts,json}
```

`backend/generated/*` and `uv.lock` are **generated** — don't hand-merge them. Take either
side, then regenerate:
```bash
pnpm openapi:generate     # regenerates backend-openapi.{json,ts}
cd backend && uv sync     # regenerates uv.lock
```

---

## 5. Post-merge verification checklist

Automated (must pass):
- [ ] `pnpm run typecheck:ts`
- [ ] `cd backend && uv run pytest -q`

Manual smoke test (each maps to a feature above):
- [ ] App launches; no first-run/model-download gate (J)
- [ ] Gen Space: generate a video; **timer** counts, **Stop** cancels cleanly with no error dialog (H)
- [ ] Aspect ratio dropdown offers **21:9**; generates at 540p/720p (F)
- [ ] Right-click a video → **Save video** / **Save video frame** both work (G)
- [ ] Settings → **Appearance**: palettes apply and persist across restart (I) ⚠️
- [ ] Prompt Manager Pro panel opens; library loads (A)
- [ ] Image mode: **Krea 2 Turbo** generates, and is fast (NF4 cache intact) (B)
- [ ] Qwen Multi-Angle generates without NaN/black output (C)
- [ ] Video editor: export a clip with a dissolve/wipe; transitions match preview (D)
- [ ] Gen Space tags/folders persist after switching to the editor and back (E)
- [ ] `NOTICES.md` still lists our models/deps (L)

---

## 6. Known outstanding work

- **Full rebrand** — the app is still named/branded around "LTX", and `electron-builder.yml`
  still carries `appId: com.lightricks.ltx-desktop` plus Lightricks' Azure code-signing block.
  Apache-2.0 grants no trademark rights, so this must change before any distribution. Note
  that renaming the userData folder will orphan projects (they live in `localStorage` inside
  it) — the folder must be renamed/migrated, not just repointed.
- ~~Upstream 1.1.0~~ — **merged** in `cd9395e`. Brings the LoRA / IC-LoRA catalog, video
  Extend, outpainting, a Models tab, generation recovery, and heartbeat instrumentation.
  Largely unexercised so far: the **LoRA catalog** and **Extend** got a code review but only
  a light smoke test.
- **New checkpoint requirement:** 1.1.0 repoints *both* model variants at
  `ltx-2.3-spatial-upscaler-x2-1.1`, so that ~950MB file is required even when staying on
  the 1.0 transformer. The Models tab offers a whole-bundle download but skips files already
  on disk, so it only fetches what's missing.
- **Ingredients IC-LoRA** is CLOSED — needs 32GB+ VRAM and the full (non-distilled) 22B
  model. Not viable on a 3090; don't reopen without new hardware.
- **Possible perf win (untested):** on a 24GB card the runtime policy selects
  `streaming_models_loading`, and the heartbeats show it streaming weights off disk while
  ~20GB of VRAM sits free (peak usage only ~4.6GB). That band was presumably tuned for the
  full model, not our fp8-cast distilled one. Forcing `full_models_loading` might cut render
  times substantially. Pre-existing behaviour, not a merge issue — worth an A/B using the new
  heartbeat instrumentation.

---

## 7. Licensing reminders when merging

- App code is **Apache 2.0** — retain copyright/attribution notices, and mark modified files.
- Model licenses are separate: **LTX-2 Community License** (commercial use permitted below
  $10M annual revenue) and **Krea 2 Community License** (requires deployer-side content
  filtering). Keep `NOTICES.md` accurate.
