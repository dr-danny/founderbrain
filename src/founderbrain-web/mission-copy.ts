/**
 * Shared mission labels and helpers used across the FounderBrain web shell.
 * Kept separate from React so rails, forms, and the app state machine can import
 * the same copy without pulling UI.
 */
export type Mission = "identity" | "customer" | "offer" | "context" | "voice" | "output";
type MissionSection = Exclude<Mission, "output">;

export const missionCopy: Record<Mission, { number: string; title: string; note: string }> = {
  identity: {
    number: "01",
    title: "Identity",
    note: "Name the venture, pick the track, and say what you are trying to change.",
  },
  customer: {
    number: "02",
    title: "Customer",
    note: "Who has the problem? Separate what you know from what you are testing.",
  },
  offer: {
    number: "03",
    title: "Offer",
    note: "Make the promise, the proof, and the next move concrete.",
  },
  context: {
    number: "04",
    title: "Channels",
    note: "Where you publish, your numbers today, and who you read. The 90-day plan projects from these.",
  },
  voice: {
    number: "05",
    title: "Voice",
    note: "Give the brain a useful tone, boundary, and sample.",
  },
  output: {
    number: "06",
    title: "First output",
    note: "Create and review one customer-interview invitation. Nothing is sent to customers.",
  },
};

export const missions: Mission[] = ["identity", "customer", "offer", "context", "voice", "output"];

export const stamp = (at: string | null) =>
  at
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(at))
    : "Not saved yet";

/**
 * Founder-facing names for the five Brain sections, used wherever a version or
 * a diff is shown (hub history, Brain panel). No internal jargon.
 */
export const sectionFounderNames: Record<MissionSection, string> = {
  identity: "Who you are",
  customer: "Who you serve",
  offer: "What you sell",
  voice: "How you sound",
  context: "Channels and numbers",
};

/** Founder-facing token count: 12403 -> "12.4k". */
export const compactTokens = (n: number) =>
  n < 1000 ? `${n}` : `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;

/** Founder-facing dollar figure from micro USD. */
export const compactUsd = (micro: number) => {
  const usd = micro / 1_000_000;
  return usd === 0 ? "$0.00" : `$${usd.toFixed(2)}`;
};
