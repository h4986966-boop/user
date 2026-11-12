import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ALL, G, groups } from './constants.js';

const MAX_PARTICLES = 2500;
const MAX_DECALS = 900;
const KIND = { BLOOD: 0, SPARK: 1, SMOKE: 2 };
const COLORS = [new THREE.Color(0x8a0303), new THREE.Color(0xffc040), new THREE.Color(0x777777)];
const Zv = new THREE.Vector3(0, 0, 1);
const dummy = new THREE.Object3D();
const tmp = new THREE.Vector3();
const tmpColor = new THREE.Color();

export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.scene;

    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      MAX_PARTICLES,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.smokeMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
      MAX_PARTICLES,
    );
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.count = 0;
    scene.add(this.smokeMesh);
    this.p = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.p.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size: 0.04, kind: 0 });
    }
    this.alive = 0;

    this.decals = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 10),
      new THREE.MeshStandardMaterial({ color: 0x6e0202, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }),
      MAX_DECALS,
    );
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.receiveShadow = true;
    scene.add(this.decals);
    this.decalCursor = 0;

    this.spurts = [];
    this.flashes = [];
    this.flashGeo = new THREE.SphereGeometry(1, 16, 12);
  }

  emit(kind, pos, dir, count, speed, spread, life = 1.2, size) {
    for (let n = 0; n < count; n++) {
      if (this.alive >= MAX_PARTICLES) return;
      const p = this.p[this.alive++];
      p.kind = kind;
      p.pos.copy(pos);
      p.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spread * 2);
      if (dir) p.vel.addScaledVector(dir, speed * (0.5 + Math.random() * 0.7));
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.size = size ?? (kind === KIND.SPARK ? 0.03 : 0.025 + Math.random() * 0.035);
      if (kind === KIND.SMOKE) p.size *= 0.7 + Math.random() * 0.6;
    }
  }

  blood(pos, dir, count = 15) {
    if (!this.game.settings.gore) return;
    this.emit(KIND.BLOOD, pos, dir, Math.round(count), 4, 1.6, 2.5);
  }

  sparks(pos, normal, count = 10) {
    this.emit(KIND.SPARK, pos, normal, count, 5, 2.5, 0.35);
  }

  smoke(pos, count = 6, spread = 0.6, size = 0.12) {
    this.emit(KIND.SMOKE, pos, null, count, 0, spread, 1.4, size);
  }

  // Continuous blood stream from a body-local point (severed joints).
  spurt(body, localPoint, duration) {
    if (!this.game.settings.gore) return;
    this.spurts.push({ body, local: localPoint.clone(), t: duration });
  }

  explosion(pos, radius) {
    const mesh = new THREE.Mesh(
      this.flashGeo,
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }),
    );
    mesh.position.copy(pos);
    this.game.scene.add(mesh);
    const light = new THREE.PointLight(0xff8833, 60, radius * 4, 1.5);
    light.position.copy(pos);
    this.game.scene.add(light);
    this.flashes.push({ mesh, light, t: 0, radius });
    this.sparks(pos, null, 40);
    for (let i = 0; i < 25; i++) this.emit(KIND.SPARK, pos, null, 1, 0, 9, 0.6);
    this.smoke(pos, 18, 1.4, 0.45);
  }

  splat(point, normal, size) {
    const i = this.decalCursor;
    this.decalCursor = (this.decalCursor + 1) % MAX_DECALS;
    this.decals.count = Math.max(this.decals.count, i + 1);
    dummy.position.copy(point).addScaledVector(normal, 0.01 + Math.random() * 0.005);
    dummy.quaternion.setFromUnitVectors(Zv, normal);
    dummy.scale.set(size * (0.7 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6), 1);
    dummy.updateMatrix();
    this.decals.setMatrixAt(i, dummy.matrix);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.alive = 0;
    this.decals.count = 0;
    this.decalCursor = 0;
    this.spurts.length = 0;
  }

  update(dt) {
    const world = this.game.world;
    const rayGroups = groups(ALL, G.WORLD);

    for (let i = this.spurts.length - 1; i >= 0; i--) {
      const s = this.spurts[i];
      s.t -= dt;
      if (s.t <= 0 || s.body.__removed) { this.spurts.splice(i, 1); continue; }
      const r = s.body.rotation();
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      const t = s.body.translation();
      const p = tmp.copy(s.local).applyQuaternion(q).add(t);
      const dir = s.local.clone().normalize().applyQuaternion(q);
      this.emit(KIND.BLOOD, p, dir, 2, 3 * Math.min(1, s.t), 0.4, 2.5);
    }

    for (let i = 0; i < this.alive; i++) {
      const p = this.p[i];
      p.life -= dt;
      let dead = p.life <= 0;
      if (!dead) {
        if (p.kind === KIND.SMOKE) {
          p.vel.multiplyScalar(0.94);
          p.vel.y += 1.2 * dt;
          p.size += dt * p.size * 0.8;
          p.pos.addScaledVector(p.vel, dt);
        } else {
          p.vel.y -= 9.81 * dt;
          const step = p.vel.length() * dt;
          if (p.kind === KIND.BLOOD && step > 1e-4) {
            const dir = tmp.copy(p.vel).normalize();
            const hit = world.castRayAndGetNormal(new RAPIER.Ray(p.pos, dir), step, true, undefined, rayGroups);
            if (hit) {
              p.pos.addScaledVector(dir, hit.timeOfImpact);
              this.splat(p.pos, tmp.set(hit.normal.x, hit.normal.y, hit.normal.z), 0.05 + Math.random() * 0.14);
              dead = true;
            }
          }
          if (!dead) p.pos.addScaledVector(p.vel, dt);
          if (p.pos.y < -5) dead = true;
        }
      }
      if (dead) {
        const last = this.p[--this.alive];
        this.p[this.alive] = p;
        this.p[i] = last;
        i--;
      }
    }

    let n = 0, s = 0;
    for (let i = 0; i < this.alive; i++) {
      const p = this.p[i];
      const fade = p.kind === KIND.BLOOD ? 1 : Math.max(0, p.life / p.max);
      dummy.position.copy(p.pos);
      dummy.quaternion.identity();
      if (p.kind === KIND.SMOKE) {
        dummy.scale.setScalar(p.size * Math.min(1, fade * 3));
        dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(s, dummy.matrix);
        this.smokeMesh.setColorAt(s, tmpColor.copy(COLORS[p.kind]).multiplyScalar(0.6 + fade * 0.6));
        s++;
        continue;
      }
      dummy.scale.setScalar(p.size * Math.max(0.3, fade));
      dummy.updateMatrix();
      this.mesh.setMatrixAt(n, dummy.matrix);
      this.mesh.setColorAt(n, COLORS[p.kind]);
      n++;
    }
    for (const m of [this.mesh, this.smokeMesh]) {
      m.count = m === this.mesh ? n : s;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      const k = f.t / 0.4;
      f.mesh.scale.setScalar(f.radius * 0.7 * Math.min(1, k * 2));
      f.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
      f.light.intensity = Math.max(0, 60 * (1 - k));
      if (k >= 1) {
        this.game.scene.remove(f.mesh, f.light);
        f.mesh.material.dispose();
        f.light.dispose();
        this.flashes.splice(i, 1);
      }
    }
  }
}
