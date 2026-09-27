import { present, type Brain, type MissionSection } from "../types";

/** Mirrors shared approval requirements; other questions remain optional and navigable. */
const requiredFields: Record<MissionSection, readonly string[]> = {
  identity: ["name", "venture", "role", "goal"],
  customer: ["segment", "problem", "outcome"],
  offer: ["description", "delivery", "outcome", "cta"],
  context: ["channelsActive", "customersNow", "target90"],
  voice: ["tone", "boundaries", "sample", "sampleCount"],
};

export function missionFieldStatus(brain: Brain, section: MissionSection, field: string) {
  const required = requiredFields[section].includes(field) ||
    (section === "customer" && field === "evidence" && brain.customer.evidenceStatus === "supported");
  const value = (brain[section] as unknown as Record<string, unknown>)[field];
  const answered = field === "sampleCount" ? Number(value) >= 10 :
    typeof value === "boolean" ? true : typeof value === "string" && present(value);
  return { required, answered };
}

export function missingMissionFields(brain: Brain, section: MissionSection): string[] {
  const fields = [...requiredFields[section]];
  if (section === "customer" && brain.customer.evidenceStatus === "supported") fields.push("evidence");
  return fields.filter((field) => !missionFieldStatus(brain, section, field).answered);
}

/** Business-profile card covers Identity, Customer, and Offer. Open the first unfinished one. */
export function profileResumeMission(readiness: {
  identity: boolean;
  customer: boolean;
  offer: boolean;
}): MissionSection {
  if (!readiness.identity) return "identity";
  if (!readiness.customer) return "customer";
  if (!readiness.offer) return "offer";
  return "identity";
}

/** First missing required question, or the confirm screen when the section can be approved. */
export function resumeQuestion(brain: Brain, section: MissionSection): string {
  return missingMissionFields(brain, section)[0] ?? "confirm";
}
