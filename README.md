# Ragdoll Box

A browser physics sandbox in the spirit of Hyperbox, Gorebox and Endorphin Vice. Grab, shoot, punch, launch and blow up wobbly active-ragdoll dummies, and throw them off a tower or into a spinning blade and a wrecking ball.

Built with **Three.js** (rendering) and **Rapier** (physics: joints, contact forces, character controller) on **Vite**. It needs no downloads or plugins and runs in any modern browser.

## Setup

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/h4986966-boop/user.git ragdoll-box
cd ragdoll-box
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173), click **Click to play**, and the mouse is captured. Press **Esc** to release it.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` (static files you can host on GitHub Pages, Netlify, itch.io and similar) |
| `npm run preview` | Serve the production build locally |
| `npm run sim` | Headless physics check: dummies stand, chase, recover from a shove, and take sensible fall damage |

## Controls

| Input | Action |
| --- | --- |
| WASD / Shift / Space | Move / sprint / jump |
| 1–6 or mouse wheel | Switch tool |
| Q | Slow motion |
| F | Dummy AI: chase → stand → limp |
| C | Spawn a wave of 4 dummies around you |
| G | Gore on/off (blood and dismemberment) |
| R | Reset the arena |

| Tool | Left click | Right click |
| --- | --- | --- |
| 1 Physgun | Hold to grab (wheel changes distance) | Throw what you're holding |
| 2 Revolver | Single shot (headshots ×2.5) | Shotgun blast |
| 3 Fists | Haymaker | Force push cone |
| 4 Launcher | Rocket | Bouncing grenade |
| 5 Spawner | Spawn dummy | Spawn crate |
| 6 Barrels | Spawn explosive barrel | Delete object |

## How it works

- `src/ragdoll.js`: 11-body ragdoll (ball joints for neck, spine, shoulders and hips; limited hinges for elbows and knees). Live dummies are puppeted by PD torques toward a pose, plus mass-distributed gravity cancellation and a walk force, so they stagger toward you and get back up after being knocked down. Damage comes from bullets, explosions and impact forces; limbs detach when their HP runs out.
- `src/game.js`: fixed 60 Hz physics loop, slow motion, contact-force and collision events, explosions, props and projectiles.
- `src/tools.js`: the six tools. `src/player.js`: first-person kinematic character controller.
- `src/effects.js`: instanced blood, sparks and smoke, with blood decals that stick to the world.
- `src/arena.js`: the map.

Tuning knobs worth knowing: `IMPACT_THRESHOLD` and the part `hp` values in `src/ragdoll.js` (fall damage and dismemberment), and the PD gains in `Ragdoll.step` (how stiff dummies are).
