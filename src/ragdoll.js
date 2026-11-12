import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ALL, G, groups } from './constants.js';

const DENSITY = 985;
const IMPACT_THRESHOLD = 230;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

// Rest pose: feet at y=0, facing +Z. Hinge limits: positive angles bend backward.
const PARTS = [
  { name: 'pelvis', shape: 'box', size: [0.15, 0.09, 0.1], pos: [0, 1.0, 0], mat: 'pants' },
  { name: 'chest', shape: 'box', size: [0.19, 0.17, 0.11], pos: [0, 1.28, 0], parent: 'pelvis', joint: 'ball', anchor: [0, 1.1, 0], mat: 'shirt' },
  { name: 'head', shape: 'ball', size: [0.12], pos: [0, 1.6, 0], parent: 'chest', joint: 'ball', anchor: [0, 1.47, 0], mat: 'skin', hp: 60, fatal: true },
  { name: 'uArmL', shape: 'capsule', size: [0.12, 0.05], pos: [-0.26, 1.27, 0], parent: 'chest', joint: 'ball', anchor: [-0.26, 1.42, 0], mat: 'shirt', hp: 70 },
  { name: 'lArmL', shape: 'capsule', size: [0.11, 0.045], pos: [-0.26, 0.98, 0], parent: 'uArmL', joint: 'hinge', anchor: [-0.26, 1.12, 0], limits: [-2.4, 0], mat: 'skin', hp: 60 },
  { name: 'uArmR', shape: 'capsule', size: [0.12, 0.05], pos: [0.26, 1.27, 0], parent: 'chest', joint: 'ball', anchor: [0.26, 1.42, 0], mat: 'shirt', hp: 70 },
  { name: 'lArmR', shape: 'capsule', size: [0.11, 0.045], pos: [0.26, 0.98, 0], parent: 'uArmR', joint: 'hinge', anchor: [0.26, 1.12, 0], limits: [-2.4, 0], mat: 'skin', hp: 60 },
  { name: 'uLegL', shape: 'capsule', size: [0.16, 0.07], pos: [-0.1, 0.72, 0], parent: 'pelvis', joint: 'ball', anchor: [-0.1, 0.93, 0], mat: 'pants', hp: 105, leg: true },
  { name: 'lLegL', shape: 'capsule', size: [0.17, 0.06], pos: [-0.1, 0.28, 0], parent: 'uLegL', joint: 'hinge', anchor: [-0.1, 0.5, 0], limits: [0, 2.4], mat: 'pants', hp: 95, leg: true },
  { name: 'uLegR', shape: 'capsule', size: [0.16, 0.07], pos: [0.1, 0.72, 0], parent: 'pelvis', joint: 'ball', anchor: [0.1, 0.93, 0], mat: 'pants', hp: 105, leg: true },
  { name: 'lLegR', shape: 'capsule', size: [0.17, 0.06], pos: [0.1, 0.28, 0], parent: 'uLegR', joint: 'hinge', anchor: [0.1, 0.5, 0], limits: [0, 2.4], mat: 'pants', hp: 95, leg: true },
];

const PALETTES = [
  { skin: 0xf2c6a0, shirt: 0xe8b33a, pants: 0x2f4b7c },
  { skin: 0xd9a37a, shirt: 0xd94f3d, pants: 0x333740 },
  { skin: 0x8d5b3c, shirt: 0x3fa66b, pants: 0x4a3b2a },
  { skin: 0xf5d0b5, shirt: 0x6a5acd, pants: 0x222222 },
  { skin: 0xc68b59, shirt: 0xeeeeee, pants: 0x1f6f8b },
];

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const relTargets = {};
for (const p of PARTS) relTargets[p.name] = new THREE.Quaternion();

let nextId = 1;

