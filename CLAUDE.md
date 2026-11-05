# Project context (Dango Tower)

Read this first. Changes go with an ADR in `docs/decisions/` (same rule
as Dango Drop / Dango Swap).

> This project reuses the workflow, coding rules and security rules
> established in Dango Drop. Same tech stack and process — **only the
> game itself (falling-block puzzle -> dango tower stacking) differs**.
> Portrait layout (540x960), dango character images, fonts and the DG
> economy are shared with Dango Drop.

---

## Overview

- **True purpose**: a family project (DREAM CRYSTAL) — experience the
  full flow of plan -> build -> publish -> improve together. The game is
  learning material and a shared experience, not just a product.
- **Name**: **Dango Tower** (adopted 2026-11-06; the 4th DreCry game)
- **Form**: smartphone **web game** (works in a desktop browser too) ·
  worldwide release (all UI text in English)
- **Orientation**: **portrait phone (540x960, Scale.FIT + AUTO_CENTER)**
- **Genre**: timing-based stacking game (dango physics, one-tap drops)
- **Core loop**: a dango swings above the plate -> tap to drop -> land
  on the tower to stack -> perfect center drops earn bonus DG and build
  a combo -> 3 misses end the game -> "Today's Dango Tower" reports
  the sales (DG)

### Economy (DG)

- **SCORE = total DG earned = shop sales. No separate coins.**
- One landed dango: `price x 3 + height bonus (+1 per 5 stacked) +
  Perfect bonus (5 DG x combo)`. Golden is always perfect.
- Prices (same menu as Dango Drop): Shiratama 1 / Anko 2 / Sakura 3 /
  Mitarashi 4 / Yomogi 5 / Matcha 10 / Golden 100 DG.
- Drop rates: Golden 1/100, Matcha 1/25, five regulars split evenly.
- Matcha slows the sway for the next 3 drops ("Matcha Time").
- Best DG / height / stacked persist in localStorage.
- **Most important rule: economy and feel settings live outside the
  code** — prices and DG rules in `src/config/dango-economy.json`,
  sway/fall/landing numbers in `src/config/game-balance.json`. No
  hard-coding. Balance tweaks are JSON edits.

### Screens

Boot -> Preload -> Title -> Game -> Result ("Today's Dango Tower").
Title -> How to Play / Meet the Dango -> Title. Rules and introductions
are separate screens, never overlays on the game — the game screen
stays full-screen on the phone.

### Characters

Seven friends, real art from Dango Drop (`public/assets/dango/`):
Shiratama, Anko, Sakura, Mitarashi, Yomogi, Matcha ("The Shy One"),
Golden (rare). Matcha is a character, not one of the five everyday
flavors — same lore as the other games.

### Tech

TypeScript (strict) + Vite 6 + Phaser 3.80.1 + Vitest. Fonts: Mochiy
Pop One (headings) / Zen Maru Gothic (body). Sound: WebAudio synth
(no audio files). Deploy: Cloudflare Workers Static Assets via
Wrangler; GitHub Actions checks every push/PR, deploys only when
`CLOUDFLARE_DEPLOY_ENABLED=true` (same as Dango Drop).

### Build steps

- `npm run dev` / `npm run build` run `scripts/decode-assets.mjs`
  first (npm predev/prebuild): the character PNGs are stored as
  `*.png.b64` text files under `assets-src/` because the GitHub
  connector used for the first upload cannot push binary files. See
  README.md. The game code only reads the decoded `.png` files under
  `public/`.
- `npm run build`: prepare-dist (clean dist) -> `tsc --noEmit` ->
  `vite build` -> verify-build (checks the public range, HTML
  references, writes `build-info.json`).
- `npm test`: Vitest. Pure rules live in `src/logic/` (no Phaser, no
  DOM) so they are testable in Node. Keep it that way: scenes render,
  logic decides.

### Don'ts

- No Japanese in the UI. No secrets in git (`.env` files, tokens).
- Don't change dango-drop or dango-swap repos from here.
- Don't invent character art — use the Drive images (see README.md).
