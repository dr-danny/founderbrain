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
