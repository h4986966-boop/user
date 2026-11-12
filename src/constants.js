// Collision group bits. Rapier packs groups as (membership << 16) | filter.
export const G = {
  WORLD: 1,
  RAGDOLL: 2,
  PLAYER: 4,
  PROP: 8,
  PROJECTILE: 16,
};
export const ALL = 0xffff;
export const groups = (member, filter = ALL) => (member << 16) | filter;

export const FIXED_DT = 1 / 60;
export const GRAVITY = -9.81;

export const TOOLS = [
  { id: 'grab', key: '1', name: 'Physgun', hint: 'LMB grab · RMB throw · wheel distance' },
  { id: 'gun', key: '2', name: 'Revolver', hint: 'LMB shoot · RMB shotgun blast' },
  { id: 'fist', key: '3', name: 'Fists', hint: 'LMB haymaker · RMB force push' },
  { id: 'launcher', key: '4', name: 'Launcher', hint: 'LMB rocket · RMB grenade' },
  { id: 'spawn', key: '5', name: 'Spawner', hint: 'LMB dummy · RMB crate' },
  { id: 'barrel', key: '6', name: 'Barrels', hint: 'LMB explosive barrel · RMB delete object' },
];
