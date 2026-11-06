# Dango Tower

**Stack it. Balance it. Sell it.**

A cozy dango stacking game from DREAM CRYSTAL. A dango swings above the
plate — tap to drop it, stack the seven dango friends as high as you can,
and sell every dango you stack. Three misses and the game is over.

- Play: https://drecry.com/dango-tower/ (once deployed — see below)
- Sister games: [Dango Drop](https://drecry.com/dango-drop/) ·
  [Dango Swap](https://drecry.com/dango-swap/)

## How to play

1. **Tap to drop** — a dango swings above the plate. Tap anywhere (or
   press Space) to drop it.
2. **Stack them up** — land on the tower to stack. A perfect center drop
   earns bonus DG and builds a combo.
3. **Three misses and it is over** — a dango that falls off the tower is
   a miss.
4. **Every dango is sold** — each dango you stack is sold at the shop.
   DG is your score.

The taller the tower, the faster the sway. The camera rises as the tower
grows. Matcha slows the sway for the next few drops. Golden always lands
perfectly.

## How DG is earned

Money earned **is** the score (same as Dango Drop — no separate coins).

```
DG for one landed dango
  = menu price x 3                  (sold as a shop item)
  + height bonus                    (+1 DG every 5 dango stacked)
  + Perfect bonus                   (5 DG x perfect combo, perfect only)
```

| Dango     | Price |
|-----------|------:|
| Shiratama |  1 DG |
| Anko      |  2 DG |
| Sakura    |  3 DG |
| Mitarashi |  4 DG |
| Yomogi    |  5 DG |
| Matcha    | 10 DG |
| Golden    | 100 DG |

Drop rates: Golden 1 in 100, Matcha 1 in 25, the rest split evenly
between the five everyday friends. Best DG, best height and best stack
are saved on the device (localStorage).

All numbers live in `src/config/dango-economy.json` and
`src/config/game-balance.json` — balance tweaks are JSON edits, never
code changes.

## Screens

- **Title** — Play, How to Play, Meet the Dango, best results, sound.
- **How to Play** — rules and the DG formula (its own screen, so the
  game itself can use the whole phone screen).
- **Meet the Dango** — the seven friends, their prices and personalities.
- **Game** — full-screen play area, slim HUD only (DG, height, misses,
  sound, pause).
- **Result ("Today's Dango Tower")** — DG earned, dango stacked, height,
  best results, NEW RECORD badge.

All user-facing text is English (worldwide release). Portrait phone
game (540x960), works in a desktop browser too.

## Run locally

```sh
npm ci
npm run dev      # http://localhost:5173/
npm test         # Vitest unit tests for the rules engine
npm run build    # typecheck + build + verify the public output
npm run preview  # serve the production build
```

Design shortcuts: `?scene=howto`, `?scene=meet`, `?scene=game`,
`?scene=result` open a scene directly.

## Deploy

See `docs/deployment.md`. In short: `npm run deploy` (test + build +
`wrangler deploy`). GitHub Actions checks every push/PR to `main` and
deploys only when the `CLOUDFLARE_DEPLOY_ENABLED` variable is `true`
and the Cloudflare credentials are registered — same setup as Dango Drop.

## Tech

TypeScript + Vite + Phaser 3, same stack as Dango Drop and Dango Swap.
Fonts: Mochiy Pop One (headings) / Zen Maru Gothic (body). Sound is
synthesized with WebAudio — no audio files.

## Character images

The seven dango use the real character art from Dango Drop
(`public/assets/dango/*.png`, same files as Dango Drop and Dango Swap).

> **Why are the images stored as `.png.b64`?**
> The GitHub connector used for the first upload cannot push binary
> files, so the exact image bytes are stored as base64 text under
> `assets-src/` (`assets-src/assets/dango/*.png.b64`,
> `assets-src/ogp.png.b64` — larger images are split into numbered
> `.png.b64.part-NN` chunks because the connector also caps a single
> upload) and decoded back into real PNGs under `public/` by
> `scripts/decode-assets.mjs`, which runs automatically before
> `npm run dev` and `npm run build`. The decoded PNGs are git-ignored
> build artifacts. A future direct `git push` can replace each
> `.png.b64` (and its parts) with the real `.png` file under `public/`
> and delete the decode script — the game code only ever reads the
> `.png` files.

## Confirmed decisions (2026-11-06)

- Deployment target: publish at `drecry.com/dango-tower/` and enable the
  Cloudflare deploy the same way as Dango Drop.
- Title-screen designer credit: ELLY, as in Dango Drop.
- DG formula: the current formula (3x price + bonuses) is right for a
  stacking game.
