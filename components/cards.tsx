// Presentational pieces built from the extracted card art (public/cards/*.webp).
// Everything keeps the printed double-line frames and rounded corners: the images are used as-is.

import type { ReactNode } from "react";
import type { Party, Policy, Role, Vote } from "@/lib/game";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const art = {
  role: (r: Role) => `/cards/role-${r}.webp`,
  party: (p: Party) => `/cards/party-${p}.webp`,
  tile: (p: Policy) => `/cards/tile-${p}.webp`,
  ballot: (v: Vote) => `/cards/ballot-${v === "ja" ? "ja" : "nein"}.webp`,
  cardBack: "/cards/card-back.webp",
  tileBack: "/cards/tile-back.webp",
};

const ALT = {
  role: { liberal: "Secret Role: Liberal", fascist: "Secret Role: Fascist", hitler: "Secret Role: Hitler" },
  party: { liberal: "Party Membership: Liberal", fascist: "Party Membership: Fascist" },
  tile: { liberal: "Liberal policy", fascist: "Fascist policy" },
} as const;

/** A two-faced card. The back is what you see by default; `up` turns it to reveal the front. */
export function Flip({
  up,
  front,
  back,
  className,
}: {
  up: boolean;
  front: ReactNode;
  back: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flip", className)} data-up={up}>
      <div className="flip-inner">
        <div className="flip-face">{back}</div>
        <div className="flip-face flip-front">{front}</div>
      </div>
    </div>
  );
}

/** Images fill their box unless the caller passes its own size classes. */
const FILL = "h-full w-full";
const sized = (className?: string) => cx("select-none", className ?? FILL);

export function TileImg({ policy, className }: { policy: Policy; className?: string }) {
  return <img src={art.tile(policy)} alt={ALT.tile[policy]} width={371} height={564} draggable={false} className={sized(className)} />;
}
export function TileBackImg({ className }: { className?: string }) {
  return <img src={art.tileBack} alt="Policy, face down" width={400} height={611} draggable={false} className={sized(className)} />;
}
export function RoleImg({ role, className }: { role: Role; className?: string }) {
  return <img src={art.role(role)} alt={ALT.role[role]} width={540} height={787} draggable={false} className={sized(className)} />;
}
export function PartyImg({ party, className }: { party: Party; className?: string }) {
  return (
    <img
      src={art.party(party)}
      alt={ALT.party[party]}
      width={520}
      height={735}
      draggable={false}
      className={cx(sized(className), "rounded-[3%] border border-ink/15")}
    />
  );
}
export function CardBackImg({ className }: { className?: string }) {
  return <img src={art.cardBack} alt="Card, face down" width={540} height={789} draggable={false} className={sized(className)} />;
}
export function BallotImg({ vote, className }: { vote: Vote; className?: string }) {
  return (
    <img
      src={art.ballot(vote)}
      alt={vote === "ja" ? "Ja!" : "Nein"}
      width={520}
      height={360}
      draggable={false}
      className={sized(className)}
    />
  );
}

/** Policy tile that flips face-up. Sized by its container (aspect 371:564). */
export function FlipTile({ policy, up, className }: { policy: Policy; up: boolean; className?: string }) {
  return (
    <Flip
      up={up}
      className={cx("aspect-[371/564]", className)}
      back={<TileBackImg />}
      front={<TileImg policy={policy} />}
    />
  );
}

// ---------------------------------------------------------------------------
// Miniature placards (made from type, so they stay crisp and legible at seat size).

/** President: Fraktur on a light, double-framed tag. */
export function PresidentPlacard({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center border-[3px] border-double border-brown bg-paper px-1.5 font-fraktur text-[14px] leading-[1.15] text-brown-deep",
        className,
      )}
    >
      President
    </span>
  );
}

/** Chancellor: a brown block with spaced white capitals. */
export function ChancellorPlacard({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-[3px] bg-brown-deep px-1.5 font-display text-[10px] font-semibold uppercase leading-[1.7] tracking-[0.2em] text-paper",
        className,
      )}
    >
      Chancellor
    </span>
  );
}

export function Skull({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cx("h-4 w-4 shrink-0", className)} fill="currentColor">
      <path
        fillRule="evenodd"
        d="M8 1C4.7 1 2.5 3.3 2.5 6.3c0 1.7.8 3 2 3.9V13h1.7v-1.2h1.1V13h1.4v-1.2h1.1V13h1.7v-2.8c1.2-.9 2-2.2 2-3.9C13.5 3.3 11.3 1 8 1ZM5.8 8.3a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm4.4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Z"
      />
    </svg>
  );
}

export function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cx("h-3 w-3 shrink-0", className)} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5l3.2 3L13 4.5" />
    </svg>
  );
}

export { cx };
