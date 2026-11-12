import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { gridTexture, tiled } from './textures.js';

const SIZE = 80;

export function buildArena(game) {
  const { world, scene } = game;

  // Ground
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
  game.addCollider(RAPIER.ColliderDesc.cuboid(SIZE / 2, 1, SIZE / 2).setFriction(0.9), groundBody, { kind: 'world' });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshStandardMaterial({ map: tiled(gridTexture(), SIZE / 4, SIZE / 4), roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const wallTex = gridTexture('#d9822b', '#b86a1f', '#e89a4c');
  const darkTex = gridTexture('#4b5160', '#3c414d', '#5d6475');
  const blueTex = gridTexture('#3f7fbf', '#336aa1', '#5a96d1');

  // Outer walls
  const h = 5;
  staticBox(game, [0, h / 2, -SIZE / 2], [SIZE / 2, h / 2, 0.5], darkTex);
  staticBox(game, [0, h / 2, SIZE / 2], [SIZE / 2, h / 2, 0.5], darkTex);
  staticBox(game, [-SIZE / 2, h / 2, 0], [0.5, h / 2, SIZE / 2], darkTex);
  staticBox(game, [SIZE / 2, h / 2, 0], [0.5, h / 2, SIZE / 2], darkTex);

  // Tower with stairs: throw dummies off the top.
  const steps = 24, rise = 0.3, depth = 0.5;
  for (let i = 0; i < steps; i++) {
    const top = (i + 1) * rise;
    staticBox(game, [-17.5, top / 2, -4.25 - i * depth], [1.5, top / 2, depth / 2], wallTex);
  }
  const towerTop = steps * rise;
  staticBox(game, [-20, towerTop / 2, -20], [4, towerTop / 2, 4], wallTex);

  // Jump ramp
  const rampQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.32);
  staticBox(game, [16, 1.6, -8], [3, 0.3, 6], blueTex, rampQ);

  // Cover blocks and pillars
  staticBox(game, [-8, 1, 8], [1, 1, 3], blueTex);
  staticBox(game, [8, 0.6, 18], [3, 0.6, 1], blueTex);
  staticBox(game, [24, 3, 20], [1, 3, 1], darkTex);
  staticBox(game, [-26, 3, 18], [1, 3, 1], darkTex);

  // Spinning blender bar
  const spinBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(14, 0.9, 12).setAngvel({ x: 0, y: 2.2, z: 0 }),
  );
  game.addCollider(RAPIER.ColliderDesc.cuboid(4, 0.25, 0.25).setFriction(0.4), spinBody, { kind: 'world' });
  const spinMesh = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xd23b3b, roughness: 0.5, metalness: 0.3 }),
  );
  spinMesh.castShadow = true;
  scene.add(spinMesh);
  game.track(spinBody, spinMesh);
  const post = staticBox(game, [14, 0.3, 12], [0.4, 0.3, 0.4], darkTex);
  post.castShadow = true;

  // Wrecking ball on a ball joint
  const anchorPos = { x: 0, y: 14, z: -14 };
  const anchor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(anchorPos.x, anchorPos.y, anchorPos.z));
  const ballBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(9, 9.5, -14).setLinearDamping(0).setAngularDamping(0.2),
  );
  game.addCollider(RAPIER.ColliderDesc.ball(1.1).setDensity(2500).setFriction(0.3), ballBody, { kind: 'world' });
  const ropeLen = Math.hypot(9, 4.5);
  world.createImpulseJoint(
    RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: ropeLen, z: 0 }),
    anchor, ballBody, true,
  );
  // The spherical joint anchor is in the ball's local frame, so start it rotated to hang from the anchor.
  const dir = new THREE.Vector3(9, -4.5, 0).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  ballBody.setRotation(q, true);
  const ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.35, metalness: 0.8 }),
  );
  ballMesh.castShadow = true;
  scene.add(ballMesh);
  game.track(ballBody, ballMesh);
  const chainGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const chain = new THREE.Line(chainGeo, new THREE.LineBasicMaterial({ color: 0x222222 }));
  chain.frustumCulled = false;
  scene.add(chain);
  game.onRender.push(() => {
    const t = ballBody.translation();
    const pos = chainGeo.attributes.position;
    pos.setXYZ(0, anchorPos.x, anchorPos.y, anchorPos.z);
    pos.setXYZ(1, t.x, t.y, t.z);
    pos.needsUpdate = true;
  });
  staticBox(game, [0, 14.3, -14], [0.6, 0.3, 0.6], darkTex);
}

function staticBox(game, pos, half, tex, quat) {
  const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]);
  if (quat) desc.setRotation(quat);
  const body = game.world.createRigidBody(desc);
  game.addCollider(RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setFriction(0.9), body, { kind: 'world' });
  const rx = Math.max(1, (half[0] * 2) / 2);
  const ry = Math.max(1, (Math.max(half[1], half[2]) * 2) / 2);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2),
    new THREE.MeshStandardMaterial({ map: tiled(tex, rx, ry), roughness: 0.85 }),
  );
  mesh.position.set(...pos);
  if (quat) mesh.quaternion.copy(quat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  game.scene.add(mesh);
  return mesh;
}
