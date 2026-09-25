import { inviteCopy } from "@elixir-clan/engine";
import { CopyLine } from "./ActionCard.jsx";

const LEADERS = new Set(["leader", "coLeader"]);
const MIN_MEMBERS = 10;

/** What setting up a clan here turns on, in a member's words. */
const TURNS_ON = [
  "Actions for leaders, elders and members, each with its own log",
  "How it works here, and where everyone stands",
  "Awards and a trophy case for every member",
  "Welcomes, away notices and Clan Leader Messages ready to send",
];

/**
 * Spread the word (round 5, 2026-09-25): the one card on the clan page
 * that fits where the clan is. Below 10 members, Recruit helps it reach
 * 10. With 10 and no policy, a member or elder gets a line inviting the
 * leaders, and a leader gets the way to set it up. Once the policy is
 * active, anyone can bring clanmates in.
 */
export function SpreadWord({ me, clan, roster, navigate }) {
  const members = roster?.member_count ?? roster?.members?.length ?? null;
  const policy = me?.policy ?? null;
  const base = `/clan/${clan.clan_tag.slice(1)}`;
  const link = typeof window !== "undefined" ? window.location.origin : "";
  const go = (path) => (e) => {
    e.preventDefault();
    navigate?.(path);
  };
  const name = roster?.name ?? clan.name ?? null;

  if (members !== null && members < MIN_MEMBERS)
    return (
      <div className="panel mb-[18px]">
        <div className="panel__head">
          Clan management starts at {MIN_MEMBERS} members
        </div>
        <div className="panel__body grid gap-2">
          <p className="m-0">
            This clan has {members}. Until it has {MIN_MEMBERS}, Elixir Clan is
            your clan&rsquo;s statistics; Recruit writes the words to help it
            grow.
          </p>
          <a href={`${base}/recruit`} onClick={go(`${base}/recruit`)}>
            Open Recruit ›
          </a>
        </div>
      </div>
    );

  if (policy && !policy.set) {
    if (LEADERS.has(clan.role))
      return (
        <div className="panel mb-[18px]">
          <div className="panel__head">Set up how the clan runs</div>
          <div className="panel__body grid gap-2">
            <p className="m-0">
              Nothing in clan management runs until a leader saves a policy.
              Start from what the clan is for (a war clan, a social clan and so
              on) and tune from there. Saving it turns on:
            </p>
            <ul className="m-0 pl-[18px]">
              {TURNS_ON.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <a
              className="btn btn--primary w-fit"
              href={`${base}/manage/policy`}
              onClick={go(`${base}/manage/policy`)}
            >
              Set up the policy
            </a>
          </div>
        </div>
      );
    return (
      <div className="panel mb-[18px]">
        <div className="panel__head">Invite your leaders</div>
        <div className="panel__body grid gap-2">
          <p className="m-0">
            Your clan&rsquo;s leaders have not set it up here yet. When a leader
            or co-leader does, everyone gets:
          </p>
          <ul className="m-0 pl-[18px]">
            {TURNS_ON.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div className="label">A line for clan chat</div>
          <CopyLine
            text={inviteCopy("leaders", { clanName: name })}
            event="clan.invite_copied"
            value="leaders"
          />
          <div className="label">The link, for Discord or a message</div>
          <CopyLine text={link} event="clan.invite_copied" value="link" />
        </div>
      </div>
    );
  }

  if (policy?.active)
    return (
      <details className="panel mb-[18px]">
        <summary className="panel__head cursor-pointer">
          Bring your clanmates
        </summary>
        <div className="panel__body grid gap-2">
          <p className="m-0">
            Everyone in the clan can sign in with Elixir and see how the clan
            runs and where they stand.
          </p>
          <div className="label">A line for clan chat</div>
          <CopyLine
            text={inviteCopy("clanmates", { clanName: name })}
            event="clan.invite_copied"
            value="clanmates"
          />
          <div className="label">The link, for Discord or a message</div>
          <CopyLine text={link} event="clan.invite_copied" value="link" />
        </div>
      </details>
    );
  return null;
}