export class Ragdoll {
  constructor(game, position, yaw = 0) {
    this.game = game;
    this.id = nextId++;
    this.parts = {};
    this.list = [];
    this.health = 220;
    this.alive = true;
    this.stun = 0;
    this.recover = 1;
    this.phase = Math.random() * 10;
    this.totalMass = 0;
    this.removed = false;

    const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const mats = {
      skin: new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.7 }),
      shirt: new THREE.MeshStandardMaterial({ color: palette.shirt, roughness: 0.8 }),
      pants: new THREE.MeshStandardMaterial({ color: palette.pants, roughness: 0.85 }),
    };
    this.mats = mats;

    const rot = new THREE.Quaternion().setFromAxisAngle(Y, yaw);
    const { world } = game;

    for (const def of PARTS) {
      const p = new THREE.Vector3(...def.pos).applyQuaternion(rot).add(position);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setRotation(rot)
          .setLinearDamping(0.05)
          .setAngularDamping(1.0)
          .setCcdEnabled(true),
      );
      let desc, geo;
      if (def.shape === 'box') {
        desc = RAPIER.ColliderDesc.cuboid(...def.size);
        geo = new THREE.BoxGeometry(def.size[0] * 2, def.size[1] * 2, def.size[2] * 2);
      } else if (def.shape === 'ball') {
        desc = RAPIER.ColliderDesc.ball(def.size[0]);
        geo = new THREE.SphereGeometry(def.size[0], 16, 12);
      } else {
        desc = RAPIER.ColliderDesc.capsule(def.size[0], def.size[1]);
        geo = new THREE.CapsuleGeometry(def.size[1], def.size[0] * 2, 4, 10);
      }
      desc
        .setDensity(DENSITY)
        .setFriction(0.8)
        .setCollisionGroups(groups(G.RAGDOLL, ALL))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      const part = { def, body, ragdoll: this, hp: def.hp ?? Infinity, joint: null, parent: null, children: [] };
      const collider = game.addCollider(desc, body, { kind: 'part', part, ragdoll: this });
      part.collider = collider;
      part.mass = body.mass();
      this.totalMass += part.mass;

      const mesh = new THREE.Mesh(geo, mats[def.mat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (def.name === 'head') addFace(mesh);
      game.scene.add(mesh);
      part.mesh = mesh;
      game.track(body, mesh);

      this.parts[def.name] = part;
      this.list.push(part);
    }

    for (const part of this.list) {
      const def = part.def;
      if (!def.parent) continue;
      const parent = this.parts[def.parent];
      const a = new THREE.Vector3(...def.anchor);
      const a1 = a.clone().sub(new THREE.Vector3(...parent.def.pos));
      const a2 = a.clone().sub(new THREE.Vector3(...def.pos));
      const data = def.joint === 'hinge'
        ? RAPIER.JointData.revolute(a1, a2, { x: 1, y: 0, z: 0 })
        : RAPIER.JointData.spherical(a1, a2);
      const joint = world.createImpulseJoint(data, parent.body, part.body, true);
      joint.setContactsEnabled(false);
      if (def.limits) joint.setLimits(def.limits[0], def.limits[1]);
      part.joint = joint;
      part.parent = parent;
      part.anchorLocal = a2;
      part.parentAnchorLocal = a1;
      parent.children.push(part);
    }

    // Inertia about the joint (parallel axis), used to turn desired angular acceleration into torque.
    for (const part of this.list) {
      part.collider.setContactForceEventThreshold(this.totalMass * IMPACT_THRESHOLD);
      const pi = part.body.principalInertia();
      const icom = (pi.x + pi.y + pi.z) / 3;
      part.icom = icom;
      part.inertia = icom + (part.anchorLocal ? part.mass * part.anchorLocal.lengthSq() : 0);
    }
  }

  get pelvis() { return this.parts.pelvis; }

  // Contact force normalised by whole-body mass: light limbs pinned under the torso would
  // otherwise read as huge impacts. ~3 m drop is harmless, ~15 m is usually fatal.
  impactDamage(force) {
    return Math.max(0, force / this.totalMass - IMPACT_THRESHOLD) * 0.4;
  }

  position(target = new THREE.Vector3()) {
    const t = this.parts.chest.body.translation();
    return target.set(t.x, t.y, t.z);
  }

  knockout(seconds) {
    this.stun = Math.max(this.stun, seconds);
    this.recover = 0;
  }

  kill() {
    if (!this.alive) return;
    this.alive = false;
    this.game.stats.kills++;
    this.mats.skin.color.multiplyScalar(0.8);
  }

  // amount in hit points; point/dir are optional world vectors for blood.
  damage(part, amount, point, dir) {
    if (this.removed) return;
    const gore = this.game.settings.gore;
    if (point && gore) this.game.effects.blood(point, dir, Math.min(40, 6 + amount * 0.6));
    if (part.def.name === 'head') amount *= 2.5;
    this.health -= amount;
    part.hp -= amount;
    this.knockout(1.2 + amount / 35);
    if (gore && part.joint && part.hp <= 0) this.detach(part);
    if (this.health <= 0) this.kill();
  }

  detach(part) {
    if (!part.joint) return;
    const { world, effects } = this.game;
    world.removeImpulseJoint(part.joint, true);
    part.joint = null;
    effects.spurt(part.parent.body, part.parentAnchorLocal, 2.5);
    effects.spurt(part.body, part.anchorLocal, 1.5);
    const p = part.body.translation();
    effects.blood(new THREE.Vector3(p.x, p.y, p.z), null, 40);
    if (part.def.fatal) {
      this.game.hud.toast('DECAPITATED');
    } else if (part.def.leg) {
      this.game.hud.toast('DISMEMBERED');
    }
    if (part.def.fatal || part.def.leg) this.kill();
  }

  // Keeps live dummies on their feet with PD torques toward a pose, a hover force under the pelvis and a walk force.
  step(dt) {
    if (this.removed) return;
    if (this.alive) {
      if (this.stun > 0) {
        this.stun -= dt;
        this.recover = 0;
      } else {
        this.recover = Math.min(1, this.recover + dt * 0.8);
      }
    }
    const mode = this.game.settings.aiMode;
    if (!this.alive || this.stun > 0 || mode === 'limp') return;
    const strength = this.recover * this.recover;
    const chase = mode === 'chase';

    const pelvis = this.parts.pelvis.body;
    const pp = pelvis.translation();
    const player = this.game.player.position;
    const toPlayer = tmpV2.set(player.x - pp.x, 0, player.z - pp.z);
    const dist = toPlayer.length();
    const walking = chase && dist > 1.4;
    if (walking) this.phase += dt * 8;

    const swing = walking ? Math.sin(this.phase) * 0.55 : 0;
    relTargets.uLegL.setFromAxisAngle(X, -swing);
    relTargets.uLegR.setFromAxisAngle(X, swing);
    relTargets.lLegL.setFromAxisAngle(X, walking ? 0.15 + Math.max(0, Math.sin(this.phase)) * 0.6 : 0.05);
    relTargets.lLegR.setFromAxisAngle(X, walking ? 0.15 + Math.max(0, -Math.sin(this.phase)) * 0.6 : 0.05);
    const armLift = chase ? -1.35 : -0.05;
    relTargets.uArmL.setFromAxisAngle(X, armLift).multiply(tmpQ.setFromAxisAngle(Z, -0.12));
    relTargets.uArmR.setFromAxisAngle(X, armLift).multiply(tmpQ.setFromAxisAngle(Z, 0.12));
    relTargets.lArmL.setFromAxisAngle(X, chase ? -0.25 : -0.2);
    relTargets.lArmR.setFromAxisAngle(X, chase ? -0.25 : -0.2);

    // Joint PD on relative orientation; equal and opposite torques keep momentum balanced.
    for (const part of this.list) {
      if (!part.joint) continue;
      const pb = part.parent.body;
      const cb = part.body;
      const target = toQ(pb.rotation(), tmpQ).multiply(relTargets[part.def.name]);
      const err = target.multiply(toQ(cb.rotation(), tmpQ2).invert());
      const wc = cb.angvel();
      const wp = pb.angvel();
      const accel = axisAngle(err, tmpV)
        .multiplyScalar(120)
        .sub(new THREE.Vector3(wc.x - wp.x, wc.y - wp.y, wc.z - wp.z).multiplyScalar(14));
      clampLength(accel, 300);
      const impulse = accel.multiplyScalar(part.inertia * dt * strength);
      cb.applyTorqueImpulse(impulse, true);
      pb.applyTorqueImpulse(impulse.negate(), true);
    }

    // Upright + facing, applied to pelvis and chest with their own inertia.
    let yaw;
    if (chase && dist > 0.3) {
      yaw = Math.atan2(toPlayer.x, toPlayer.z);
    } else {
      const fwd = tmpV.copy(Z).applyQuaternion(toQ(pelvis.rotation(), tmpQ));
      yaw = Math.atan2(fwd.x, fwd.z);
    }
    for (const core of [this.parts.pelvis, this.parts.chest]) {
      const b = core.body;
      const err = tmpQ2.setFromAxisAngle(Y, yaw).multiply(toQ(b.rotation(), tmpQ).invert());
      const w = b.angvel();
      const accel = axisAngle(err, tmpV).multiplyScalar(90).sub(new THREE.Vector3(w.x, w.y, w.z).multiplyScalar(12));
      clampLength(accel, 200);
      b.applyTorqueImpulse(accel.multiplyScalar(core.icom * 6 * dt * strength), true);
    }

    // Support: cancel gravity on every part and spring the whole body toward standing height,
    // spreading impulses by mass so the joints are not strained.
    const hit = this.game.world.castRay(
      new RAPIER.Ray({ x: pp.x, y: pp.y, z: pp.z }, { x: 0, y: -1, z: 0 }),
      1.5, true, undefined, groups(ALL, G.WORLD | G.PROP),
    );
    if (!hit || hit.timeOfImpact > 1.4) return;
    const v = pelvis.linvel();
    const ay = clamp((1.0 - hit.timeOfImpact) * 60 - v.y * 10, -10, 25) + 9.81;
    let ax = 0, az = 0;
    if (walking) {
      toPlayer.normalize().multiplyScalar(1.8);
      ax = clamp((toPlayer.x - v.x) * 4, -8, 8);
      az = clamp((toPlayer.z - v.z) * 4, -8, 8);
    } else {
      ax = -v.x * 2;
      az = -v.z * 2;
    }
    const k = dt * strength;
    for (const part of this.list) {
      if (!connected(part)) continue;
      part.body.applyImpulse({ x: ax * part.mass * k, y: ay * part.mass * k, z: az * part.mass * k }, true);
    }
  }

  dispose() {
    if (this.removed) return;
    this.removed = true;
    for (const part of this.list) this.game.removeBody(part.body);
  }
}

function addFace(head) {
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const eyeGeo = new THREE.SphereGeometry(0.018, 8, 6);
  for (const x of [-0.04, 0.04]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(x, 0.02, 0.112);
    head.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.01), eyeMat);
  mouth.position.set(0, -0.045, 0.112);
  head.add(mouth);
}

function connected(part) {
  for (let p = part; p.parent; p = p.parent) if (!p.joint) return false;
  return true;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clampLength(v, max) {
  if (v.lengthSq() > max * max) v.setLength(max);
  return v;
}

function toQ(r, target) {
  return target.set(r.x, r.y, r.z, r.w);
}

// Rotation vector (axis * angle) along the shortest arc.
function axisAngle(q, target) {
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const s = Math.sqrt(1 - Math.min(1, q.w * q.w));
  if (s < 1e-5) return target.set(0, 0, 0);
  const angle = 2 * Math.acos(Math.min(1, q.w));
  return target.set(q.x / s, q.y / s, q.z / s).multiplyScalar(angle);
}
