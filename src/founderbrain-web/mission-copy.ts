/**
 * Shared mission labels and helpers used across the FounderBrain web shell.
 * Kept separate from React so rails, forms, and the app state machine can import
 * the same copy without pulling UI.
 */
export type Mission = "identity" | "customer" | "offer" | "voice" | "output";

export const missionCopy: Record<Mission, { number: string; title: string; note: string }> = {
  identity: {
    number: "01",
    title: "Identity",
    note: "Name the venture and what you are trying to change.",
  },
  customer: {
    number: "02",
    title: "Customer",
    note: "Who has the problem? Separate what you know from what you are testing.",
  },
  offer: {
    number: "03",
    title: "Offer",
    note: "Make the promise and the next move concrete.",
  },
  voice: {
    number: "04",
    title: "Voice",
    note: "Give the brain a useful tone, boundary, and sample.",
  },
  output: {
    number: "05",
    title: "First output",
    note: "Create and review one customer-interview invitation. Nothing is sent to customers.",
  },
};

export const missions: Mission[] = ["identity", "customer", "offer", "voice", "output"];

export const stamp = (at: string | null) =>
  at
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(at))
    : "Not saved yet";
