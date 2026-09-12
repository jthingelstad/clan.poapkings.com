/**
 * In-game role is the app role. The roster's vocabulary is the CR API's
 * (`leader`, `coLeader`, `elder`, `member`); the UI's is English. This is
 * the one place the two meet, and the API stamps `role_label` on every
 * answer so the browser never has to know the API spelling.
 */

export const ROLE_ORDER = ["leader", "coLeader", "elder", "member"];

const LABELS = {
  leader: "Leader",
  coLeader: "Co-leader",
  elder: "Elder",
  member: "Member",
};

export function roleLabel(role) {
  return LABELS[role] ?? (role ? String(role) : "Member");
}

/** Sort key: leadership first, then by the caller's secondary. */
export function roleRank(role) {
  const i = ROLE_ORDER.indexOf(role);
  return i === -1 ? ROLE_ORDER.length : i;
}
