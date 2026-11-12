import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ALL, G, TOOLS, groups } from './constants.js';

const UP = new THREE.Vector3(0, 1, 0);
const TOOL_COLORS = [0x47c7ff, 0x777b85, 0xf2c6a0, 0x5c8a3a, 0xe8b33a, 0xd23b3b];

export class Tools {
  constructor(game) {
    this.game = game;
    this.index = 0;
    this.held = null;
    this.cooldown = 0;
    this.kick = 0;
    this.swing = 0;
    this.tracers = [];

    this.view = new THREE.Group();
    this.view.position.set(0.3, -0.27, -0.55);
    this.viewMat = new THREE.MeshStandardMaterial({ color: TOOL_COLORS[0], roughness: 0.4, metalness: 0.4 });
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.38), this.viewMat);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.3, 10),
      new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.3 }),
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.3);
    this.view.add(bodyMesh, barrel);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.03, -0.46);
    this.view.add(this.muzzle);
    this.flash = new THREE.PointLight(0xffcc66, 0, 6);
    this.flash.position.copy(this.muzzle.position);
    this.view.add(this.flash);
    game.camera.add(this.view);

    const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0x47c7ff, toneMapped: false }));
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    game.scene.add(this.beam);
  }

  get tool() { return TOOLS[this.index].id; }

  select(i) {
    if (i < 0 || i >= TOOLS.length || i === this.index) return;
    this.release();
    this.index = i;
    this.viewMat.color.setHex(TOOL_COLORS[i]);
    this.game.hud.setTool(i);
  }

  cycle(dir) {
    this.select((this.index + dir + TOOLS.length) % TOOLS.length);
  }

  // Camera ray against everything except the player and projectiles.
  ray(maxDist, dir) {
    const cam = this.game.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const d = dir ?? cam.getWorldDirection(new THREE.Vector3());
    const hit = this.game.world.castRayAndGetNormal(
      new RAPIER.Ray(origin, d), maxDist, true, undefined, groups(ALL, ALL & ~G.PLAYER & ~G.PROJECTILE),
    );
    if (!hit) return { origin, dir: d, point: origin.clone().addScaledVector(d, maxDist) };
    const point = origin.clone().addScaledVector(d, hit.timeOfImpact);
    const body = hit.collider.parent();
    return {
      origin, dir: d, point,
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      dist: hit.timeOfImpact,
      collider: hit.collider,
      body,
      info: this.game.info.get(hit.collider.handle),
      dynamic: body && body.isDynamic(),
    };
  }

  onDown(button) {
    if (this.cooldown > 0 && this.tool !== 'grab') return;
    const g = this.game;
    switch (this.tool) {
      case 'grab':
        if (button === 0) this.grab();
        else if (button === 2) this.throwHeld();
        break;
      case 'gun':
        if (button === 0) {
          this.fire(1, 0, 40, 18);
          g.sfx.shot();
          this.cooldown = 0.2;
          this.kick = 1;
        } else if (button === 2) {
          this.fire(10, 0.06, 15, 8);
          g.sfx.shotgun();
          this.cooldown = 0.8;
          this.kick = 1.6;
        }
        break;
      case 'fist':
        if (button === 0) this.punch();
        else if (button === 2) this.forcePush();
        break;
      case 'launcher': {
        const cam = g.camera;
        const dir = cam.getWorldDirection(new THREE.Vector3());
        const start = this.muzzle.getWorldPosition(new THREE.Vector3());
        if (button === 0) {
          g.spawnRocket(start, dir);
          this.cooldown = 0.7;
        } else if (button === 2) {
          g.spawnGrenade(start, dir);
          this.cooldown = 0.5;
        }
        g.sfx.whoosh();
        this.kick = 1.2;
        break;
      }
      case 'spawn':
      case 'barrel': {
        const hit = this.ray(40);
        if (button === 2 && this.tool === 'barrel') {
          if (hit.dynamic) g.deleteAt(hit);
          this.cooldown = 0.15;
          break;
        }
        const pos = hit.point.clone();
        if (hit.normal) pos.addScaledVector(hit.normal, 0.4);
        pos.y = Math.max(pos.y, 0.02);
        if (this.tool === 'spawn' && button === 0) {
          const cp = g.camera.position;
          g.spawnRagdoll(pos, Math.atan2(cp.x - pos.x, cp.z - pos.z));
        } else if (this.tool === 'spawn' && button === 2) {
          g.spawnCrate(pos.add(new THREE.Vector3(0, 0.5, 0)));
        } else {
          g.spawnBarrel(pos.add(new THREE.Vector3(0, 0.5, 0)));
        }
        g.sfx.pop();
        this.cooldown = 0.2;
        break;
      }
    }
  }

  onUp(button) {
    if (this.tool === 'grab' && button === 0) this.release();
  }

  onWheel(dy) {
    if (this.held) {
      this.held.dist = Math.max(1.5, Math.min(25, this.held.dist - dy * 0.01));
    } else {
      this.cycle(dy > 0 ? 1 : -1);
    }
  }

  grab() {
    const hit = this.ray(35);
    if (!hit.dynamic) return;
    const { body, info } = hit;
    const r = body.rotation();
    const t = body.translation();
    const inv = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert();
    const local = hit.point.clone().sub(t).applyQuaternion(inv);
    const ragdoll = info?.kind === 'part' ? info.ragdoll : null;
    const handles = ragdoll ? ragdoll.list.map((p) => p.collider.handle) : [hit.collider.handle];
    handles.forEach((h) => this.game.player.ignore.add(h));
    this.held = {
      body, local, ragdoll, handles,
      dist: Math.max(2, hit.dist),
      mass: ragdoll ? ragdoll.totalMass * 0.25 : body.mass(),
    };
    this.beam.visible = true;
  }

  release() {
    if (!this.held) return;
    this.held.handles.forEach((h) => this.game.player.ignore.delete(h));
    this.held = null;
    this.beam.visible = false;
  }

  throwHeld() {
    const h = this.held;
    if (!h) return;
    const dir = this.game.camera.getWorldDirection(new THREE.Vector3()).add(new THREE.Vector3(0, 0.15, 0)).normalize();
    if (h.ragdoll) {
      for (const p of h.ragdoll.list) p.body.applyImpulse(dir.clone().multiplyScalar(p.mass * 22), true);
      h.ragdoll.knockout(3);
    } else {
      h.body.applyImpulse(dir.multiplyScalar(h.body.mass() * 25), true);
    }
    this.game.sfx.whoosh();
    this.release();
  }

  // Velocity servo pulling the grabbed point toward a spot in front of the camera.
  fixedStep() {
    const h = this.held;
    if (!h) return;
    if (h.body.__removed) { this.release(); return; }
    if (h.ragdoll) h.ragdoll.knockout(0.6);
    const cam = this.game.camera;
    const target = cam.getWorldPosition(new THREE.Vector3())
      .addScaledVector(cam.getWorldDirection(new THREE.Vector3()), h.dist);
    const r = h.body.rotation();
    const t = h.body.translation();
    const wp = h.local.clone().applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).add(t);
    const pv = h.body.velocityAtPoint(wp);
    const desired = target.clone().sub(wp).multiplyScalar(14);
    if (desired.length() > 30) desired.setLength(30);
    const impulse = desired.sub(new THREE.Vector3(pv.x, pv.y, pv.z)).multiplyScalar(h.mass * 0.35);
    h.body.applyImpulseAtPoint(impulse, wp, true);
    if (!h.ragdoll) {
      const w = h.body.angvel();
      h.body.setAngvel({ x: w.x * 0.92, y: w.y * 0.92, z: w.z * 0.92 }, true);
    }
    h.worldPoint = wp;
  }

  fire(pellets, spread, damage, force) {
    const g = this.game;
    const fwd = g.camera.getWorldDirection(new THREE.Vector3());
    const muzzle = this.muzzle.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < pellets; i++) {
      const dir = fwd.clone();
      if (spread > 0) {
        dir.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spread * 2)).normalize();
      }
      const hit = this.ray(150, dir);
      this.tracer(muzzle, hit.point);
      if (!hit.collider) continue;
      if (hit.dynamic) hit.body.applyImpulseAtPoint(dir.clone().multiplyScalar(force), hit.point, true);
      const info = hit.info;
      if (info?.kind === 'part') {
        const wasAlive = info.ragdoll.alive;
        info.ragdoll.damage(info.part, damage, hit.point, dir);
        if (info.part.def.name === 'head' && pellets === 1 && wasAlive) g.hud.toast('HEADSHOT');
      } else if (info?.kind === 'prop' && info.prop.explosive) {
        g.explodeProp(info.prop);
      } else {
        g.effects.sparks(hit.point, hit.normal, 8);
      }
    }
    this.flash.intensity = 25;
    g.player.pitch = Math.min(1.55, g.player.pitch + 0.015 * pellets ** 0.5);
  }

  tracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, toneMapped: false }));
    this.game.scene.add(line);
    this.tracers.push({ line, t: 0.06 });
  }

  punch() {
    const g = this.game;
    this.swing = 1;
    this.cooldown = 0.35;
    const hit = this.ray(3);
    if (!hit.dynamic) {
      if (hit.collider) g.sfx.thud(0.3);
      return;
    }
    const dir = hit.dir.clone().addScaledVector(UP, 0.3).normalize();
    g.sfx.punch();
    g.shake = Math.max(g.shake, 0.06);
    if (hit.info?.kind === 'part') {
      const rd = hit.info.ragdoll;
      for (const p of rd.list) p.body.applyImpulse(dir.clone().multiplyScalar(p.mass * 6), true);
      hit.body.applyImpulseAtPoint(dir.clone().multiplyScalar(hit.info.part.mass * 14), hit.point, true);
      rd.damage(hit.info.part, 18, hit.point, dir);
      rd.knockout(2.5);
    } else {
      hit.body.applyImpulseAtPoint(dir.multiplyScalar(hit.body.mass() * 9), hit.point, true);
    }
  }

  forcePush() {
    const g = this.game;
    this.cooldown = 1;
    this.swing = 1;
    g.sfx.whoosh();
    const origin = g.camera.getWorldPosition(new THREE.Vector3());
    const fwd = g.camera.getWorldDirection(new THREE.Vector3());
    const R = 10;
    const seen = new Set();
    const hits = [];
    g.world.intersectionsWithShape(origin, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(R), (c) => {
      const body = c.parent();
      if (!body || !body.isDynamic() || seen.has(body.handle)) return true;
      seen.add(body.handle);
      const t = body.translation();
      const to = new THREE.Vector3(t.x, t.y, t.z).sub(origin);
      const d = to.length();
      to.normalize();
      if (to.dot(fwd) < 0.55) return true;
      const f = 1 - d / R;
      body.applyImpulse(to.addScaledVector(UP, 0.35).normalize().multiplyScalar(body.mass() * 16 * f), true);
      hits.push(g.info.get(c.handle));
      return true;
    });
    for (const info of hits) if (info?.kind === 'part') info.ragdoll.knockout(2.5);
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.kick = Math.max(0, this.kick - dt * 8);
    this.swing = Math.max(0, this.swing - dt * 4);
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 400);
    const s = Math.sin(this.swing * Math.PI);
    this.view.position.set(0.3 - s * 0.15, -0.27 + s * 0.08, -0.55 + this.kick * 0.08 - s * 0.35);
    this.view.rotation.set(this.kick * 0.25, s * 0.4, 0);

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t -= dt;
      tr.line.material.opacity = Math.max(0, tr.t / 0.06);
      if (tr.t <= 0) {
        this.game.scene.remove(tr.line);
        tr.line.geometry.dispose();
        tr.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }

    if (this.held?.worldPoint) {
      const pos = this.beam.geometry.attributes.position;
      const m = this.muzzle.getWorldPosition(new THREE.Vector3());
      pos.setXYZ(0, m.x, m.y, m.z);
      pos.setXYZ(1, this.held.worldPoint.x, this.held.worldPoint.y, this.held.worldPoint.z);
      pos.needsUpdate = true;
    }
  }
}
