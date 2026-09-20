/**
 * src/founderbrain/copy-rules.ts
 *
 * A focused TypeScript port of the Launchhouse rules engine (vendored at
 * vendor/launchhouse-founder-template/.claude/scripts/rules.awk, itself ported
 * from Launchhousev2 src/server/rules). The full awk engine guards everything
 * a founder writes; this port guards only what WE generate: AI-written
 * GoHighLevel workflow copy in ghl-push.ts.
 *
 * Rules ported (Launchhouse's rule numbers):
 *   Rule 2 - no Instagram DM automation, ever (automation detection, with the
 *            inbound markers that make replying to people who wrote first
 *            legitimate).
 *   Rule 3 - B2B outreach is 25 messages, never promises replies
 *            (prose.promise-reply, with the cancellation window).
 *   Rule 1 - never write the other track's material (track.wrong-track-word,
 *            with the negation window).
 *   Reviewer hardening (template PR #13): data and credit claims are held
 *            until the founder confirms them - here, a number, price or
 *            percentage the Brain does not contain is held.
 *
 * Deliberately NOT ported: the label-context, house-style and inbox rules,
 * which guard human-written markdown files, not machine-generated copy. The
 * vendored awk engine remains the reference and the source of future ports.
 */

export type CopyFinding = {
  /** HOLD excludes the copy from the push; NOTE is informational only. */
  kind: "HOLD" | "NOTE";
  code: string;
  quote: string;
  reason: string;
};

const BOUNDARY = "(^|[^a-z0-9_])";
const END = "([^a-z0-9_]|$)";

/** Word-boundary wrapper matching the awk W() helper. */
function w(re: string): string {
  return `${BOUNDARY}(${re})${END}`;
}

const NEGATIONS =
  "(^|[^a-z'])(not|no|never|none|nobody|nothing|neither|nor|nowhere|cannot|without|hardly|avoid|stop|skip|omit|deny|wrong|dishonest|unfair|misleading|false|untrue|ban|forbid|prohibit|prevent|resist)";
const NEG_SUFFIX =
  "(refus|declin|overclaim|overpromis|n't|rather than|instead of|short of|other than|far from|no one)";

/** A promise of replies, in either word order. Ported from promise_at(). */
function promiseAt(c: string): RegExpMatchArray | null {
  return (
    c.match(
      /(guarantee[ds]?|guaranteeing|promise[ds]?|promising)( (you|them|your|their|a|an|at least|every|each|some|more|real|quick|fast))*( (you'll|you will|you|they'll|they will|they) get| get)? (repl(y|ies)|responses?)/,
    ) ??
    c.match(
      /(repl(y|ies)|responses?)( [a-z']+)? (are|is|will be|get|gets|come|comes)( [a-z']+)? (guaranteed|promised)/,
    )
  );
}

function cancelsBefore(s: string): boolean {
  return new RegExp(NEGATIONS).test(s) || new RegExp(NEG_SUFFIX).test(s);
}

