import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Ragdoll } from '../src/ragdoll.js';
import { FIXED_DT } from '../src/constants.js';

await RAPIER.init();

function makeGame(mode) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  const info = new Map();
  const game = {
    world, info,
    scene: new THREE.Scene(),
    settings: { gore: true, aiMode: mode },
    stats: { kills: 0 },
    player: { position: new THREE.Vector3(0, 0, 10) },
    effects: { blood() {}, spurt() {} },
    hud: { toast(t) { game.toasts.push(t); } },
    toasts: [],
    addCollider(desc, body, i) { const c = world.createCollider(desc, body); info.set(c.handle, i); return c; },
    track() {},
    removeBody(b) { world.removeRigidBody(b); },
  };
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
  game.addCollider(RAPIER.ColliderDesc.cuboid(50, 1, 50), ground, { kind: 'world' });
  return game;
}

function run(game, r, seconds, events) {
  const q = new RAPIER.EventQueue(true);
  let maxDmg = 0;
  for (let i = 0; i < seconds * 60; i++) {
    r.step(FIXED_DT);
    game.world.step(q);
    q.drainContactForceEvents((e) => {
      for (const h of [e.collider1(), e.collider2()]) {
        const inf = game.info.get(h);
        if (inf?.kind !== 'part') continue;
        const over = e.totalForceMagnitude() / inf.part.mass - 380;
        if (over > 0) { maxDmg = Math.max(maxDmg, over * 0.12); if (events) r.damage(inf.part, over * 0.12); }
      }
    });
  }
  return maxDmg;
}

const report = (label, r) => {
  const p = r.parts.pelvis.body.translation();
  const h = r.parts.head.body.translation();
  console.log(label, `pelvis=(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) headY=${h.y.toFixed(2)} alive=${r.alive} health=${r.health.toFixed(0)} mass=${r.totalMass.toFixed(1)}`);
};

let g = makeGame('stand');
let r = new Ragdoll(g, new THREE.Vector3(0, 0.02, 0), 0);
run(g, r, 4);
report('stand 4s:', r);

g = makeGame('chase');
r = new Ragdoll(g, new THREE.Vector3(0, 0.02, 0), 0);
run(g, r, 5);
report('chase 5s (player at z=10):', r);

g = makeGame('limp');
r = new Ragdoll(g, new THREE.Vector3(0, 0.02, 0), 0);
run(g, r, 4);
report('limp 4s:', r);

g = makeGame('stand');
r = new Ragdoll(g, new THREE.Vector3(0, 0.02, 0), 0);
run(g, r, 2);
r.knockout(1);
for (const p of r.list) p.body.applyImpulse({ x: p.mass * 4, y: 0, z: 0 }, true);
run(g, r, 1.2);
report('shoved, 1.2s:', r);
run(g, r, 5);
report('recovered after 5s more:', r);

for (const height of [2, 4, 7.2, 15]) {
  let deaths = 0, totalHealth = 0, detached = 0;
  for (let trial = 0; trial < 6; trial++) {
    g = makeGame('limp');
    r = new Ragdoll(g, new THREE.Vector3(0, height, 0), trial * 1.1);
    const q = new RAPIER.EventQueue(true);
    for (let i = 0; i < 240; i++) {
      g.world.step(q);
      const pending = [];
      q.drainContactForceEvents((e) => {
        const a = g.info.get(e.collider1()), b = g.info.get(e.collider2());
        if (a?.kind === 'part' && b?.kind === 'part') return;
        for (const inf of [a, b]) if (inf?.kind === 'part') pending.push([inf.part, r.impactDamage(e.totalForceMagnitude())]);
      });
      for (const [p, d] of pending) if (d > 0) r.damage(p, d);
    }
    if (!r.alive) deaths++;
    totalHealth += r.health;
    detached += r.list.filter((p) => p.parent && !p.joint).length;
  }
  console.log(`drop ${height}m x6: deaths=${deaths} avgHealth=${(totalHealth / 6).toFixed(0)} limbsLost=${detached}`);
}
