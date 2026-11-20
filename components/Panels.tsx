"use client";

// The three small sheets: public game log, rules summary, and the menu.

import { useEffect, useRef, useState } from "react";
import type { GameView, RoomView } from "@/lib/game";
import { audio, useAudioSettings } from "@/lib/client/audio";
import sources from "@/data/audio-sources.json";
import { cx } from "./cards";
import { Sheet } from "./Sheet";

export function LogSheet({ game, onClose }: { game: GameView; onClose: () => void }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, []);
  return (
    <Sheet label="Game log" onClose={onClose}>
      <ol className="flex flex-col gap-1.5 text-[13px]">
        {game.log.map((l) => (
          <li
            key={l.n}
            className={cx(
              "border-l-[3px] py-0.5 pl-2.5",
              l.policy === "fascist" ? "border-fas-frame" : l.policy === "liberal" ? "border-lib-frame" : l.kind === "vote" ? "border-brown" : "border-ink/15",
              l.kind === "end" && "font-semibold",
            )}
          >
            {l.text}
          </li>
        ))}
        <li ref={end} aria-hidden="true" />
      </ol>
    </Sheet>
  );
}

const P = ({ lead, children }: { lead: string; children: React.ReactNode }) => (
  <p>
    <strong className="font-semibold">{lead}</strong> {children}
  </p>
);

export function RulesSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet label="Rules" onClose={onClose}>
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
        <P lead="Win.">
          Liberals win with five Liberal policies, or by executing Hitler. Fascists win with six Fascist policies, or by electing Hitler Chancellor after the third Fascist policy.
        </P>
        <P lead="Secret roles.">
          Fascists know each other and Hitler. Hitler knows the Fascist only in games of 5–6 players. Liberals know nothing. Everyone may lie, except Hitler when elected or executed.
        </P>
        <P lead="Election.">
          The President nominates a Chancellor. The last elected Chancellor can&rsquo;t be nominated, nor can the last elected President (unless only five players are alive). Every living player votes Ja! or Nein, candidates too. A tie fails.
        </P>
        <P lead="Chaos.">
          Three failed governments in a row: the top policy is enacted, its power ignored, the tracker resets and term limits are forgotten. After three Fascist policies, a Chancellor who gets elected is known not to be Hitler.
        </P>
        <P lead="Legislative session.">
          The President draws three policies and discards one. The Chancellor takes the other two, discards one and enacts the last. Don&rsquo;t talk during the session; afterwards you may say anything, true or not. Discards are never shown.
        </P>
        <P lead="Veto.">
          After five Fascist policies the Chancellor may ask to veto. If the President agrees, both policies are discarded and the tracker advances. If not, the Chancellor must enact.
        </P>
        <P lead="Powers.">
          A Fascist policy may unlock a power the President must use. 5–6 players: third policy Policy Peek; fourth and fifth Execution. 7–8: second Investigate, third Special Election, then Execution twice. 9–10: first and second Investigate, third Special Election, then Execution twice.
        </P>
        <P lead="Investigate.">
          Learn a player&rsquo;s Party Membership, never their role. Nobody is investigated twice.
        </P>
        <P lead="Special Election.">
          Pick any other player as the next Presidential Candidate. The rotation then resumes to the left of the President who called it.
        </P>
        <P lead="Execution.">
          Killing Hitler wins for the Liberals. Otherwise the table is not told what the player was. The dead may not speak, vote or run.
        </P>
      </div>
    </Sheet>
  );
}

export function CreditsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet label="Credits" onClose={onClose}>
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
        <p>
          <strong className="font-semibold">Secret Hitler</strong> is by Mike Boxleiter, Tommy Maranges and Mac Schubert (Goat, Wolf &amp; Cabbage),{" "}
          <a className="underline underline-offset-2" href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noreferrer">
            CC BY-NC-SA 4.0
          </a>
          .
        </p>
        <p className="font-semibold">Music and sound</p>
        <ul className="flex flex-col gap-2.5">
          {sources.map((s) => (
            <li key={s.key} className="border-l-[3px] border-ink/15 pl-2.5">
              <a className="underline underline-offset-2" href={s.page} target="_blank" rel="noreferrer">
                {s.title}
              </a>{" "}
              by {s.author},{" "}
              <a className="underline underline-offset-2" href={s.licenseUrl} target="_blank" rel="noreferrer">
                {s.license}
              </a>
              <span className="block text-ink-soft">{s.use}</span>
            </li>
          ))}
        </ul>
        <p className="text-ink-soft">The bells, pings, stamps, rumbles and the Hitler-zone swell are synthesised for this project. Sources are layered, trimmed and loudness-matched.</p>
      </div>
    </Sheet>
  );
}

/** Music / Effects toggles and the volume slider. The first tap on a toggle is what lets the browser play sound. */
export function SoundControls() {
  const sound = useAudioSettings();
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
          <button type="button" className={cx("btn", sound.music && "btn-primary")} aria-pressed={sound.music} onClick={() => audio.setMusic(!sound.music)}>
            Music: {sound.music ? "on" : "off"}
          </button>
          <button type="button" className={cx("btn", sound.effects && "btn-primary")} aria-pressed={sound.effects} onClick={() => audio.setEffects(!sound.effects)}>
            Effects: {sound.effects ? "on" : "off"}
          </button>
        </div>
      <label className="flex min-h-[44px] items-center gap-3 text-[13px]">
          <span className="w-16 shrink-0 font-display text-[13px] font-bold uppercase tracking-[0.14em]">Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(sound.volume * 100)}
            onChange={(e) => audio.setVolume(Number(e.target.value) / 100)}
            onPointerUp={() => void audio.cue("tap")}
            aria-label="Volume"
            className="h-11 flex-1 cursor-pointer accent-ink"
          />
        </label>

    </div>
  );
}

export function SoundSheet({ onClose, onCredits }: { onClose: () => void; onCredits: () => void }) {
  return (
    <Sheet label="Sound" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <SoundControls />
        <button type="button" className="btn btn-quiet" onClick={onCredits}>
          Credits
        </button>
      </div>
    </Sheet>
  );
}

export function MenuSheet({
  view,
  pending,
  onClose,
  onRules,
  onCredits,
  act,
}: {
  view: RoomView;
  pending: boolean;
  onClose: () => void;
  onRules: () => void;
  onCredits: () => void;
  act: (a: { type: "playAgain" } | { type: "endGame" }) => Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const link = typeof window === "undefined" ? "" : `${window.location.origin}/${view.code}`;
  return (
    <Sheet label="Menu" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <button type="button" className="btn" onClick={onRules}>
          Rules
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              window.prompt("Copy this link", link);
            }
          }}
        >
          {copied ? "Link copied" : "Copy invite link"}
        </button>

        <SoundControls />

        <button type="button" className="btn btn-quiet" onClick={onCredits}>
          Credits
        </button>

        {view.me.isHost && (
          <>
            <button type="button" className="btn" disabled={pending} onClick={async () => (await act({ type: "playAgain" })) && onClose()}>
              Play again, same players
            </button>
            {confirmEnd ? (
              <button type="button" className="btn btn-danger" disabled={pending} onClick={async () => (await act({ type: "endGame" })) && onClose()}>
                Sure? End the game
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirmEnd(true)}>
                End the game
              </button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
