import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ALL, G, groups } from './constants.js';

const HALF = 0.55;
const RADIUS = 0.35;
const EYE = 0.72;

export class Player {
  constructor(game, spawn) {
    this.game = game;
    this.spawn = spawn.clone();
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.knock = new THREE.Vector3();
    this.grounded = false;
    this.keys = new Set();
    this.position = new THREE.Vector3().copy(spawn);
    this.ignore = new Set();

    const { world } = game;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + HALF + RADIUS, spawn.z),
    );
    this.collider = game.addCollider(
      RAPIER.ColliderDesc.capsule(HALF, RADIUS).setCollisionGroups(groups(G.PLAYER, ALL & ~G.PROJECTILE)),
      this.body,
      { kind: 'player' },
    );
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.45, 0.2, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(80);
    this.filter = (c) => !this.ignore.has(c.handle) && !(c.collisionGroups() >> 16 & G.PROJECTILE);
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * 0.0022));
  }

  // dt is real time so the player keeps full speed during slow motion.
  step(dt) {
    const k = this.keys;
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const speed = k.has('ShiftLeft') ? 9.5 : 5.5;
    const move = new THREE.Vector3(s, 0, -f);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    if (this.grounded && k.has('Space')) this.vy = 7;
    this.vy -= 20 * dt;
    this.knock.multiplyScalar(Math.pow(0.05, dt));

    const desired = {
      x: (move.x + this.knock.x) * dt,
      y: (this.vy + this.knock.y) * dt,
      z: (move.z + this.knock.z) * dt,
    };
    this.controller.computeColliderMovement(this.collider, desired, undefined, undefined, this.filter);
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = 0;
    if (desired.y > 0 && m.y < desired.y * 0.5) this.vy = Math.min(this.vy, 0);

    const t = this.body.translation();
    let nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;
    if (ny < -20) {
      nx = this.spawn.x; ny = this.spawn.y + HALF + RADIUS; nz = this.spawn.z;
      this.vy = 0;
      this.knock.set(0, 0, 0);
    }
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.position.set(nx, ny - HALF - RADIUS, nz);
  }

  updateCamera(camera, shake) {
    const t = this.body.translation();
    camera.position.set(t.x, t.y + EYE, t.z);
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
    }
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  reset() {
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y + HALF + RADIUS, z: this.spawn.z }, true);
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.knock.set(0, 0, 0);
  }
}
