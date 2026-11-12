import { TOOLS } from './constants.js';

export class Hud {
  constructor() {
    this.toolbar = document.getElementById('toolbar');
    this.status = document.getElementById('status');
    this.toasts = document.getElementById('toasts');
    this.hint = document.getElementById('hint');
    this.slots = TOOLS.map((t, i) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<span class="key">${t.key}</span>${t.name}`;
      this.toolbar.appendChild(el);
      el.dataset.index = i;
      return el;
    });
    this.setTool(0);
    this.lastStatus = '';
  }

  setTool(i) {
    this.slots.forEach((s, j) => s.classList.toggle('active', i === j));
    this.hint.textContent = TOOLS[i].hint;
  }

  toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), 1600);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  update(game) {
    const alive = game.ragdolls.filter((r) => r.alive).length;
    const s = game.settings;
    const text =
      `Dummies ${alive}/${game.ragdolls.length} · KOs ${game.stats.kills}` +
      ` · AI ${s.aiMode}` +
      ` · Gore ${s.gore ? 'on' : 'off'}` +
      (s.slowmo ? ' · SLOW-MO' : '');
    if (text !== this.lastStatus) {
      this.status.textContent = text;
      this.lastStatus = text;
    }
  }
}
