# Anime Fight Engine

A browser prototype of a **3D anime fight-scene production engine**: original rigged characters, a data-driven
choreography system, a director's camera, a VFX system, procedural sound + music, a multi-track timeline editor and one
continuous scene (about **4:30 of scene time / 5:00 of presentation time** including slow motion) that plays from the
first silent frame to the final impact.

Everything on screen is generated at start-up from code. **No videos, no images, no audio files, no third-party
libraries** are used at runtime. The only dev dependency is TypeScript.

> **ملخص سريع بالعربية** — التشغيل: `npm install` ثم `npm run dev` وافتح `http://localhost:5173`. اضغط ▶ (أو Space).
> كل شيء في المشهد مُولَّد برمجيًا: الشخصيتان (Sael وKorran) ثلاثية الأبعاد بهيكل عظمي وIK/FK ووجه قابل للتحكم،
> والقتال مكتوب كبيانات على Timeline قابل للتعديل (نقل/قص/نسخ/حذف)، والكاميرا والمؤثرات والصوت والموسيقى كلها مرتبطة بنفس الـTimeline.
> الحدود التقنية مذكورة بوضوح في قسم **Status / limits** أدناه.

---

## 1. Requirements

* Node.js 18+ and npm (only used to compile TypeScript and serve files).
* A desktop browser with **WebGL2** and Web Audio (recent Chrome, Edge, Firefox or Safari). A discrete/modern GPU is recommended.
  Chrome/Edge additionally enable the PNG-folder frame export (File System Access API).

## 2. Install

```bash
npm install
```

(There is a single dev dependency: `typescript`. `package-lock.json` is created by that command on your machine.)

## 3. Run (localhost)

```bash
npm run dev
```

This compiles `src/**/*.ts` to `public/js/`, keeps recompiling on change, and serves `public/` at
**http://localhost:5173** (set `PORT=xxxx` to change it). Press **▶** or **Space**.
Browsers only start audio after a click, so the first Play click also unlocks sound.

Useful URL parameters: `?msaa=0` (disable MSAA), `?shadow=1024`, `?scale=0.6` (render resolution scale).

## 4. Build

```bash
npm run build      # type-checks + compiles + copies the static site to dist/
npm start          # serves dist/ on http://localhost:5173
```

`npm run typecheck` runs the compiler without emitting. `npm run export:scene` / `npm run export:models` write the generated
timeline as JSON and the two character meshes as OBJ into `assets/`.

## 5. What is in the box

```
Anime-Fight-Engine/
├── public/            index.html, styles.css  (compiled JS goes to public/js, git-ignored)
├── src/
│   ├── engine/        WebGL2 wrapper, renderer (shadow pass, HDR scene, MSAA), post-FX (bloom, impact frames, speed lines, distortion), GLSL, mesh builder
│   ├── environment/   polar terrain + crater/crack damage, instanced rocks & pillars (LOD, shatter, topple), sky/clouds
│   ├── characters/    skeleton (41 bones), rig solver (IK/FK, fingers, eyes, jaw), procedural body meshes, face decals, hair/cloth spring chains, specs
│   ├── animation/     Pose model, action library (keyframe recipes), state machine (fatigue / rage / power), per-fighter evaluator
│   ├── camera/        shot system (wide … whip pan), impact-driven shake
│   ├── vfx/           clip-driven VFX runtime, pooled GPU particles, debris, rings, beams, lightning, trails, afterimages, screen effects
│   ├── audio/         synthesis kit (layered impacts, formant cries, drums, instruments), procedural score, director/scheduler, lip-sync, offline render
│   ├── timeline/      clip model + undo/redo, clip-type registry, time warp, the choreography generator (fight.ts)
│   ├── scene/         Engine (integration), lighting states
│   ├── scenes/        scene registry (Duel, Rig Lab)
│   ├── ui/            app shell, timeline editor, inspector (+ rig/pose lab), left panels
│   ├── export/        WebM recording, PNG snapshot / frame sequence, WAV, OBJ, save/load
│   └── utils/         math, easing, deterministic noise / RNG
├── scripts/           dev server, build, export scripts (no dependencies)
├── tools/             visual-test.mjs (end-to-end smoke test), shot.mjs (screenshots)
└── assets/            exported scene JSON + character OBJ files
```

