# Fork Maintenance Guide

This fork of [Lightricks/LTX-Desktop](https://github.com/Lightricks/LTX-Desktop) carries
substantial custom work. This document exists so that **merging a new upstream release is a
checklist, not an archaeology expedition.**

When you hit a merge conflict, find the file in the map below to learn which feature owns it
and what must survive.

Last updated: 2026-07-21 · Fork base: upstream `827b9d8` (LTX Desktop 1.0.5)

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

### B. Krea 2 Turbo (second image model)
Self-hosted Krea 2 Turbo alongside Z-Image-Turbo, NF4-quantized with a disk cache.

- **New:** `backend/services/image_generation_pipeline/krea2_*`
- **Modified:** `backend/api_types.py` (`ModelCheckpointID`, `ImageGenerationModelCheckpointID`),
  `backend/runtime_config/model_download_specs.py`, `backend/handlers/image_generation_handler.py`,
  `backend/handlers/pipelines_handler.py`, `backend/pyproject.toml` (+`bitsandbytes`), `uv.lock`
- **Must survive:** the NF4 quantization **and its disk cache** (~3x speedup — expensive to
  regenerate), and the transformers-5.x compatibility fix. If image generation suddenly gets
  slow after a merge, the NF4 cache path is the first suspect.

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
  (`requiredModelsGate`), `scripts/launch-fork-dev.cmd` (new)
- **Must survive:**
  - **`LTX_MODELS_DIR` env override** — takes priority over persisted `models_dir`, because
    the settings.json round-trip proved unreliable. Also set in `launch-fork-dev.cmd`; the two
    must stay in sync.
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
- **Upstream 1.1.0** adds a first-class **LoRA / IC-LoRA catalog** (`lora_catalog_handler.py`,
  `_routes/lora_catalog.py`) supporting catalog downloads *and* manually-placed LoRAs under
  `models/loras/<id>/`. Worth merging for; it supersedes hand-rolled IC-LoRA work.
- **Ingredients IC-LoRA** is parked on a VRAM ceiling, not an integration bug — see the
  project notes. `ltx-core` is pinned at 1.1.1 here; upstream 1.1.0 pins 1.1.7.

---

## 7. Licensing reminders when merging

- App code is **Apache 2.0** — retain copyright/attribution notices, and mark modified files.
- Model licenses are separate: **LTX-2 Community License** (commercial use permitted below
  $10M annual revenue) and **Krea 2 Community License** (requires deployer-side content
  filtering). Keep `NOTICES.md` accurate.