/** Rule 3: never promise replies. Returns the held finding or null. */
export function promiseReplyHeld(sentence: string): CopyFinding | null {
  const lo = sentence.toLowerCase();
  if (!promiseAt(lo)) return null;
  const clauses = lo
    .replace(/[;:]/g, "|")
    .replace(/, (and|but|or|so|yet|then) /g, "|")
    .split("|");
  for (const c of clauses) {
    const m = promiseAt(c);
    if (!m || m.index === undefined) continue;
    const before = c.slice(0, m.index);
    // "Replies are not guaranteed" says the right thing.
    if (cancelsBefore(before) || cancelsBefore(m[0])) return null;
    if (cancelsBefore(c.slice(m.index)) || /that (guarantee|promise)|which (guarantee|promise)/.test(c)) {
      return {
        kind: "NOTE",
        code: "prose.promise-reply-unclear",
        quote: sentence,
        reason:
          "This may read as promising replies. Nothing promises a reply, because replies depend on the list, the offer and the timing.",
      };
    }
    return {
      kind: "HOLD",
      code: "prose.promise-reply",
      quote: sentence,
      reason:
        "This promises a reply. Nothing promises replies, because they depend on list quality, the offer and timing. Say what the work is instead.",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rule 2: no Instagram DM automation, ever. Automation is only for replying
// to people who wrote first, so inbound markers excuse the sentence.
// ---------------------------------------------------------------------------

const INBOUND_MARKERS = new RegExp(
  [
    "comment[ -](to|2)[ -]dm",
    "(messag[a-z]*|contacted|wr[io]te|dm[a-z']*) you first",
    "user[- ]initiated",
    "started the conversation",
    "(^|[^a-z])inbound",
    "triggered by",
    "keyword trigger",
    "opt(ed)?[- ]in",
    "messaging window",
    "24[- ]hour window",
    "repl[a-z]* to (their|the|a|every|each|any|incoming) (comment|message|dm|question|reply|story)",
    "who (comment|messag|dm|asked|replied|wrote)",
    "when they comment",
    "after they comment",
    "the moment they comment",
  ].join("|"),
);

const DM_AUTOMATION = new RegExp(
  [
    "(dm|message|messaging) automation",
    "auto[ -]?(dm|send|message|repl|respond)",
    `${w("bot|bots|chatbot|chatbots")}.*(send|dm|message|blast|fire|answer|repl|respond)`,
    `${w("bulk|mass|blast|blasts|drip")}.*(dm|message)`,
    "(while you sleep|on autopilot|set and forget|on your behalf|hands[- ]off|round the clock|24/7).*(send|dm|messag|deliver|go out|goes out|land)",
    "(send|dm|messag|deliver|goes? out|land)[a-z ]*(while you sleep|on autopilot|set and forget|on your behalf|hands[- ]off|round the clock|24/7)",
    "(send|dm|message|blast|fire)[a-z]*( it |them |the [a-z]+ )?(to |at )?(everyone|every new|all your|all of your|each new|whoever|anyone who)",
  ].join("|"),
);

/** Rule 2: automation may reply to inbound, never initiate. */
export function coldDmAutomationHeld(text: string): CopyFinding | null {
  const lo = text.toLowerCase();
  if (!DM_AUTOMATION.test(lo)) return null;
  if (INBOUND_MARKERS.test(lo)) return null;
  return {
    kind: "HOLD",
    code: "dm.automation-cold",
    quote: text,
    reason:
      "This reads as Instagram DM automation. Automated cold DMs get accounts restricted, and that cannot be undone. Automation is only for replying to people who wrote first.",
  };
}

// ---------------------------------------------------------------------------
// Rule 1: never write the other track's material.
// ---------------------------------------------------------------------------

const OTHER_TRACK_TERMS: Array<[RegExp, string]> = [
  [/outreach[- ]sequence/, "the outreach sequence"],
  [/outreach[- ]firstlines/, "the outreach first lines"],
  [new RegExp(w("apollo")), "Apollo"],
  [/\bICP\b/, "an ICP"],
  [/firmographic/, "firmographics"],
  [new RegExp(w("dkim|dmarc")), "DKIM and DMARC"],
  [new RegExp(w("cold emails?")), "cold email"],
  [/hook[- ]bank/, "the hook bank"],
  [/dm[- ]openers?/, "DM openers"],
  [/inbound[- ]scripts?/, "inbound scripts"],
];

/** Rule 1: the other track's method never appears in this track's copy. */
export function wrongTrackHeld(text: string, track: "b2b" | "b2c"): CopyFinding | null {
  const lo = text.toLowerCase();
  const other = track === "b2c" ? "B2B" : "B2C";
  for (const [re, label] of OTHER_TRACK_TERMS) {
    const m = lo.match(re);
    if (!m || m.index === undefined) continue;
    // "This is not cold email" says the right thing: a negation within three
    // words before the term cancels the hold.
    const before = lo.slice(Math.max(0, m.index - 24), m.index);
    if (cancelsBefore(before)) continue;
    return {
      kind: "HOLD",
      code: "track.wrong-track-word",
      quote: text,
      reason: `This uses ${label}, which is part of the ${other} method, and this founder is on the ${track.toUpperCase()} track. Never write, offer or mention the other track's material.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reviewer hardening: hold data and credit claims the Brain does not confirm.
// ---------------------------------------------------------------------------

const CLAIM = /(\$\s?\d[\d,.]*|\b\d+(?:\.\d+)?%|\b\d{2,}\+?(?:\.\d+)?%?)/g;

/**
 * Numbers, prices and percentages in generated copy must come from the Brain.
 * `brainJson` is the canonicalized Brain the copy was generated from; a claim
 * whose literal does not appear there is held until a human confirms it.
 */
export function unconfirmedClaimsHeld(text: string, brainJson: string): CopyFinding | null {
  const claims = text.match(CLAIM);
  if (!claims) return null;
  const unconfirmed = claims.filter((claim) => !brainJson.includes(claim.replace(/\s/g, "")));
  if (unconfirmed.length === 0) return null;
  return {
    kind: "HOLD",
    code: "proof.unconfirmed-claim",
    quote: text,
    reason: `This states ${unconfirmed.map((c) => `"${c.trim()}"`).join(", ")}, which the Brain does not confirm. Never invent proof; a real figure goes in the Brain first.`,
  };
}

/** Run every copy rule over one generated value. */
export function checkCopy(
  text: string,
  opts: { track: "b2b" | "b2c"; brainJson: string },
): CopyFinding[] {
  const held =
    promiseReplyHeld(text) ??
    coldDmAutomationHeld(text) ??
    wrongTrackHeld(text, opts.track) ??
    unconfirmedClaimsHeld(text, opts.brainJson);
  return held ? [held] : [];
}
