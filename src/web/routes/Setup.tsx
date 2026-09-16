/** @jsxRuntime automatic */
/**
 * src/web/routes/Setup.tsx
 *
 * WHAT IT IS
 * The setup checklist, and above it the one box that has to be filled in before anything
 * in this app can write a word: the founder's own Anthropic key.
 *
 * WHY THE KEY BOX IS FIRST, AND WHY IT IS NOT A ROW IN THE LIST.
 * It is the first thing a founder does after signing in, and until this screen existed
 * there was nowhere to do it at all. The start page told them to come here and paste a key,
 * and there was no field anywhere that took one. So this is not a checklist row among
 * others. Nothing below it can happen without it, and a founder who reads a tidy list of
 * five rows and starts at the top has started in the wrong place. It sits above the two
 * finish lines, with its own heading, and it says what it is for before it asks for
 * anything.
 *
 * THE CHECK IS THE PRODUCT HERE. A box that swallows whatever it is given would tell 130
 * people they are set up and let them find out in a live session. What happens instead is
 * that the key goes straight to Anthropic, twice, before it is stored: once to see whether
 * they accept it, once to see whether the account can actually write. A founder finds out
 * at the box they pasted into, with the paste still on their clipboard.
 *
 * THE KEY IS NEVER SHOWN BACK, and there is nothing on this screen that could. The server
 * sends a boolean, a character count and a date. What is typed is local state on this page
 * and is emptied the moment it is accepted. There is no reveal control and no masked
 * preview, because a masked preview is still a piece of a key on a screen in a room with
 * sixty four other people in it.
 *
 * WHY THE TWO FINISH LINES EXIST BELOW.
 * Onboarding goes out on 4 September. The GoHighLevel clinic is on 23 September, and the
 * cohort buys together on purpose so that nobody's trial expires during the weekend. So for
 * most of September the true state of most founders is "everything you can do is done", and
 * a single progress bar would tell 130 people they are 40 percent behind when they are not.
 * After that happens once, nobody reads the bar again.
 *
 * RULE 1. The rows come from `railRows`, which asks `apolloRowExists` before it builds the
 * Apollo row. A B2C founder has no Apollo row, no Apollo skip line, and no occurrence of
 * the word anywhere on this screen. The key box is on both tracks, because the key is.
 *
 * WHY THE STORAGE LIMITS PANEL SITS AT THE BOTTOM, ON ITS OWN.
 * Same reasoning as the key box, run the other way round. The key box is first because
 * nothing on this screen works without it. The three storage numbers are the opposite: this
 * machine already picked sensible ones the day it was set up, and nobody is blocked by them
 * until the day their folder actually gets close to one. Putting a panel like that above the
 * checklist, or inside either finish line, would tell a founder they have a fourth thing to
 * configure before Session 1, and that would be false. So it sits below both tiers, out of
 * the way of the two dates that actually matter, for the one founder in ten who ever opens
 * it.
 *
 * WHAT CALLS IT
 * app.tsx, on `#/setup`.
 *
 * WHAT IT READS AND WRITES
 * Reads the setup state and the storage limits. Writes the Anthropic key, through the three
 * calls in api.ts, and the storage limits, through `getLimits`/`saveLimits`. Every other row
 * links to the screen that does its own writing.
 */

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { StepState } from "../../../app/content/ghl-walk.ts";
import type {
  AnthropicKeyState,
  Founder,
  KeyProblem,
  KeyResult,
  LimitSource,
  LimitView,
  Problem,
  Result,
  SetupState,
  StorageLimits,
  StorageLimitsInput,
} from "../lib/api.ts";
import { checkAnthropicKey, forgetAnthropicKey, getLimits, saveAnthropicKey, saveLimits } from "../lib/api.ts";
import { hrefFor } from "../lib/nav.ts";
import { formatWhen } from "../lib/format.ts";
import { railRows, setupSummary } from "../lib/setup-rail.ts";
import type { RailRow } from "../lib/setup-rail.ts";
import { Notice } from "../components/Notice.tsx";
import { Working } from "../components/Working.tsx";

/** The five states, in the words a founder reads. A skip is not a failure and never red. */
export const STATE_WORDS: Readonly<Record<StepState, string>> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
  skipped: "Not yet",
  failed: "Needs a hand",
};

