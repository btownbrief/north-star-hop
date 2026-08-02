# North Star Hop — agent instructions

Shared guidance for any AI agent working in this repository. Stephen is non-technical, so explain consequential changes and verification in plain language.

## What this is

North Star Hop is Btown's northern-sky star-board marble race for 2–4 players. It is a plain static site: `index.html`, `style.css`, and ES modules in `js/`. There is no build step, package manager, framework, backend owned by this repo, account system, analytics, or ads. GitHub Pages deploys it through `.github/workflows/deploy.yml`.

Never call the game by the traditional trademark-associated name in player-facing UI. It is always **North Star Hop**.

## The non-negotiable boundary

Every game rule belongs in `js/engine.js` as a pure function over one plain JSON-serializable state object. The engine imports nothing and never uses the DOM, timers, `Date`, or `Math.random`. `applyMove` returns a new state. Online rooms synchronize this exact object, so moving rule logic into `main.js` or `bot.js` breaks multiplayer.

`js/bot.js` may use only the engine's public exports. `js/main.js` is UI and room coordination only.

## Online play

`js/rooms.js` and `scripts/rooms-shim.mjs` are vendored fleet files whose canonical copies live in `four-in-a-rowboat`. Never edit them here. Seat index is engine player index; host is seat 0 and opens. Online play supports 2–4 seats, renders all public information, pushes only engine-produced states, repaints remote states, and supports rematches.

The lobby invite button shares `location.origin + location.pathname + '?join=CODE'`, using the mobile share sheet and clipboard fallback. A valid join parameter opens the join panel prefilled and is immediately scrubbed from browser history.

## Before finishing

Run and report:

```sh
node scripts/test-engine.mjs
node scripts/test-rooms.mjs
node --check js/engine.js
node --check js/bot.js
node --check js/main.js
```

If the UI changed, also inspect or play it at a 390px-wide phone viewport. Keep both bot levels under 300ms and preserve all required online element IDs.

