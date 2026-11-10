# Cartoon Recap Channel: Remotion Editor Rules

You are the dedicated EDITOR for this project. Follow these rules exactly when
generating or editing anything in `src/`.

## 1. Canvas and CRT Framing

- Canvas: **1920x1080**, **30 fps**, dark background (`#0b0b0d`).
- The entire video plays **inside a vintage CRT TV**, centered on the canvas.
- Two-layer rendering in `src/Composition.tsx`:
  - **Layer 1 (Media):** clips and stills scaled with `objectFit: cover`,
    centered, and masked (`overflow: hidden` + rounded corners) to the TV
    screen rectangle. The Badge renders inside this layer.
  - **Layer 2 (Overlay):** `public/images/tv-frame.png` drawn on top of Layer 1.
- `tv-frame.png` MUST have a transparent screen cutout (alpha), or it will hide
  the footage. Expected native layout: 1500x1000. Screen rectangle inside it
  (tunable in `SCREEN`): left 110, top 140, 960x720 (4:3).
- If your PNG differs, edit only `TV_W`, `TV_H` and `SCREEN` at the top of
  `Composition.tsx`.

## 2. Source Policy

- Real archival clips and photos ONLY.
- Zero AI-generated images. Zero AI-generated clips.
- No white background cards, no solid title cards. Text only appears over
  active footage.

## 3. Asset Folders (relative to project root)

| Purpose                 | Path                         |
| ----------------------- | ---------------------------- |
| Video clips             | `public/clips/`              |
| Still images            | `public/images/`             |
| CRT TV frame overlay    | `public/images/tv-frame.png` |
| Voiceover               | `public/audio/voiceover.mp3` |
| Sound effects           | `public/audio/sfx/`          |

Always reference files with `staticFile()`. Shots store the **file name only**;
the folder is chosen from the file type (video -> `clips/`, image -> `images/`).

Asset specs:
- Clips: `.mp4` / `.webm` / `.mov`. Prefer 480p-1080p archival. At least 3s long.
- Stills: `.jpg` / `.png` / `.webp`.
- Voiceover: `.mp3` / `.wav`, one continuous narration file.

## 4. Pacing: The 3-Second Rule

| Block kind | Shot length               | Frames  |
| ---------- | ------------------------- | ------- |
| INTRO      | 2.0-3.0s (default 3.0s)   | 60-90   |
| SEG        | 2.0-3.0s (default 2.5s)   | 60-90   |
| BEAT       | 3.0-6.0s                  | 90-180  |

- No visual shot may exceed 3.0s (90 frames) unless it is inside a BEAT block.
- The engine clamps out-of-range shot durations and logs a warning.
- Long sentences are broken into ordered sub-cuts: `1.1`, `1.2`, `1.3`, each a
  distinct 2-3s clip or still. Never reuse the same source back to back.

## 5. Structure and Block Types

Blocks play in script order, with no gaps and no overlaps.

- **INTRO**: a montage of dialogue-only famous moments, about 3s per shot.
  **No voiceover.** Clip audio is **unmuted**.
  - **The intro length is NOT fixed.** It can be 15s, 20s, 28s or any other
    length. It is calculated dynamically as the sum of the INTRO shots in the
    content sheet. Never pad or trim the intro to hit a target length.
  - If the sheet has no INTRO block, the video starts directly on SEG 1 and the
    voiceover starts at frame 0.
- **SEG**: narrated segment. Voiceover plays; clip audio is **muted**. Each SEG
  carries the verbatim script line in `text` and 1+ sub-cut shots.
- **BEAT**: 3-6s unmuted dialogue or theme-tune moment between segments.
  **Voiceover stops completely.** Clip audio is **unmuted**.

Intro-to-voiceover handoff:
- `introEnd` = the frame where the **last INTRO block finishes**.
- The voiceover starts **immediately on that frame** (voiceover frame 0 plays at
  `introEnd`). There is no gap, no delay and no overlap.
- INTRO blocks must be the first blocks in the sheet. The engine warns if an
  INTRO block appears after other blocks, or if SEG 1 does not start exactly at
  `introEnd`.

Coverage rules:
- Map the script verbatim to sequential blocks (INTRO, SEG, BEAT). Do not
  paraphrase `text`.
- A shot with `file: null`, or a file that is missing from disk, is an **empty
  space**: a black CRT screen for its full duration. **It never shifts later
  blocks.** No badge is drawn on empty shots.
- In Remotion Studio, empty shots show a small "MISSING SOURCE" label. It is
  never rendered into the final video.

