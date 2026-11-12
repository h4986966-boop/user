import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';
import { Game } from './game.js';
import { Hud } from './hud.js';

const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start');

RAPIER.init().then(() => {
  const hud = new Hud();
  const game = new Game(document.getElementById('app'), hud);
  window.game = game; // handy for debugging in the console
  const canvas = game.renderer.domElement;
  startBtn.textContent = 'Click to play';
  startBtn.disabled = false;

  const lock = () => {
    game.sfx.unlock();
    canvas.requestPointerLock();
  };
  startBtn.addEventListener('click', lock);
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) lock();
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    overlay.classList.toggle('hidden', locked);
    if (!locked) {
      game.player.keys.clear();
      game.tools.release();
    }
  });

  const locked = () => document.pointerLockElement === canvas;
  document.addEventListener('mousemove', (e) => {
    if (locked()) game.player.look(e.movementX, e.movementY);
  });
  document.addEventListener('mousedown', (e) => {
    if (locked()) game.tools.onDown(e.button);
  });
  document.addEventListener('mouseup', (e) => {
    if (locked()) game.tools.onUp(e.button);
  });
  document.addEventListener('wheel', (e) => {
    if (locked()) game.tools.onWheel(e.deltaY);
  }, { passive: true });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    if (!locked()) return;
    game.player.keys.add(e.code);
    if (e.repeat) return;
    if (e.code.startsWith('Digit')) game.tools.select(Number(e.code.slice(5)) - 1);
    else if (e.code === 'KeyQ') game.toggleSlowmo();
    else if (e.code === 'KeyG') game.toggleGore();
    else if (e.code === 'KeyF') game.cycleAi();
    else if (e.code === 'KeyR') game.reset();
    else if (e.code === 'KeyC') {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        const p = game.player.position;
        game.spawnRagdoll(p.clone().set(p.x + Math.sin(a) * 9, 0.02, p.z + Math.cos(a) * 9), a + Math.PI);
      }
      game.hud.toast('WAVE INCOMING');
    }
    if (e.code === 'Space') e.preventDefault();
  });
  document.addEventListener('keyup', (e) => game.player.keys.delete(e.code));
});
