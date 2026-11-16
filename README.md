# EMBERLINE

[![make.fun bounty](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/raraanzaii/threejs-fps-01-entry/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/raraanzaii/threejs-fps-01-entry/reward.svg)](https://make.fun/bounty/threejs-fps-02)

An original round-based tactical FPS in three.js for make.fun's
[threejs-fps-02](https://make.fun/bounty/threejs-fps-02) bounty, "Make the
best three.js tactical FPS". You are an Ember raider in **Duskport Harbor**
at dusk: plant the charge at Crane Yard or the Fuel Depot — or wipe the
other team out — against bots that patrol, hold angles, and shoot back.

## How it plays

- **4v4 rounds, 100 seconds:** you plus three Ember bots against four Ash
  bots. A round ends on elimination, detonation, defusal, or time.
- **Bomb objective:** carry the charge, hold E to plant (4 s), 35 s fuse
  with quickening beeps, hold E to defuse (5 s). If you fall, a teammate
  picks the charge up.
- **Money between rounds:** kills pay $300, a round win $3,250, a loss
  $1,900. Press B in the buy phase for the VK-7 Repeater, Talon SMG, frag
  and smoke grenades, and Kevlar.
- **Gunplay where accuracy counts:** headshots deal ~3x body damage,
  recoil and spread punish firing on the move or in the air, crouching and
  standing still (or aiming down sights) tighten your shots. WASD moves,
  Space jumps, Ctrl crouches, R reloads, G throws a grenade.
- **Bots with a plan:** waypoint routes, held angles, patrols, reactions to
  line of sight and gunfire, a bomb carrier that pushes a site, defenders
  that defuse. Smoke blinds them.
- **Look:** an original dusk-harbor map with lanes, crates, and sightlines;
  procedural WebAudio gunfire, reloads, bomb beeps, and explosions. No
  network requests, no build step — static files under `game/`.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

Build the dossier the judge reads:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Deterministic screenshots: `?shot=start|play|end&seed=1`.

Bounty: https://make.fun/bounty/threejs-fps-02

## License

MIT — see [LICENSE](LICENSE).
