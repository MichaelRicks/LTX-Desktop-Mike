---
name: rix-editor
description: Assemble, cut and export videos in the RiX Desktop Studio Pro Video Editor from the user's generated assets, via the rix-editor MCP server. Use when the user asks to cut, edit, assemble or make a trailer/teaser/promo/montage/music video/reel from their RiX assets, library folders or generations, or to fix/re-cut an existing RiX timeline.
---

# RiX Editor

You are the editor. The rix-editor MCP tools give you hands (timeline edits), eyes
(frames), ears (beat analysis) and a render button. This skill is the craft.

## Before anything
1. `rix_status`. Confirm the open project is the one the user meant, by name. Keep its
   `editor.project.id`: every edit, undo and redo needs it as `project_id`, and RiX refuses
   the call if the user has switched projects since. If that happens, stop and ask the user
   before doing anything else. If the editor isn't loaded, ask the user to open the project
   and click the Video Editor tab once. If the tools aren't there at all, the MCP server isn't connected —
   see "Setup" at the bottom.
2. Pin down the brief in one line: length, aspect (16:9 / 9:16), mood, music track, where it
   will be posted, **soundtrack mode** and **length mode** (see "Brief options" below). Only
   ask if something important is truly unknown — otherwise pick sensible defaults and state them.

## Brief options
The user picks these in plain words; map what they say to a mode and restate it in the brief line.

**Aspect** (default: 16:9)
- 16:9 is the user's usual format. Use it unless they ask for vertical, portrait, 9:16, Reels,
  Shorts or TikTok. Don't ask which one; just state "16:9" in the brief line.
- **9:16 from 16:9 footage is normal.** Most of the user's shots are 16:9. For a vertical brief,
  build with the 16:9 shots and pan & scan each one through a 9:16 window. See "9:16 pan & scan"
  below. Don't reject 16:9 shots for a vertical brief.