### Core idea: the scene is a pure function of time

`Engine.renderFrame(t)` evaluates *everything* (fighters, camera, VFX, lighting, environment damage) from scene time `t`.
Particles, debris, craters, cracks and camera shake are closed-form / seeded, so scrubbing, playing, recording and offline
frame export produce identical pictures. Slow motion is a *Time Warp* track that maps scene time → presentation time; audio
events are scheduled through the same map, so sound stays locked to the picture.

## 6. Using the editor

| Area | What it does |
|------|--------------|
| **Top bar** | Play / Pause / Stop, timecode, Director or Free-orbit camera, loop, subtitle language (EN/AR), volume, **Save** / **Load** (JSON), **Render** menu |
| **Left panel** | *Scene Graph* (tree with the 41-bone skeletons), *Scenes*, *Characters*, *Environment*, *Assets* |
| **Viewport** | 16:9 output with phase label, live stats and subtitles. Free camera: drag = orbit, wheel = zoom, right-drag = pan |
| **Timeline** | 11 tracks: Character A, Character B, Camera, VFX, Environment, Dialogue, Voice, Sound Effects, Music, Lighting, Time Warp |
| **Inspector** | Clip parameters, character state machine readout, **rig controls**, camera / lighting / audio / environment live data |

Timeline: click the ruler to scrub · drag a clip to **move** · drag its edges to **trim** · Shift-click multi-select ·
`Ctrl+D` **duplicate** · `Del` **delete** · `S` split at playhead · `Ctrl+Z / Ctrl+Y` undo/redo · `Ctrl+wheel` zoom ·
the **+** on each track header adds a clip at the playhead · edit start / duration numerically in the Inspector.

Keyboard: `Space` play/pause · `←/→` one frame · `Shift+←/→` one second · `Home/End`.

### Render menu (all real)

* **Record video (WebM)** – real-time capture of the canvas plus the synthesised audio (MediaRecorder).
* **Snapshot (PNG)** – current frame.
* **Frame sequence (PNG folder)** – deterministic offline rendering at 30 fps / 1920×1080 through the time warp (Chrome/Edge). The dialog text prints the
  `ffmpeg` line to assemble the frames with the WAV.
* **Audio (WAV)** – offline render (`OfflineAudioContext`) of all SFX and music.
* **Character models (OBJ)** – bind-pose meshes with vertex colours.

## 7. How to edit the characters

* **Look and proportions:** `src/characters/specs.ts` – colours, height/shoulder/hip/limb/head scale, eye shape, brows, hair clumps
  (position, direction, length, width, stiffness) and cloth strips (bone, anchor, length, widths, colours) for **Sael (A)** and **Korran (B)**.
  The shape of the type is in `src/characters/spec.ts`.
* **Body meshes:** `src/characters/meshgen.ts` builds the skinned body from lofted tubes (legs, torso, arms, neck, head, hands, fingers,
  garments). Add a garment by adding another `tube(...)` call bound to bones.
* **Skeleton / rig:** `src/characters/rig.ts` – bone list and bind pose, two-bone IK for arms and legs, FK overrides, finger curl/spread, eyes, jaw.
* **Face:** `src/characters/face.ts` builds eyes, lids, brows, nose and mouth every frame from `FaceParams` (`src/animation/pose.ts`), which also holds the expression presets.
* **Try it live:** *Scene Graph → Character → Manual pose override* lets you pose IK/FK limbs, spine, head, eyes, fingers and the facial rig by hand
  (or load the **Rig Lab** scene). Timeline animation resumes when you release the override.

## 8. How to edit the timeline / choreography

* **In the UI:** edit clips directly (see above). Each character clip is `stance`, `move`, `strike`, `defend`, `react`, `air`, `charge`, `blast` or `emote`;
  a strike has *preparation → action → contact → reaction → recovery* built into its recipe (`src/animation/actions.ts`) and scales with `power`.