export function Setup({
  founder,
  setup,
  onSetupChanged,
}: {
  readonly founder: Founder;
  readonly setup: SetupState;
  /** Optional, so this screen can be rendered on its own in a test with no server behind it. */
  readonly onSetupChanged?: () => void;
}): ReactElement {
  const rows = railRows(setup, founder.track);
  const summary = setupSummary(rows);
  const [key, setKey] = useState<AnthropicKeyState>(setup.anthropic);

  return (
    <div className="page">
      <h1>Setup</h1>
      <p className="lede">One thing to paste, then two finish lines. You only need the first one to start.</p>

      <AnthropicKeyBox
        state={key}
        timezone={founder.timezone}
        onChanged={(next) => {
          setKey(next);
          onSetupChanged?.();
        }}
      />

      {/*
        The "done for now" notice is held back until the key is in. Without that guard it is
        the biggest lie this screen could tell: a founder who cannot make anything at all,
        reading that everything they can do is done.
      */}
      {summary.doneForNow && key.set ? (
        <Notice
          tone="good"
          title="You are done for now"
          lines={[
            "Everything setup asks for is done, GoHighLevel included. It is bought and connected in Session 2, on 14 or 15 September, and the clinic on 23 September assumes it is there.",
            "Nothing is late. Go back to your engines and keep writing.",
          ]}
        />
      ) : null}

      {summary.blocking.length === 0 ? null : (
        <Notice
          tone="problem"
          title="One thing needs a person"
          lines={[
            "This one does not sort itself out by waiting. Post in the Slack channel and somebody will pick it up today.",
            ...summary.blocking.map((row) => row.title),
          ]}
        />
      )}

      <Tier
        title="Ready to start"
        due="Before session 1"
        blocks="Everything"
        rows={rows.filter((r) => r.tier === "start")}
        // The key counts towards this finish line even though it is not a row in it. A tier
        // that ticks itself while the app cannot write is a tick nobody should trust.
        complete={summary.readyToStart && key.set}
      />

      <Tier
        title="Ready to publish"
        due="Session 2, 14 or 15 September. The clinic on 23 September assumes it is in place"
        blocks="Publishing and sending, and nothing else"
        rows={rows.filter((r) => r.tier === "publish")}
        complete={summary.readyToPublish}
      />

      <StorageLimitsPanel />
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Storage limits
// ---------------------------------------------------------------------------------------

type LimitKey = "fileBytes" | "totalBytes" | "fileCount";

/** What each limit is called, in plain words, and how a founder types a new number for it. */
const LIMIT_META: Readonly<Record<LimitKey, { readonly heading: string; readonly blurb: string; readonly unit: "bytes" | "count" }>> = {
  fileBytes: {
    heading: "The largest single file you can send",
    blurb: "This caps one upload or one message attachment at a time.",
    unit: "bytes",
  },
  totalBytes: {
    heading: "How large your whole folder can grow",
    blurb: "This is every file you have, added together, not any one of them on its own.",
    unit: "bytes",
  },
  fileCount: {
    heading: "The most files your folder can hold",
    blurb: "This counts every file you have, whatever size each one is.",
    unit: "count",
  },
};

/** A byte or file count, in the words a founder reads. Never a raw byte number. */
function limitWords(unit: "bytes" | "count", value: number): string {
  if (unit === "count") return `${value.toLocaleString("en-US")} files`;
  const gigabyte = 1024 * 1024 * 1024;
  const megabyte = 1024 * 1024;
  if (value >= gigabyte) {
    const gb = value / gigabyte;
    return `${gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`;
  }
  const mb = value / megabyte;
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/** What a founder reads about where the number in force came from. */
function sourceSentence(unit: "bytes" | "count", source: LimitSource, value: number, detected: number): string {
  if (source === "owner") return `You set this to ${limitWords(unit, value)}.`;
  if (source === "config") {
    return `An environment variable in your deployment sets this to ${limitWords(unit, value)}.`;
  }
  return `We measured what this machine can handle: up to ${limitWords(unit, detected)}. You have not set your own number.`;
}

/** The box's own text, from the last number the owner asked for, or empty for automatic. */
function typedFrom(unit: "bytes" | "count", requested: number | null): string {
  if (requested === null) return "";
  if (unit === "count") return String(requested);
  const mb = Math.round((requested / (1024 * 1024)) * 100) / 100;
  return String(mb);
}

type Typed = { readonly kind: "clear" } | { readonly kind: "invalid" } | { readonly kind: "value"; readonly raw: number };

/** What is typed in the box, turned into what the server needs, or a reason it cannot be. */
function parseTyped(unit: "bytes" | "count", text: string): Typed {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "clear" };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return { kind: "invalid" };
  if (unit === "count") return { kind: "value", raw: Math.round(n) };
  return { kind: "value", raw: Math.round(n * 1024 * 1024) };
}

/**
 * Three numbers, read once and changed rarely, so the whole panel is one box rather than
 * three. It fetches on its own rather than through `SetupState`, because these are the
 * founder's own choice about a machine, not a step in the checklist above.
 */
export function StorageLimitsPanel(): ReactElement {
  const [limits, setLimits] = useState<StorageLimits | null>(null);
  const [loadProblem, setLoadProblem] = useState<Problem | null>(null);

  useEffect(() => {
    let live = true;
    void getLimits().then((result) => {
      if (!live) return;
      if (result.ok) setLimits(result.value);
      else setLoadProblem(result.problem);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="tier">
      <div className="tier-head">
        <h2>Your storage limits</h2>
      </div>
      <p className="tier-meta">
        Three numbers govern how much this app will hold for you: the largest file you can send, how large your
        whole folder can grow, and the most files it can hold. This machine already picked sensible ones on its
        own. You only need to touch this if you want something different.
      </p>
      {loadProblem === null ? null : (
        <Notice tone="problem" title="We could not read your storage limits" lines={[loadProblem.text]} />
      )}
      {limits === null ? (
        loadProblem === null ? <Working what="Reading your storage limits." /> : null
      ) : (
        <>
          <LimitRow limitKey="fileBytes" view={limits.fileBytes} onSaved={setLimits} />
          <LimitRow limitKey="totalBytes" view={limits.totalBytes} onSaved={setLimits} />
          <LimitRow limitKey="fileCount" view={limits.fileCount} onSaved={setLimits} />
        </>
      )}
    </section>
  );
}

function LimitRow({
  limitKey,
  view,
  onSaved,
}: {
  readonly limitKey: LimitKey;
  readonly view: LimitView;
  readonly onSaved: (next: StorageLimits) => void;
}): ReactElement {
  const meta = LIMIT_META[limitKey];
  const [typed, setTyped] = useState<string>(() => typedFrom(meta.unit, view.requested));
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const apply = (body: StorageLimitsInput, nextTyped: string): void => {
    setWorking(true);
    setProblem(null);
    void saveLimits(body).then((result) => {
      setWorking(false);
      if (!result.ok) {
        setProblem(result.problem.text);
        return;
      }
      setTyped(nextTyped);
      onSaved(result.value);
    });
  };

  const save = (): void => {
    const parsed = parseTyped(meta.unit, typed);
    if (parsed.kind === "invalid") {
      setProblem("Enter a number greater than zero, or clear the box to go back to automatic.");
      return;
    }
    if (parsed.kind === "clear") {
      apply({ [limitKey]: null }, "");
      return;
    }
    apply({ [limitKey]: parsed.raw }, typedFrom(meta.unit, parsed.raw));
  };

  /** The obvious way back to automatic, for a founder who does not think to empty the box. */
  const resetToAutomatic = (): void => {
    apply({ [limitKey]: null }, "");
  };

  if (working) {
    return (
      <div className="limit-row">
        <h3 className="limit-row-title">{meta.heading}</h3>
        <Working what="Saving." />
      </div>
    );
  }

  return (
    <div className="limit-row">
      <h3 className="limit-row-title">{meta.heading}</h3>
      <p className="tier-meta">{meta.blurb}</p>
      <p className="tier-meta">{sourceSentence(meta.unit, view.source, view.value, view.detected)}</p>

      {/*
        THE SINGLE MOST IMPORTANT SENTENCE ON THIS PANEL. A number that moved away from what
        was typed, shown as though it was what was typed, is a lie by omission: see
        src/server/routes/limits.ts's own header on why the server never does that silently.
        This says what happened, in the two numbers a founder actually cares about.
      */}
      {view.clamped ? (
        <Notice
          tone="plain"
          lines={[
            `You asked for ${limitWords(meta.unit, view.requested ?? view.value)}. This machine can only manage ${limitWords(meta.unit, view.value)}, so that is what we set it to.`,
          ]}
        />
      ) : null}

      {/*
        AN IGNORED SETTING MUST NEVER BE INVISIBLE. An environment variable doing nothing,
        quietly, is a support ticket the day somebody else on the deployment goes looking for
        why it has no effect.
      */}
      {view.shadowedConfig === null ? null : (
        <Notice
          tone="plain"
          lines={[
            `Your deployment also has an environment variable set to ${limitWords(meta.unit, view.shadowedConfig)} for this. It is being ignored: your own setting above wins.`,
          ]}
        />
      )}

      {problem === null ? null : <Notice tone="problem" title="We could not save that" lines={[problem]} />}

      <label className="field">
        <span className="field-label">
          {meta.unit === "bytes" ? "Set it, in megabytes" : "Set the most files allowed"}
        </span>
        <input
          className="field-input"
          type="number"
          inputMode="decimal"
          min="0"
          step={meta.unit === "bytes" ? "0.1" : "1"}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Automatic"
        />
        <span className="field-note">
          Leave the box empty, or clear it, and this goes back to what this machine detects on its own.
        </span>
      </label>

      <p className="tier-meta">
        <button type="button" className="button button-small" onClick={save}>
          Save
        </button>{" "}
        <button type="button" className="button button-small button-quiet" onClick={resetToAutomatic}>
          Set back to automatic
        </button>
      </p>
    </div>
  );
}

/** What the box is doing. `confirming removal` is the second half of a two step remove. */
type KeyMode = "resting" | "working" | "confirming removal";

/**
 * The Anthropic key: what it is for, where to get one, and the box to paste it in.
 *
 * IT NAMES THE DOUBT BEFORE IT ASKS. The question a founder has in front of a box asking
 * for a key is always the same one and it is about money. So the answer is on the screen
 * before the field is, in the words they would use: yes it costs, it comes off your own
 * account, and the app holds a cap.
 *
 * THERE ARE TWO KINDS OF BAD NEWS HERE AND THEY ARE KEPT APART. Anthropic saying no is one
 * thing, and it arrives with a title, an action and often Anthropic's own sentence.  Not
 * reaching our own server is another, and it is usually the venue wifi. Showing the second
 * as if it were the first would send a founder to console.anthropic.com to fix their
 * connection.
 */
function AnthropicKeyBox({
  state,
  timezone,
  onChanged,
}: {
  readonly state: AnthropicKeyState;
  readonly timezone: string | null;
  readonly onChanged: (next: AnthropicKeyState) => void;
}): ReactElement {
  const [typed, setTyped] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [mode, setMode] = useState<KeyMode>("resting");
  const [problem, setProblem] = useState<KeyProblem | null>(null);
  const [reachUs, setReachUs] = useState<string | null>(null);

  /**
   * One answer from a key route, applied.
   *
   * THE STATE IS TAKEN FROM THE ANSWER, NEVER WORKED OUT HERE, and that is the whole of it.
   * A failed check may have thrown the stored key away or may have left it alone, depending
   * on whether Anthropic refused the key or was simply busy, and only the server knows
   * which. A screen that decided for itself would put a paste box in front of a founder
   * whose key is still stored and still working, on the day a rate limit happened to land.
   */
  const settle = (result: KeyResult): void => {
    setMode("resting");
    if (result.saved) {
      setProblem(null);
      // ONLY AFTER A SAVE THAT WORKED, so the next step appears for the founder who just
      // did the thing and not for one who opened this screen to look at it.
      setJustSaved(true);
      // Emptied here rather than on submit, so a founder whose key was refused still has
      // what they typed and can see for themselves that they pasted the short one.
      setTyped("");
    } else {
      setProblem(result.problem);
    }
    onChanged(result.anthropic);
  };

  /** Everything three of the four buttons do the same way: work, then settle or say why. */
  const run = (call: () => Promise<Result<KeyResult>>): void => {
    setMode("working");
    setProblem(null);
    setReachUs(null);
    void call().then((result) => {
      if (result.ok) settle(result.value);
      else {
        setMode("resting");
        setReachUs(result.problem.text);
      }
    });
  };

  const save = (): void => {
    run(() => saveAnthropicKey(typed));
  };

  const recheck = (): void => {
    run(() => checkAnthropicKey());
  };

  /** The fourth. It answers with nothing, so there is no state to take from it. */
  const remove = (): void => {
    setMode("working");
    setProblem(null);
    setReachUs(null);
    void forgetAnthropicKey().then((result) => {
      setMode("resting");
      if (result.ok) onChanged({ set: false, checkedAt: null, length: null });
      else setReachUs(result.problem.text);
    });
  };

  if (mode === "working") {
    return (
      <section className="tier">
        <h2>Your Anthropic key</h2>
        <Working what="Checking your key with Anthropic. This takes a few seconds." />
      </section>
    );
  }

  return (
    <section className="tier">
      <div className="tier-head">
        <h2>Your Anthropic key</h2>
        {state.set ? (
          <span className="chip chip-done">Done</span>
        ) : (
          <span className="chip chip-not_started">Needed now</span>
        )}
      </div>

      {reachUs === null ? null : <Notice tone="problem" title="We could not reach Launchhouse" lines={[reachUs]} />}

      {problem === null ? null : (
        <Notice tone="problem" title={problem.title} lines={[problem.whatToDo]}>
          {problem.vendorSaid === null ? null : (
            <p className="notice-line">Anthropic said: {problem.vendorSaid}</p>
          )}
        </Notice>
      )}

      {/*
        WHERE TO GO NEXT, SAID ONCE, HERE.

        A founder pasting this key is at the end of setting the app up. It worked, the
        screen showed a tick, and nothing told them that the next thing is to start
        building. They stayed on this screen, or wandered into the GoHighLevel walk,
        which is Session 2 and not theirs yet.

        The tick is not the instruction. This is.
      */}
      {justSaved ? (
        <Notice tone="plain" title="That is the app set up." lines={["Your key works and it is stored for you. Nothing else here is needed before Session 1."]}>
          <p className="notice-line">
            <a className="button" href={hrefFor({ kind: "home" })}>
              Go to your engines
            </a>
          </p>
        </Notice>
      ) : null}

      {state.set ? (
        mode === "confirming removal" ? (
          <div>
            <Notice
              tone="plain"
              title="Remove your key from this app?"
              lines={[
                "This app stops writing until you paste a key again. Nothing you have already made is affected.",
                "Removing our copy does not switch the key off at Anthropic. If you want it dead, delete it at console.anthropic.com afterwards.",
              ]}
            />
            <p className="tier-meta">
              <button type="button" className="button" onClick={remove}>
                Yes, remove it
              </button>{" "}
              <button type="button" className="button button-small" onClick={() => setMode("resting")}>
                Keep it
              </button>
            </p>
          </div>
        ) : (
          <div>
            <p className="tier-meta">
              Anthropic accepted it {formatWhen(state.checkedAt, timezone) || "already"}. It is{" "}
              {state.length === null ? "stored" : `${String(state.length)} characters long`}, and we never show a key
              back, so there is nothing here to read.
            </p>
            <p className="tier-meta">
              If a session ever tells you it could not finish, press Check it again. That says whether the key is the
              problem before you go looking anywhere else.
            </p>
            <p className="tier-meta">
              <button type="button" className="button" onClick={recheck}>
                Check it again
              </button>{" "}
              <button type="button" className="button button-small" onClick={() => setMode("confirming removal")}>
                Remove it
              </button>
            </p>
          </div>
        )
      ) : (
        <div>
          <p className="tier-meta">
            Everything this app writes is written by Claude, and Claude needs a key that belongs to you. A key is a long
            password that lets this app use your own Anthropic account. Nothing here works until it is in.
          </p>
          <p className="tier-meta">
            You are probably wondering whether this costs you money. It does. Anthropic charges your own account for
            what this app writes for you, and this app holds a spending cap so it cannot run away with it.
          </p>
          {/*
            A plain numbered list, on purpose. The `rail` class this screen uses elsewhere
            sets list-style to none and lays each row out as a two column grid with a rule
            above it, which is right for a checklist of things with a state and a button and
            wrong for four steps somebody follows in order. These need their numbers.
          */}
          <ol>
            <li>Open console.anthropic.com and sign in, or make an account.</li>
            <li>Go to Billing and add a payment method.</li>
            <li>Go to API keys, press Create Key, and copy the key.</li>
            <li>Paste it in the box below and press Save and check.</li>
          </ol>
          <label className="field">
            <span className="field-label">Paste your key here</span>
            <input
              className="field-input"
              /*
                A password field, because this is read in a room with sixty four other
                people in it. There is no control that reveals it: a founder does not need
                to read a key back, and the shoulder behind them does not need to either.
              */
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
          <p className="tier-meta">
            We check it with Anthropic the moment you press the button, so you find out here rather than in the middle
            of a session.
          </p>
          <button type="button" className="button" onClick={save}>
            Save and check
          </button>
        </div>
      )}
    </section>
  );
}

function Tier({
  title,
  due,
  blocks,
  rows,
  complete,
}: {
  readonly title: string;
  readonly due: string;
  readonly blocks: string;
  readonly rows: readonly RailRow[];
  readonly complete: boolean;
}): ReactElement {
  return (
    <section className={complete ? "tier tier-complete" : "tier"}>
      <div className="tier-head">
        <h2>{title}</h2>
        {complete ? <span className="chip chip-done">Done</span> : null}
      </div>
      <p className="tier-meta">
        Due: {due}. Holds up: {blocks}.
      </p>
      <ul className="rail">
        {rows.map((row) => (
          <li key={row.id} className={`rail-row rail-row-${row.state}`}>
            <div className="rail-row-main">
              <h3 className="rail-row-title">{row.title}</h3>
              <p className="rail-row-blurb">{row.blurb}</p>
            </div>
            <span className={`chip chip-${row.state}`}>{STATE_WORDS[row.state]}</span>
            {row.action === null ? null : (
              <a className="button button-small" href={row.href}>
                {row.action}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
