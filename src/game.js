import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ALL, FIXED_DT, G, GRAVITY, groups } from './constants.js';
import { buildArena } from './arena.js';
import { Ragdoll } from './ragdoll.js';
import { Player } from './player.js';
import { Tools } from './tools.js';
import { Effects } from './effects.js';
import { Sfx } from './audio.js';

const AI_MODES = ['chase', 'stand', 'limp'];

export class Game {
  constructor(container, hud) {
    this.hud = hud;
    this.settings = { gore: true, aiMode: 'chase', slowmo: false };
    this.stats = { kills: 0 };
    this.info = new Map();
    this.tracked = [];
    this.ragdolls = [];
    this.props = [];
    this.projectiles = [];
    this.pendingExplosions = [];
    this.pendingDamage = [];
    this.onRender = [];
    this.shake = 0;
    this.timeScale = 1;
    this.accumulator = 0;
    this.last = performance.now();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9cc7ec);
    this.scene.fog = new THREE.Fog(0x9cc7ec, 40, 110);
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 300);
    this.scene.add(this.camera);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x50586a, 1.4));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    sun.position.set(20, 35, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.far = 120;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    this.events = new RAPIER.EventQueue(true);

    this.sfx = new Sfx();
    this.effects = new Effects(this);
    buildArena(this);
    this.player = new Player(this, new THREE.Vector3(0, 0, 14));
    this.tools = new Tools(this);
    this.crateTex = crateTexture();
    this.barrelTex = barrelTexture();
    this.populate();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- registry -------------------------------------------------------

  addCollider(desc, body, info) {
    const c = this.world.createCollider(desc, body);
    this.info.set(c.handle, info);
    return c;
  }

  track(body, mesh) {
    this.tracked.push({ body, mesh });
  }

  removeBody(body) {
    if (body.__removed) return;
    body.__removed = true;
    for (let i = 0; i < body.numColliders(); i++) this.info.delete(body.collider(i).handle);
    for (let i = this.tracked.length - 1; i >= 0; i--) {
      if (this.tracked[i].body === body) {
        this.scene.remove(this.tracked[i].mesh);
        this.tracked.splice(i, 1);
      }
    }
    this.world.removeRigidBody(body);
  }

  // ---- spawning -------------------------------------------------------

  populate() {
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + (i / 4) * 1.8;
      this.spawnRagdoll(new THREE.Vector3(Math.sin(a) * 7, 0.02, -Math.cos(a) * 7 + 4), a + Math.PI);
    }
    for (const [x, z] of [[-19, -18], [-21, -21], [-22, -17]]) this.spawnRagdoll(new THREE.Vector3(x, 7.22, z), 0);
    for (const [x, z] of [[5, 4], [5.9, 4], [5.45, 4], [-6, -4], [-9, 12], [10, -2]]) this.spawnCrate(new THREE.Vector3(x, 0.5, z));
    this.spawnCrate(new THREE.Vector3(5.45, 1.42, 4));
    for (const [x, z] of [[-4, -2], [3, -6], [-20, -22]]) this.spawnBarrel(new THREE.Vector3(x, x === -20 ? 7.7 : 0.5, z));
  }

  spawnRagdoll(pos, yaw = 0) {
    const r = new Ragdoll(this, pos, yaw);
    this.ragdolls.push(r);
    return r;
  }

  spawnCrate(pos) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z));
    const prop = { body, explosive: false };
    prop.collider = this.addCollider(
      RAPIER.ColliderDesc.cuboid(0.45, 0.45, 0.45).setDensity(250).setFriction(0.7).setCollisionGroups(groups(G.PROP, ALL)),
      body, { kind: 'prop', prop },
    );
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshStandardMaterial({ map: this.crateTex, roughness: 0.9 }));
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.track(body, mesh);
    this.props.push(prop);
    return prop;
  }

  spawnBarrel(pos) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z));
    const prop = { body, explosive: true };
    prop.collider = this.addCollider(
      RAPIER.ColliderDesc.cylinder(0.45, 0.3).setDensity(300).setFriction(0.6)
        .setCollisionGroups(groups(G.PROP, ALL))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS),
      body, { kind: 'prop', prop },
    );
    prop.collider.setContactForceEventThreshold(body.mass() * 900);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 18), new THREE.MeshStandardMaterial({ map: this.barrelTex, roughness: 0.5, metalness: 0.3 }));
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.track(body, mesh);
    this.props.push(prop);
    return prop;
  }

  spawnRocket(pos, dir) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setGravityScale(0).setCcdEnabled(true)
        .setLinvel(dir.x * 40, dir.y * 40, dir.z * 40)
        .setRotation(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)),
    );
    const proj = { type: 'rocket', body, age: 0 };
    this.addCollider(
      RAPIER.ColliderDesc.ball(0.12).setCollisionGroups(groups(G.PROJECTILE, ALL & ~G.PLAYER & ~G.PROJECTILE))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body, { kind: 'projectile', proj },
    );
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0x5c8a3a, emissive: 0x331100 }));
    this.scene.add(mesh);
    this.track(body, mesh);
    this.projectiles.push(proj);
  }

  spawnGrenade(pos, dir) {
    const v = dir.clone().multiplyScalar(17).add(new THREE.Vector3(0, 3, 0));
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setCcdEnabled(true).setLinvel(v.x, v.y, v.z).setAngularDamping(0.8),
    );
    const proj = { type: 'grenade', body, age: 0 };
    this.addCollider(
      RAPIER.ColliderDesc.ball(0.1).setDensity(1500).setRestitution(0.35).setCollisionGroups(groups(G.PROJECTILE, ALL & ~G.PLAYER & ~G.PROJECTILE)),
      body, { kind: 'projectile', proj },
    );
    proj.mat = new THREE.MeshStandardMaterial({ color: 0x2f4f2f, emissive: 0x000000 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), proj.mat);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.track(body, mesh);
    this.projectiles.push(proj);
  }

  deleteAt(hit) {
    if (hit.info?.kind === 'part') {
      hit.info.ragdoll.dispose();
      this.ragdolls = this.ragdolls.filter((r) => r !== hit.info.ragdoll);
    } else if (hit.info?.kind === 'prop') {
      this.removeProp(hit.info.prop);
    }
  }

  removeProp(prop) {
    this.removeBody(prop.body);
    this.props = this.props.filter((p) => p !== prop);
  }

  explodeProp(prop) {
    if (prop.exploded) return;
    prop.exploded = true;
    const t = prop.body.translation();
    this.removeProp(prop);
    this.queueExplosion(new THREE.Vector3(t.x, t.y, t.z), 6.5, 1.2, 0.06);
  }

  queueExplosion(pos, radius = 6, power = 1, delay = 0) {
    this.pendingExplosions.push({ pos, radius, power, delay });
  }

  explode(pos, radius, power) {
    this.effects.explosion(pos, radius);
    this.sfx.boom();
    const toPlayer = this.player.position.clone().add(new THREE.Vector3(0, 0.9, 0)).sub(pos);
    const pd = toPlayer.length();
    this.shake = Math.max(this.shake, 0.6 * Math.max(0, 1 - pd / 30));
    if (pd < radius) {
      const f = 1 - pd / radius;
      this.player.knock.addScaledVector(toPlayer.normalize(), 16 * f * power);
      this.player.vy += 5 * f * power;
    }
    const seen = new Set();
    const hits = [];
    this.world.intersectionsWithShape(pos, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(radius), (c) => {
      const body = c.parent();
      if (!body || !body.isDynamic() || seen.has(body.handle)) return true;
      seen.add(body.handle);
      const t = body.translation();
      const dir = new THREE.Vector3(t.x, t.y, t.z).sub(pos);
      const f = Math.max(0, 1 - dir.length() / radius);
      dir.normalize().add(new THREE.Vector3(0, 0.4, 0)).normalize();
      body.applyImpulse(dir.clone().multiplyScalar(body.mass() * 19 * f * power), true);
      body.applyTorqueImpulse({ x: (Math.random() - 0.5) * body.mass(), y: 0, z: (Math.random() - 0.5) * body.mass() }, true);
      hits.push({ info: this.info.get(c.handle), f, dir, point: new THREE.Vector3(t.x, t.y, t.z) });
      return true;
    });
    // Damage after the query: detaching joints or removing bodies inside the callback is unsafe.
    for (const h of hits) {
      if (h.info?.kind === 'part') h.info.ragdoll.damage(h.info.part, 110 * h.f * power, h.point, h.dir);
      else if (h.info?.kind === 'prop' && h.info.prop.explosive && h.f > 0.15) this.explodeProp(h.info.prop);
    }
  }

  // ---- settings -------------------------------------------------------

  toggleSlowmo() {
    this.settings.slowmo = !this.settings.slowmo;
    this.hud.toast(this.settings.slowmo ? 'SLOW-MO' : 'NORMAL SPEED');
  }

  toggleGore() {
    this.settings.gore = !this.settings.gore;
    this.hud.toast(this.settings.gore ? 'GORE ON' : 'GORE OFF');
  }

  cycleAi() {
    const i = AI_MODES.indexOf(this.settings.aiMode);
    this.settings.aiMode = AI_MODES[(i + 1) % AI_MODES.length];
    this.hud.toast(`DUMMIES: ${this.settings.aiMode.toUpperCase()}`);
  }

  reset() {
    this.tools.release();
    for (const r of this.ragdolls) r.dispose();
    for (const p of this.props) this.removeBody(p.body);
    for (const p of this.projectiles) this.removeBody(p.body);
    this.ragdolls = [];
    this.props = [];
    this.projectiles = [];
    this.pendingExplosions = [];
    this.pendingDamage = [];
    this.effects.clear();
    this.stats.kills = 0;
    this.player.reset();
    this.populate();
    this.hud.toast('RESET');
  }

  // ---- simulation -----------------------------------------------------

  fixedStep() {
    const dt = FIXED_DT * this.timeScale;
    this.world.timestep = dt;
    this.player.step(FIXED_DT);
    for (const r of this.ragdolls) r.step(dt);
    this.tools.fixedStep();
    this.world.step(this.events);

    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      for (const h of [h1, h2]) {
        const info = this.info.get(h);
        if (info?.kind === 'projectile' && info.proj.type === 'rocket') info.proj.detonate = true;
      }
    });
    this.events.drainContactForceEvents((e) => {
      const force = e.totalForceMagnitude();
      const a = this.info.get(e.collider1());
      const b = this.info.get(e.collider2());
      if (a?.kind === 'part' && b?.kind === 'part' && a.ragdoll === b.ragdoll) return;
      for (const info of [a, b]) {
        if (info?.kind === 'part') {
          const amount = info.ragdoll.impactDamage(force);
          if (amount > 0) this.pendingDamage.push({ part: info.part, amount });
        } else if (info?.kind === 'prop' && info.prop.explosive) {
          this.explodeProp(info.prop);
        }
      }
    });

    for (const d of this.pendingDamage) {
      const { part } = d;
      if (part.ragdoll.removed) continue;
      const t = part.body.translation();
      part.ragdoll.damage(part, d.amount, new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0, 1, 0));
      if (d.amount > 25) this.sfx.splat();
      else this.sfx.thud(d.amount / 25);
    }
    this.pendingDamage.length = 0;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      const t = p.body.translation();
      const pos = new THREE.Vector3(t.x, t.y, t.z);
      let boom = false;
      if (p.type === 'rocket') {
        if (p.age > 0.08 && Math.random() < 0.6) this.effects.smoke(pos, 1, 0.1);
        boom = p.detonate || p.age > 6;
      } else {
        p.mat.emissive.setHex(Math.floor(p.age * (p.age > 1.6 ? 12 : 4)) % 2 ? 0xff2200 : 0x000000);
        boom = p.age > 2.2;
      }
      if (boom) {
        this.removeBody(p.body);
        this.projectiles.splice(i, 1);
        this.queueExplosion(pos, p.type === 'rocket' ? 6 : 6.5, 1);
      }
    }

    const due = [];
    this.pendingExplosions = this.pendingExplosions.filter((e) => {
      e.delay -= dt;
      if (e.delay <= 0) { due.push(e); return false; }
      return true;
    });
    for (const e of due) this.explode(e.pos, e.radius, e.power);

    this.ragdolls = this.ragdolls.filter((r) => {
      if (r.removed) return false;
      if (r.parts.chest.body.translation().y < -30) { r.dispose(); return false; }
      return true;
    });
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const targetScale = this.settings.slowmo ? 0.25 : 1;
    this.timeScale += (targetScale - this.timeScale) * Math.min(1, dt * 8);

    if (!this.paused) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 5) {
        this.fixedStep();
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === 5) this.accumulator = 0;
    }

    for (const { body, mesh } of this.tracked) {
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    this.tools.update(dt);
    this.effects.update(dt * this.timeScale);
    for (const fn of this.onRender) fn(dt);
    this.shake = Math.max(0, this.shake - dt * 1.5);
    this.player.updateCamera(this.camera, this.shake);
    this.hud.update(this);
    this.renderer.render(this.scene, this.camera);
  }
}

function crateTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#b07a3e';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#7a5022';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 118, 118);
  g.beginPath(); g.moveTo(5, 5); g.lineTo(123, 123); g.stroke();
  g.lineWidth = 2;
  for (let y = 20; y < 128; y += 22) { g.beginPath(); g.moveTo(10, y); g.lineTo(118, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function barrelTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#c0281f';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f2c230';
  g.fillRect(0, 50, 128, 28);
  g.fillStyle = '#111';
  g.font = 'bold 22px sans-serif';
  g.fillText('TNT', 44, 72);
  g.fillStyle = '#8a1a14';
  g.fillRect(0, 0, 128, 6);
  g.fillRect(0, 122, 128, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
