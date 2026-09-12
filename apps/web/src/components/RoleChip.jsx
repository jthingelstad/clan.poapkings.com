/** In-game role as a chip. Leadership is informational (accent), never
 *  gold: gold is brand and ownership, and the ★ on your own row already
 *  says what is yours. */
const TONE = {
  leader: "chip--info",
  coLeader: "chip--info",
  elder: "chip--ok",
  member: "",
};

export function RoleChip({ role, label }) {
  const tone = TONE[role] ?? "";
  return <span className={`chip ${tone}`.trim()}>{label ?? role}</span>;
}
