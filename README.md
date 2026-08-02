# North Star Hop

North Star Hop is Btown Games' northern-sky take on the public-domain six-point star-board hop game. Two to four players race 10 glowing marbles from one point of the star into the opposite point.

It is a plain static site: no dependencies, package manager, framework, build step, account, analytics, or ads. Open `index.html` from a local web server or deploy the repository directly to GitHub Pages.

## Play

- Tap one of the current player's marbles to reveal every legal landing.
- Move one space to an empty neighbor, or hop an adjacent marble of any color into the empty space beyond.
- One turn may chain any number of hops. The engine computes every reachable endpoint and the UI shows them all at once.
- The first player to put all 10 marbles in the opposite point wins. In 3–4 player games, play ends at that first winner rather than continuing to place the remaining players.

Modes include 2–4 player pass-and-play, two 2-player bots (Polaris and the stronger Navigator), and online rooms for 2–4 phones. Online hosts can share a crew link; opening a valid `?join=CODE` link opens and prefills the join panel.

## Architecture

- `js/engine.js` — pure rules over one JSON-serializable state object.
- `js/bot.js` — bot choices made only through engine exports.
- `js/main.js` — rendering, input, local mode flow, and room wiring.
- `js/rooms.js` — untouched vendored Btown rooms client.
- `scripts/rooms-shim.mjs` — untouched local backend stand-in.

## Verify

```sh
node scripts/test-engine.mjs
node scripts/test-rooms.mjs
node --check js/engine.js
node --check js/bot.js
node --check js/main.js
node scripts/make-icon.mjs # only when regenerating the PNG app icon
```

Serve locally with any static server, for example `python3 -m http.server 8000`, then open `http://localhost:8000`.