**Soundtrack mode** (default: music only)
- **Music only.** Every picture clip gets `with_audio:false`. Music is the whole soundtrack.
- **Dialogue + ducked music** ("keep the dialogue", "include the clip audio", "dip the music
  under the talking"). Clips keep their own audio, and the music dips only while someone speaks.
- **Dialogue + low music bed** ("lower the music the whole way", "music quiet underneath").
  Clips keep their own audio, and the music sits low for the entire piece.

**Transitions** (default: straight cuts)
The brief says "Transitions: …" (the Direct with Claude panel always sends one). Apply the
chosen type to EVERY clip-to-clip join, not just a few. A fade from black at the start and a
fade to black at the end are fine with any choice.
- **Straight cuts.** Hard cuts; see the craft notes below.
- **Dip to black.** Set `out: fade-to-black` on the left clip and `in: fade-to-black` on the
  right clip, 0.3–0.4s each (0.6–0.8s of darkness in total; longer for a slow, moody piece).
  - This doesn't overlap the clips, so beat-synced cut times stay exactly where they are, and
    the black lands on the beat.
- **Cross dissolve.** Set `out: dissolve` on the left clip and `in: dissolve` on the right,
  with the same duration d (0.5s default, 0.3s for a fast cut, 0.8s for a dreamy one).
  - Each dissolve overlaps the two clips, so the program gets d shorter per join. To keep
    cuts on the beat, lengthen every outgoing clip by d: its source must have d more usable
    footage past the planned out-point. Then each dissolve starts on its beat.
  - `render_frames` reports the rendered duration. Trim or extend the music to match it.
  - In a dialogue mode, keep each line out of the overlap region.

**Length mode** (default: fixed length)
- **Fixed length.** Hit the requested duration and use only the best moments; some clips are left out.
- **Use all clips** ("use every clip", "all of them, whatever length it ends up"). Every usable
  clip appears once. The running time is whatever that adds up to. Don't pad it, and don't trim
  it to a round number.

## Workflow (do not skip steps)
1. **Survey.** `list_library` (folders) → `list_library {folder}` and/or `list_project_assets {query}`.
   Prompts and filenames tell you what a clip *should* be.
2. **Look.** `inspect_media` on every candidate you might use (3–4 frames is enough for a 5–8s gen).
   Generated video often morphs, warps hands/faces, drifts scale, or goes static in the last
   second. Note the usable in/out range per clip, and reject bad takes. Never cut blind.
3. **Listen.** If there's music, `analyze_audio` it. Note the bpm, beatInterval, where loudness
   jumps (the drop), and strongOnsets (hits worth landing a cut or title on). In a dialogue
   mode, also note each clip's `soundSegments` from `inspect_media`: these are the lines you
   must not chop.
4. **Shot list.** Before editing, write a short plan: the beat-by-beat structure (hook → build →
   peak → button/title), which clip and which in/out range goes where, and the timing. Show it
   to the user if the piece is longer than ~30s or the brief was loose.
5. **Build.** For a fresh cut use `{"op":"new_timeline","name":"…"}` so the user's existing
   timelines stay untouched. Then do the whole rough cut in ONE `apply_edits` batch
   (one undo step). In music-only mode: music first on A1, picture on V1, titles last. In a
   dialogue mode: picture on V1 with dialogue on A1, then any sound effects on A2, then music
   on the last audio track, and titles last (see "Dialogue modes").
   **Watch-it-build mode:** if the user wants to watch it happen live, build in small
   batches instead: one clip (or one layer) per `apply_edits`, with a one-line note before each
   ("Step 3: …"). This also works as a timelapse of the edit in the RiX Video Editor tab.
6. **Review.** `render_frames`, especially at every cut point ±0.2s, on titles, and on the last
   frame. Check for black gaps, flash frames, morphing, and repeated-looking shots side by side.
   Fix things with small follow-up batches.
7. **Export** with `export_video` only after the review looks right, or when the user asks.
   Report the output path.

## Editing craft
- **Hook in the first 1–2s.** Open on the strongest image, not an establishing shot.
- **Cut on the beat.** Cuts land on beats (`beats[]`); big changes land on downbeats or
  strongOnsets. Clip durations are multiples of `beatInterval` (1, 2 or 4 beats). Speed up
  toward the peak (4 → 2 → 1 beat shots) and let it breathe after.
- **Use the best 1–3 seconds** of a gen, not the whole thing. Gens are usually strongest in
  the middle; the first frames can be stiff and the last second often degrades. Set `in` past
  the stiff start.
- **Vary shots.** Don't put two near-identical framings (same seed family, same angle) back to
  back; alternate wide and close, still and motion.
- **Transitions are seasoning.** Default to hard cuts. Use dissolves for time passing or a
  dreamy mood (left clip `out` + right clip `in`, 0.3–0.8s). Use `fade-to-black` to open, to
  close, or before a title card. Avoid wipes unless they're asked for.
- **No dissolves in a beat-synced cut unless the brief asks for them.** A dissolve overlaps
  its two clips, so every picture cut after it moves earlier by the dissolve length and lands
  off the beat. `fade-to-black` on the first or last clip is safe. When the brief does ask for
  cross dissolves, compensate as described under "Transitions".
- **Music sections.** In `analyze_audio`, `loudnessPerSecond` shows the song's structure:
  look for a dip (a breakdown) followed by a jump (a drop). Choose the music in-point so the
  window contains build → drop → natural ending, and start it on a beat time. Then timeline
  time = beat − in-point, and every cut should sit on one of those times. Put the hardest
  image on the drop.
- **Audio.** Music at volume 0.8–1.0, with a 1–2s `audio_fade_out` on the last music clip.
  Gen clips carry their own (often junk) audio, so use `with_audio:false` on picture when
  music is the soundtrack, unless the clip has dialogue or lip sync you want.

## Revise mode (change an existing timeline)
Used when the brief says "Revise an existing timeline" (the Direct with Claude panel's
"Revise a timeline" mode) or the user asks to change something on a cut that already exists.
The job is surgical: change ONLY what the brief names. Every clip, in/out point, start time,
track, audio level, fade, duck and title stays exactly as it is.
1. `rix_status`: confirm the project, and find the timeline by the id given in the brief.
2. Pick the timeline to edit:
   - **On a copy** (the default): the first op is `{"op":"duplicate_timeline","timeline":"<id>","name":"…"}`.
     The copy becomes active, and the user's original is never touched.
   - **In place** (only when the brief says so): the first op is
     `{"op":"switch_timeline","timeline":"<id>"}`.
3. `get_timeline`, then list the **joins**: pairs of picture clips on the same video track
   where the left clip's end equals the right clip's start. The first clip's `transitionIn`
   and the last clip's `transitionOut` are the opening and closing fades; leave them alone
   unless the brief names them.
4. Change the joins in ONE batch (one undo step), with no other ops. For transitions:
   - **Dip to black:** `transition` with `out: fade-to-black 0.35` on the left clip and
     `in: fade-to-black 0.35` on the right clip. Nothing moves, so dialogue, ducking and
     beat sync stay intact.
   - **Straight cuts:** `{"type":"none"}` on both sides of each join.
   - **Cross dissolve:** each dissolve overlaps the two clips and shifts every later picture
     cut earlier by d. In a cut with dialogue or music sync, that pulls the picture away
     from its sound. Tell the user this before changing anything, and ask whether to go
     ahead. Don't lengthen clips to compensate, because the brief said keep everything else.
5. Review with `render_frames`: frames at each join (−0.3s, at the join, +0.3s), and the
   first and last frames. Then `get_timeline` and compare it with step 3: clip starts,
   durations, in-points, volumes and duck keyframes must be unchanged. Report that you checked.
6. Export if the brief asks (reuse the original's export dimensions, e.g. an explicit
   1920×1080 when the first clip isn't 16:9), then report the path and the copy's name.

## Dialogue modes
- **Track layout (the standard convention; follow it).** Top to bottom:
  - **A1: dialogue.** The clips' own sync audio.
  - **A2: sound effects,** if there are any.
  - **Last audio track: music.** That's A2 when there are no sound effects, A3 when there are.

  Dialogue, effects and music never share a track, so none of them can overwrite another.
  Silent or junk-audio clips still get `with_audio:false`.
- **Building in that order.** `track` and `audio_track` take timeline track *indices*, not A
  numbers, and a new timeline starts with only V1 = 0 and A1 = 1.
  - Lay the picture down first, routing each talking clip with `with_audio:true, audio_track:1`
    (A1).
  - Put sound effects on the next audio track, then the music on the audio track after those.
  - Call `get_timeline` to confirm which index is which A track before and after placing the
    music.
  - RiX doesn't create tracks on demand: placing a clip on a missing index fails with
    "cannot place a audio on track N". Add each extra track explicitly first with
    `{"op":"add_track","kind":"audio"}` (it returns the new index), one op per track.
- **Is it actually speech?** `soundSegments` means sound, not necessarily speech. Gen audio is
  often ambience, hiss or gibberish. Judge from the prompt and the frames (does a mouth move?).
  Keep audio only where there's a real line or lip sync, and say which clips you muted and why.
- **Never cut a line.** A clip's `in` and `out` sit on segment boundaries, with 0.1–0.2s of air
  either side. Dialogue sets the length of those shots. Keep the other cuts on the beat, but
  when the beat and a line conflict, the line wins.
- **Clean edges.** Dialogue clips get volume 1.2–1.5 and `audio_fade_in`/`audio_fade_out` of
  0.05–0.1s, so there are no clicks at the cuts.
- **Ducked music.** Leave the music at 0.8–1.0 and add one `duck` op on the music clip.
  - Build the ranges in TIMELINE seconds: for each speech segment [s0, s1] of a clip,
    the range is [clip.start + (s0 − in), clip.start + (s1 − in)], clipped to the clip's
    start and end.
  - Merge ranges less than ~0.6s apart so the music doesn't pump.
  - Use `level` 0.2–0.3, `attack` 0.2, `release` 0.4.
- **Low music bed.** No duck. Set the music `volume` to 0.3–0.4 for the whole piece, or use
  `volume_keyframes` to bring it back up to ~0.9 on a closing stretch with no dialogue (for
  example over the title).
- **Review honestly.** `render_frames` shows pictures, not sound. After building, read
  `get_timeline` to confirm that the duck ranges line up with the dialogue clips and that no
  line is clipped. Tell the user you checked the mix by the numbers, not by listening, and ask
  them to give it a listen before or after export.

## "Use all clips" mode
- **Include every usable clip once,** using its best 2–4 beats (longer for a clip with a line
  of dialogue). Still reject broken takes (heavy morphing, a mismatched aspect ratio), but
  list every clip you left out and why. Near-duplicate takes count as separate clips. Space
  them apart instead of dropping them.
- **Order for an arc,** not by filename: strongest image first, build, the peak on the drop,
  and the best closer last.
- **Length comes from the clips.** Round each shot to whole beats; the total is the running
  time. Pick the music in-point so that window ends on a natural ending in the song. If that's
  impossible, end on a downbeat with a 1.5–2s fade. If the total is longer than the song's
  remaining length, say so, and offer to loop or add a second track.
- **Report the final length** in the shot list, so the user knows it isn't 30s before you build.
- **Titles.** Keep them short: 1–5 words, 2–3s, fade 0.3–0.5s. Put them over dark or empty
  areas (check frames). positionY ~50 (centre) or ~82 (lower third). `fontSize` is authored
  against a 1080-px-TALL frame and scales with export height, so width is the limit, and it's
  tightest in portrait. Maximum fontSize for one line of bold caps: ≈ 700 ÷ characters for
  9:16, ≈ 2200 ÷ characters for 16:9 (cap 140). For "HALLOWEEN" (9 chars) that's ~78 in 9:16.
  For a longer title, stack it as separate text clips, one line each (for example 8
  positionY points apart at fontSize 88); staggering them onto successive beats also gives
  a free title animation. Always confirm with `render_frames` that nothing is clipped at the
  edges.
- **Ending.** Finish on a button (the strongest image or a title) and fade to black. Never
  just stop.
- **Stills** (images) work as 1–2s punctuation or behind titles. A 5s still is dead air.
- **One aspect ratio per cut.** Without `vertical`, the frame size follows the FIRST visual
  clip on the timeline, and a 16:9 clip in a 9:16 cut (or the reverse) is letterboxed into a
  thin strip that looks like an error. For a **9:16 deliverable**, use the pan & scan workflow
  instead: render and export with `vertical:true`, and every clip is cropped through its own
  9:16 window, so 16:9 and 9:16 sources mix cleanly. For a **16:9 deliverable**, pick 16:9
  sources, open on one, and tell the user about any mismatched shots you had to leave out.
  - **When the story needs a wider-than-16:9 clip first** (for example a 2.37:1 shot), keep
    the order. The `render_frames` preview will come out in that wider shape, which is
    expected. Export with explicit `width:1920, height:1080`, then check frames from the
    exported file: the wide clip should be letterboxed, 16:9 clips should fill the frame, and
    nothing should be stretched.

## 9:16 pan & scan (reframe)
Use this for a vertical deliverable (9:16, Reels, Shorts, TikTok) cut from 16:9 or wider shots. The
timeline stays in its normal shape. Each picture clip gets a 9:16 **window** (`reframe`), and a
vertical render crops every clip through its own window. Keyframes move the window over time,
which gives a pan that follows action or reveals something.

**Workflow**
1. Build the cut as usual: shot choice, beats, audio. Aspect doesn't change which shots you
   choose, except that the subject must fit inside a 9:16 slice (see "Reject" below).
2. For each picture clip, decide on a static window, a follow, or a reveal pan, and set it with
   `update_clip` → `"reframe"`. You can put these in the same batch as the build.
3. Review with `render_frames {"vertical":true}`. A render without `vertical` shows the full
   16:9 frame, not what the viewer gets. Check that no heads or faces are cut, that moves feel
   motivated, and that titles are inside the frame.
4. Export with `export_video {"vertical":true}` (1080×1920 by default).

**Geometry (so you can set `pos` from frames instead of guessing)**
- `pos` slides the window along the source's free axis: 0 = left edge, 0.5 = centred (the
  default), 1 = right edge. For sources taller than 9:16 the axis is vertical (0 = top). A native
  9:16 clip has no free axis, so `pos` does nothing and needs no reframe.
- For a W×H source the window covers a fraction f = (H × 9/16) ÷ W of the width. For **16:9,
  f = 0.316**; for 2.37:1, f = 0.237; for 1:1, f = 0.5625.
- To centre a subject whose middle is at horizontal fraction **c** of the frame (0 = left edge,
  1 = right edge, read off the `inspect_media` frame): **pos = (c − f/2) ÷ (1 − f)**, clamped to
  0–1. For 16:9: **pos = (c − 0.158) ÷ 0.684**. For example, a face at c = 0.70 gives pos = 0.79.
- **Close the loop; don't trust a first estimate.** Reading c off small frames is only good to
  about ±0.05, which is enough to push a face to the edge of a 0.32-wide window. After
  `render_frames {"vertical":true}`, read where the subject actually sits in the 9:16 frame
  (w, 0 = left edge, 1 = right edge), back-solve its true position **c = pos·(1 − f) + w·f**,
  and set pos = (c − f/2) ÷ (1 − f) again. For a follow, do this for every key time. One
  correction pass is usually enough; stop when the subject sits between about 0.35 and 0.65
  of the frame.
- Frame the subject's **eyes or the action**, not the geometric middle of the body. If
  the subject faces or moves toward one side, leave space on that side: shift c about 0.03–0.05
  that way before converting.

**Choosing the motion**
- **Static** (`{"pos":0.79}`): most shots. The subject stays roughly in one place, so hold the
  window still. Read c from two or three frames across the used range and take the middle.
- **Follow** (keys): the subject crosses the frame. Put a key roughly every 1s of the used range
  at the subject's position (`inspect_media` with `times` gives frames exactly there). The window
  eases between keys (smoothstep) and holds after the last key. Don't key every frame; you'll
  get jitter.
- **Reveal pan** (keys): a motivated move from one subject to another, or across a landscape.
  Use 2 keys, 1.5–3s apart, e.g. `[{"t":0.2,"pos":0.1},{"t":2.4,"pos":0.9}]`. Start and end the
  move on beats.
- **Stills:** a slow pan across a 16:9 still (a full traverse over 2–4s) makes a still feel
  alive in a vertical cut. It's the vertical equivalent of a Ken Burns move.
- **Avoid:** crossing the whole width in under ~0.8s (it reads as a whip pan, so only do it
  on purpose, on a hit), zig-zag keys, moving the window on a shot shorter than ~1s, and two
  adjacent shots panning in opposite directions (it jars at the cut).
- **Reject letterboxed sources.** Some "16:9" files have black bars baked in (the picture is
  really ~2.4:1 inside a 16:9 file). The window takes the full height, so the bars become
  black bands at the top and bottom of the vertical frame. Check the `inspect_media` frames
  for bars before using a shot.
- **Reject** a 16:9 shot for a vertical cut when its key action is wider than the window, e.g.
  two people talking at opposite edges, and a pan between them would lose the moment. Say which
  shots you dropped for this reason.

**Key times and gotchas**
- Key `t` = **seconds from the clip's start on the timeline** (0 … clip duration). RiX converts
  them to source time for video clips, so the keys stay glued to the footage. `get_timeline`
  reports them in the same clip-local time. Keys outside the clip are rejected.
- If you later change a clip's `in` or `speed`, its keys stay on the same footage moments, so
  re-check that shot.
- **Reversed clips** ignore keys and use a static window, the first key's `pos`.
- `"reframe": null` clears a clip back to centred.
- **Titles in a vertical export** are laid out through each shot's window, in 16:9-frame
  coordinates. A title can therefore fall outside a shifted window, or slide out during a pan.
  Under a title: hold the window still (no keys during the title), and set the title's
  `positionX` to the window's centre, **positionX = 100 × (f/2 + pos × (1 − f))**, which is
  15.8 + 68.4 × pos for 16:9. Size the title by the 9:16 rule under "Titles". Confirm with
  `render_frames {"vertical":true}` on every title.

```json
{"op":"update_clip","clip":"$s1","set":{"reframe":{"pos":0.79}}}
{"op":"update_clip","clip":"$s2","set":{"reframe":{"pos":0.2,"keys":[{"t":0.3,"pos":0.1},{"t":2.4,"pos":0.85}]}}}
```

## apply_edits patterns
Assets can be referenced by project asset id, by `$ref` from an earlier op in the same batch,
or directly by absolute library path (auto-imported, deduped).

```json
{"ops":[
  {"op":"new_timeline","name":"Storm Trailer v1"},
  {"op":"add_clip","asset":"D:\\...\\Music\\track.mp3","track":1,"start":0,"ref":"music"},
  {"op":"add_clip","asset":"D:\\...\\Storm\\storm-03.mp4","track":0,"start":0,"in":1.2,"duration":1.875,"with_audio":false,"ref":"s1"},
  {"op":"add_clip","asset":"D:\\...\\Storm\\storm-07.mp4","track":0,"in":0.8,"duration":1.875,"with_audio":false},
  {"op":"add_text","text":"THE STORM","start":13.1,"duration":2.5,"style":{"fontSize":110},"fade_in":0.4,"fade_out":0.4},
  {"op":"update_clip","clip":"$music","set":{"audio_fade_out":1.5}},
  {"op":"transition","clip":"$s1","in":{"type":"fade-to-black","duration":0.6}}
]}
```
- Track indices come from `get_timeline().tracks`: a new timeline has V1 = 0 and A1 = 1.
  Omitting `start` appends to the end of that track, which is the easiest way to lay down a
  sequence.
- Placing a clip over an existing one overwrites that range, the same as an overwrite edit.
  Text clips placed without a `track` go onto their own title track automatically. Never put
  a title on the picture track.
- A dissolve overlaps its two clips, so the rendered program is shorter than the timeline's
  nominal duration by the dissolve length. `render_frames` times are in rendered-program time.
- If a batch fails, nothing was applied. Read the error (it names the op index), fix it and
  resend the whole batch.
- `undo` reverts only YOUR last batch, and only if nothing has changed since. It refuses
  otherwise, so it can never touch the user's work. When it refuses, fix things with a
  corrective batch; never ask for a way around it.
- Near-identical framings back to back (the same character at the same size) read as a jump
  cut. Alternate subjects or shot sizes, and check the cut points in `render_frames`.
- **Stills can crash `export_video`.** FFmpeg exits with code 3221225477 (an access
  violation), even though `render_frames` works. The fix is to turn each still into a 5s
  1080p video clip with a system ffmpeg that has libx264 (Krita's doesn't; iClone's does).
  Use `-loop 1 -t 5 -r 24`, with `-vf "scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2,format=yuv420p"`
  and `-an`, save the clip in the project folder, and swap it in with `with_audio:false`.
  Re-check the frames from the exported file afterwards.

## Honesty rules
- Only claim something works or looks good after you've seen it in `render_frames` or
  `inspect_media` frames. Say what you checked.
- Report defects you notice in the source gens (morphing, bad hands, scale jumps), even when
  you've worked around them. The user may want to regenerate those shots.
- v1 cannot generate new shots. If the material doesn't support the brief, say what's
  missing (e.g. "no close-ups of the character; I'd generate 2–3") instead of padding with
  weak clips.

## Setup (for the user, only if the tools are missing or refuse to connect)
The rix-editor tools come from RiX itself, so RiX must be running. If the tools are missing,
or every call fails with a connection or "invalid bearer token" error, tell the user:
1. Open RiX Desktop Studio Pro and a project.
2. Click **Direct with Claude** (top right) → **Connect Claude**. That registers RiX with
   Claude Code and installs this skill. It needs doing once per RiX install, and again if
   that dialog says the connection is out of date.
3. Start a **new** Claude session (or use "Open in Claude"); a session that was already open
   won't see newly registered tools.

Don't ask the user for tokens or to run terminal commands; Connect Claude handles it.
