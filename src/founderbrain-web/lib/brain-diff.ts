/**
 * Pure field-level Brain compare used by the conflict dialog and history view.
 * Labels reuse mission copy section titles plus the form field names founders see.
 */
import type { Brain } from "../types";
import { missionCopy, type Mission } from "../mission-copy";

export interface BrainFieldDiff {
  section: string;
  sectionKey: Mission | "meta";
  field: string;
  label: string;
  left: string;
  right: string;
  changed: boolean;
}

const FIELD_LABELS: Record<string, Record<string, string>> = {
  identity: {
    name: "Your name",
    venture: "Venture",
    role: "Role",
    stage: "Stage",
    track: "Track",
    hybrid: "Genuinely both",
    model: "Model",
    goal: "What needs to change?",
    approved: "Approved",
  },
  customer: {
    segment: "Customer segment",
    buyer: "Who you actually sell to",
    trigger: "What triggers them",
    bestFit: "Three best-fit customers",
    attention: "Where they spend attention",
    adjacent: "Adjacent purchases",
    problem: "Problem",
    outcome: "Desired outcome",
    workaround: "Current workaround",
    evidenceStatus: "Evidence status",
    evidence: "Evidence",
    approved: "Approved",
  },
  offer: {
    description: "Offer",
    delivery: "Delivery",
    outcome: "Outcome",
    why: "Why you, not the obvious alternative",
    pricingModel: "Pricing model",
    price: "Price or pricing frame",
    proof: "Proof",
    cta: "Call to action",
    approved: "Approved",
  },
  voice: {
    tone: "Tone",
    boundaries: "Boundaries",
    sample: "Sample",
    approved: "Approved",
  },
  context: {
    channelsActive: "Channels you publish on today",
    channelsDormant: "Dormant accounts",
    emailProvider: "Work email provider",
    domainStatus: "Sending domain status",
    igAccountType: "Instagram account type",
    customersNow: "Customers now",
    avgMonthlyValue: "Average monthly value",
    target90: "Target in 90 days",
    sourceMaterial: "Source material",
    approved: "Approved",
  },
};

function display(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined) return "";
  return String(value);
}

function sectionTitle(key: Mission | "meta"): string {
  if (key === "meta") return "Meta";
  return missionCopy[key].title;
}

/** Build a per-field table comparing two Brains. Schema keys are walked in form order. */
export function diffBrains(left: Brain, right: Brain): BrainFieldDiff[] {
  const rows: BrainFieldDiff[] = [];

  rows.push({
    section: sectionTitle("meta"),
    sectionKey: "meta",
    field: "schemaVersion",
    label: "Schema version",
    left: display(left.schemaVersion),
    right: display(right.schemaVersion),
    changed: left.schemaVersion !== right.schemaVersion,
  });

  for (const section of ["identity", "customer", "offer", "context", "voice"] as const) {
    const labels = FIELD_LABELS[section]!;
    const leftSection = left[section] as Record<string, unknown>;
    const rightSection = right[section] as Record<string, unknown>;
    for (const field of Object.keys(labels)) {
      const leftValue = display(leftSection[field]);
      const rightValue = display(rightSection[field]);
      rows.push({
        section: sectionTitle(section),
        sectionKey: section,
        field,
        label: labels[field]!,
        left: leftValue,
        right: rightValue,
        changed: leftValue !== rightValue,
      });
    }
  }

  return rows;
}

export function changedCount(rows: BrainFieldDiff[]): number {
  return rows.filter((row) => row.changed).length;
}
