/**
 * Question-index items for the first-run OrientationFlow, mirroring
 * `mission-index.ts`'s role for MissionTypeform: pure, testable mapping from
 * Brain + guide state to the shared QuestionIndexItem contract so
 * OrientationFlow can offer the same "jump to any question, see what's
 * missing" index the rest of the intake has.
 */
import { GUIDE_STEPS, type GuideSection, type GuideStep } from "../guide-intake";
import type { Brain } from "../types";
import type { QuestionIndexItem } from "../components/QuestionIndexModal";

const SECTION_LABEL: Record<GuideSection, string> = {
  identity: "About you",
  customer: "Customer",
  offer: "Offer",
  voice: "Voice",
  track: "Who you sell to",
};

/** A guide step's answered/required status, honest to `step.empty`/`step.optional`. */
export function guideStepStatus(brain: Brain, track: string | null, step: GuideStep) {
  return { required: !step.optional, answered: !step.empty(brain, track) };
}

export function guideIndexItems(params: {
  brain: Brain;
  track: string | null;
  /** Locally typed name, used to explain an answer that still needs saving. */
  name: string;
  /** Whether the welcome "ready to start?" screen has been answered either way. */
  readyAnswered: boolean;
  /** Whether the "do you have a website?" screen has been answered either way. */
  siteAnswered: boolean;
}): QuestionIndexItem[] {
  const { brain, track, name, readyAnswered, siteAnswered } = params;
  const items: QuestionIndexItem[] = [
    {
      id: "name",
      title: "What should we call you?",
      answered: Boolean(brain.identity.name.trim()),
      detail: name.trim() && !brain.identity.name.trim() ? "Save this name to finish answering the question." : undefined,
      required: true,
      group: "Welcome",
    },
    {
      id: "ready",
      title: "Ready to start?",
      answered: readyAnswered,
      // Nonblocking: it gates the guide, it is not itself a saved Brain field.
      required: false,
      group: "Welcome",
    },
    {
      id: "site-ask",
      title: "Do you have a website?",
      answered: siteAnswered,
      // Nonblocking: importing a site is optional, founders can always type instead.
      required: false,
      group: "Welcome",
      detail: "Optional: we can read your site instead of asking everything.",
    },
  ];
  for (const step of GUIDE_STEPS) {
    const status = guideStepStatus(brain, track, step);
    items.push({
      id: step.id,
      title: step.title,
      answered: status.answered,
      required: status.required,
      group: SECTION_LABEL[step.section],
    });
  }
  return items;
}

/** First required-but-unanswered item, or null when everything required is answered. */
export function firstMissingItem(items: QuestionIndexItem[]): QuestionIndexItem | null {
  return items.find((item) => item.required && !item.answered) ?? null;
}