* **Save / Load:** JSON (`*.afe.json`). `assets/scenes/duel-at-shattered-ridge.afe.json` is the generated main scene.
* **In code:** `src/timeline/fight.ts` generates the whole fight. Helpers: `ex()` (one attack + the defender's answer + all sound, VFX, camera
  cut-in and slow-mo it needs), `combo()`, `reset()`, `shot()`, `light()`. Defence and follow-ups are chosen from the **state machine**
  (`src/animation/fsm.ts`): fatigue slows and hunches a fighter, rage strengthens attacks (Korran's eyes turn red), the *power* state switches
  Sael to micro-dodges, blink counters and minimal movement, and altitude switches to air animations.
* **Add a new action:** add a recipe (`Key[]` list of pose deltas) in `actions.ts`, register it in the tables at the bottom, add the kind to
  the `select` in `timeline/clipTypes.ts`.

## 9. How to add VFX

Every effect is a clip on the **VFX** track with the same controls: **start, duration, intensity, scale, position, rotation (°), opacity**,
colours, seed and an optional attach (fighter bone). Types: aura, sparks, dust, smoke, fire, lightning, shockwave, trail, beam, groundCrack,
crater, debris, explosion, flash, heatDistort, burst, energyBall, speedLines, impactFrame, afterimage and the composite `groundHit`.

To create a **new type**: (1) add its name to the VFX list in `src/timeline/clipTypes.ts`; (2) in `src/vfx/vfx.ts` emit particles in `activate()`
(pooled, GPU-evaluated) and/or draw ribbons/sprites in `frameEffects()` (rebuilt each frame from time).

## 10. How to add audio

All sound is synthesised in `src/audio/synth.ts` (`SynthKit`). To add a sound: write a method that schedules oscillators / filtered noise at an
absolute time, map a new clip type to it in `AudioDirector.build()` (`src/audio/director.ts`) and declare the clip in `clipTypes.ts`.
Music is a pure function in `src/audio/music.ts` (`notesInWindow`) driven by **Music section** clips (mood, tempo, intensity) and **Music stop / duck** clips.
To use recorded audio instead, decode a file with `decodeAudioData` inside a new `SynthKit` method and start it at `at` – the scheduling is unchanged.
Voice: **Dialogue** clips give subtitles, expression and lip-sync; **Voice** clips speak the text with the browser's speech engine (best effort) or
play synthesised battle cries.

## 11. How to add scenes / develop further

* **New scene:** add an entry to `src/scenes/registry.ts` returning a `TimelineData` (see `rigLab()`), or build one in the editor and Save it, then
  use *Scenes → Import JSON*. Environment (terrain, rocks, sky) is shared; damage and lighting come from the timeline.
* **Longer scenes (10–15 min):** nothing is capped – timeline length is data; the time-warp table, audio scheduling (2-second look-ahead) and VFX pools are
  windowed, and clip evaluation is per-frame O(active clips). Add more phases to the generator or author them in the editor.
* **Server-side video:** `Engine.renderFrame(t)` is deterministic and headless-friendly; run the app in headless Chromium, step `t` through
  `engine.warp.contentOf(frame / fps)` and write PNGs (that is what the frame-sequence export does), mux with the offline WAV using ffmpeg.
* **Ideas:** foot locking / ground contact, rigid-body debris, texture-based faces, mocap retargeting into `Pose`, GPU skinned cloth, MP4 via WebCodecs.

## 12. Performance design

* One HDR MSAA scene pass + shadow map + 3-level bloom; render resolution scale, MSAA, shadow size and particle budget are adjustable in the Inspector.
* **Object pooling:** particles and debris live in fixed-capacity GPU instance pools with a block allocator; emitters allocate once and the vertex
  shader evaluates motion in closed form (no per-frame uploads).
* **Instancing + LOD:** rocks/pillars are instanced with two mesh levels chosen per instance by distance each frame.
* **Lazy creation:** the audio graph is created on first Play; offline audio, recorders and OBJ export run on demand.
* Measured in the automated test: **≈3–8 ms of CPU per frame** for animation + VFX + camera on a shared build machine (GPU cost not measured).

## 13. Status / limits (what is real and what is a prototype)

**Implemented and working**
* Two original 3D characters (Sael, Korran): 41-bone skeleton, smooth-blended skinned meshes, IK/FK limbs, spine/head/neck controls, eyes, jaw,
  fingers (thumb, index, middle, ring+little share bones), a facial rig (brows, lids, squint, pupil, mouth open/wide/smile/teeth, gaze), simulated hair clumps and cloth.
* Toon rendering with outlines, banded lighting, rim light, coloured shadows, real cast shadows, bloom, chromatic aberration, heat distortion,
  radial/whip blur, **impact frames**, **speed lines**, afterimages, energy trails.
* State machine driving both animation modulation and action selection; procedural choreography with distinct effect strength per hit.
* Environment: terrain with cliffs, 196 rocks/pillars, craters that deform the mesh over time, growing ground cracks, shattering boulders, toppling pillars, debris.
* Camera system with wide/medium/close/extreme close-up/low/high/over-shoulder/tracking/orbit/dolly/zoom/fast pan/whip pan and impact-scaled shake.
* Fully synthesised sound (layered impacts, whooshes, explosions, rock breaks, charge/release, breathing, footsteps, cloth, formant battle cries) and a procedural score
  with 7 mood sections plus silences.
* Timeline editor with move/trim/duplicate/delete/split/undo/redo/zoom/snap, inspector, scene graph, rig lab, save/load, WebM/PNG/WAV/OBJ export.

**Prototype / placeholder / known limits**
* Characters are procedural low-poly toon meshes (≈4.7k triangles each), not sculpted art; faces are geometry decals, not textures.
  No foot locking, no cloth-body collision, no inter-character collision – occasional interpenetration and floaty feet are expected.
* Animation is hand-tuned procedural keyframing + IK, not motion capture. Contact positions are exact for hits, but poses were tuned by eye and a few
  transitions are stiffer than professional animation.
* Music and sound effects are synthesised placeholders (usable, not studio quality). Voice lines use the browser speech engine: quality, language and
  availability (especially Arabic) depend on the operating system, and **speech is not part of the WebM recording or the WAV export** (Web Speech cannot be captured).
* WebM recording and the PNG-folder export use standard browser APIs but could **not be exercised end-to-end in the build sandbox** (headless software rendering has no video encoder
  and no directory picker). The deterministic frame path (`renderFrame`) and the offline WAV render were tested.
* No `package-lock.json` is shipped: the build sandbox could not reach the npm registry, so `npm install` was not run there. The project was compiled and tested with a
  globally installed TypeScript 6.0.3 and Chromium (SwiftShader). `typescript: ">=5.6.0"` is the only dependency.
* Debris uses closed-form ballistics with one bounce (no rigid-body collisions); hair/cloth are spring chains and restart from rest after a seek.
* Performance was verified only with software rendering plus CPU timing; on a real GPU it should be comfortable, but lower the resolution scale or particle budget on weak machines.

## 14. Testing

```bash
npm i -D playwright && npx playwright install chromium   # optional, only for the smoke test
npm run test:visual
```

The test opens the real app in headless Chromium and checks: scene length ≥ 3 min, no NaN in any pose over the whole scene, 16 key frames render
(screenshots go to `tools/out/`), the clock advances, audio schedules events, timeline add/duplicate/move/delete/undo, offline audio renders sound,
manual rig override drives IK, per-frame CPU cost, and that the console stays free of errors.

## 15. Phases in the main scene

| Time | Phase | What happens |
|------|-------|--------------|
| 0:00 | 1 Silence | wide establishing shot, wind, eye and foot close-ups, breathing, first words |
| 0:27 | 2 Testing | short exchanges, dodges, blocks, first clean touch |
| 1:00 | 3 Close combat | punches, kicks, elbows, knees, grab and throw |
| 1:36 | 4 Environment damage | ground cracks, craters, boulders shatter, a pillar collapses |
| 2:08 | 5 High speed | afterimages, trails, speed lines, fast cuts with wide shots for readability |
| 2:38 | 6 Aerial | flight, mid-air dodges, energy attacks, a crushing dive kick |
| 3:10 | 7 Power awakening | silence, then nine ordered layers of transformation; Sael's movement language changes |
| 3:35 | Power state | Sael answers with micro-dodges and blink counters, Korran at full rage |
| 4:02 | Finale | charge → silence → close-ups → energy build-up → final attack → massive impact → silence → final shot |

All characters, designs, dialogue, music and effects are original. Well-known anime were used only as a general reference for pacing and camera language.