## 6. Lower-Third Badge (src/Badge.tsx): SELECTIVE ONLY

- **Do NOT put text on every cut or transitional line.** Most shots have no
  text. The default is a clean screen.
- Add a `badge` to a shot ONLY when the content sheet specifies key info:
  Show Title, Year, Network, or Character Name.
- If the badge text is empty, whitespace, or the `badge` field is missing, the
  engine renders **nothing**: no blank card, no gradient, no placeholder.
- Position: bottom edge of the CRT screen, centered, inside the Layer 1 mask.
- Styling: bold white retro cartoon font (Luckiest Guy), black outline and hard
  shadow. Minimal. Short key info only, max ~28 characters per line.
- Line 1 (`title`): SHOW NAME or CHARACTER NAME.
  Line 2 (`subtitle`): `YEAR - NETWORK`. Either line may be omitted.
- Only over active footage, never on empty space.
- Pops in about 6 frames after the cut and fades out over the last 6 frames.

## 7. Audio Pipeline

- **Voiceover** carries the narrative. It is one file that starts at `introEnd`
  and advances only during SEG frames. BEAT frames do not consume it. Block *n*
  plays from the point where block *n-1* stopped.
- **Clip audio:** muted in SEG; unmuted (volume 1) in INTRO and BEAT.
- **SFX:** `Shot.sfx = { file, atFrame? }` from `public/audio/sfx/`, played at
  **-13 dB** (linear volume = 10^(-13/20) = **0.2239**).
- **Total duration** = intro frames (dynamic) + BEAT frames +
  max(scripted SEG frames, voiceover frames). If the voiceover is longer than
  the scripted SEG shots, empty auto-generated SEG shots (60-90 frames each)
  fill the rest.

### Preview fallback (CRITICAL)

`calculateMetadata` first checks that `public/audio/voiceover.mp3` exists
(HEAD request), then measures it. If the file is missing, unreadable, or has an
invalid duration, it falls back to a **10-second (300-frame) silent
placeholder** for the SEG runway. The preview server never throws a 404, and
no `<Audio>` is mounted for the missing file.

## 8. Script Schema

```ts
type Shot = {
  id: string;            // "1.1", "1.2", "BEAT-A"
  file: string | null;   // file name only, null = empty space
  seconds?: number;      // optional, clamped to the block range
  startFromSec?: number; // trim into a clip
  badge?: { title?: string; subtitle?: string }; // omit for a clean screen
  sfx?: { file: string; atFrame?: number };
};
type Block = {
  kind: "INTRO" | "SEG" | "BEAT";
  id: string;            // "INTRO", "SEG 1", "BEAT 1"
  text?: string;         // verbatim script line (reference only)
  shots: Shot[];
};
```

## 9. Workflow

1. Put archival media in `public/clips/` and `public/images/`.
2. Put `tv-frame.png` in `public/images/` and `voiceover.mp3` in `public/audio/`.
3. Edit `SCRIPT` in `src/Composition.tsx` (verbatim text, shots, SFX).
   Add a `badge` only where the sheet lists key info.
4. Preview with `npm run dev`. Check the console for the `[CartoonRecap]`
   summary (intro length, voiceover start frame) and any warnings.
5. Render with `npx remotion render src/index.ts CartoonRecap out/recap.mp4`.

## 10. Code Rules

- TypeScript and functional React only. Use only `remotion` APIs for motion.
- All timing is driven by `useCurrentFrame()`. No CSS transitions or animations.
- All tunable constants (`FPS`, `RANGES`, `SCREEN`, `SFX_VOLUME`) live at the top
  of `Composition.tsx`.
- Never hardcode `durationInFrames` in `Root.tsx`. It is overwritten by
  `calculateMetadata`.
- Never hardcode an intro length anywhere. Always derive it from the INTRO
  blocks.

## 11. Pre-Render Checklist

- [ ] No shot over 90 frames outside BEAT blocks.
- [ ] INTRO blocks come first. Intro length is whatever the sheet defines.
- [ ] Voiceover starts exactly where the last INTRO block ends.
- [ ] BEATs are 90-180 frames, with voiceover stopped.
- [ ] Every sub-cut uses a distinct real archival source.
- [ ] Badges exist ONLY where the sheet gives key info (title, year, network,
      character). All other cuts are clean.
- [ ] SFX at -13 dB. Clip audio muted outside INTRO and BEAT.
- [ ] `tv-frame.png` screen area is transparent and aligned with `SCREEN`.