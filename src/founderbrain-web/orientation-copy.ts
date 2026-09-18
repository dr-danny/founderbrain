/**
 * Copy and screen definitions for first-login orientation and later chapters.
 * Keep inspirational, short, and free of live sessions / videos / self-host / Google Form.
 */
import type {
  ContentAnswers,
  FounderTrack,
  OrientationState,
  OutreachAnswers,
} from "../founderbrain-shared/orientation";
import {
  CONTENT_CHAPTER_SCREENS,
  ORIENTATION_FIRST_LOGIN_SCREENS,
  OUTREACH_CHAPTER_SCREENS,
} from "../founderbrain-shared/orientation";

export type TypeformChoice = { value: string; label: string };

export type TypeformScreen = {
  id: string;
  title: string;
  body: string[];
  bullets?: string[];
  /** Choice buttons; selecting one advances with that value. */
  choices?: TypeformChoice[];
  /** Free-text field key into chapter answers. */
  textField?: { key: string; label: string; placeholder: string };
  /** Confirm checkbox key into chapter answers. */
  confirm?: { key: string; label: string };
  continueLabel?: string;
};

export const firstLoginScreens: TypeformScreen[] = [
  {
    id: "expectations",
    title: "This is the prep.",
    body: [
      "You are not watching another demo. FounderBrain is how you get ready for Atlanta.",
      "Answer a few questions. Leave with a Brain that is still here when you come back.",
    ],
  },
  {
    id: "what",
    title: "Four missions. One Brain.",
    body: [
      "Identity, Customer, Offer, Voice. Then one private first output.",
      "Save as you go. Nothing is published or sent to customers.",
    ],
  },
  {
    id: "why",
    title: "Atlanta only works if the Brain is real.",
    body: [
      "Friday is Foundation. Saturday is content and outreach. Sunday is operations and a 90-day plan.",
      "The weekend is the event. This app is how you arrive ready.",
    ],
  },
  {
    id: "outcome",
    title: "What ready means",
    body: ["By the time you land in Atlanta you will have:"],
    bullets: [
      "A saved Founder Brain that survives refresh",
      "A named customer and offer, or an honest hypothesis",
      "A voice the engines can actually use",
      "One private artifact you have approved",
    ],
    continueLabel: "Start Identity",
  },
];

export function contentScreens(track: FounderTrack | null): TypeformScreen[] {
  const trackSetup: TypeformScreen =
    track === "b2c"
      ? {
          id: "instagram",
          title: "Instagram as Business",
          body: [
            "For consumer founders, set Instagram to a Business account before Atlanta.",
            "Mark it ready when it is done. Partial is fine — partial is not Green.",
          ],
          confirm: {
            key: "instagramBusiness",
            label: "Instagram is set to Business",
          },
        }
      : {
          id: "domain",
          title: "Email domain ready",
          body: [
            "For B2B founders, have a real email domain ready before Atlanta.",
            "Mark it ready when it is done. Partial is fine — partial is not Green.",
          ],
          confirm: {
            key: "domainReady",
            label: "Email domain is ready",
          },
        };

  return [
    {
      id: "content-intro",
      title: "Voice and content",
      body: [
        "After Voice is saved, this chapter is the rest of Saturday's content work.",
        "No videos. No outside checklist. Progress lives here.",
      ],
    },
    {
      id: "track",
      title: "B2B or B2C?",
      body: ["Pick the track that matches who you sell to. We will ask one setup question next."],
      choices: [
        { value: "b2b", label: "B2B — sell to businesses" },
        { value: "b2c", label: "B2C — sell to consumers" },
      ],
    },
    trackSetup,
    {
      id: "thirty",
      title: "Thirty pieces",
      body: [
        "Generate and edit thirty content pieces in FounderBrain once Voice is in place.",
        "Mark this when the draft set is edited, not when it is merely generated.",
      ],
      confirm: {
        key: "thirtyPieces",
        label: "Thirty pieces generated and edited",
      },
    },
    {
      id: "bottleneck",
      title: "Name the bottleneck",
      body: ["What slows content down for you right now? One honest sentence is enough."],
      textField: {
        key: "bottleneck",
        label: "Bottleneck",
        placeholder: "e.g. Editing takes longer than writing",
      },
    },
    {
      id: "workflow",
      title: "Pick a workflow",
      body: ["Choose how you will ship content through the weekend and the ninety days after."],
      choices: [
        { value: "batch-weekly", label: "Batch weekly, publish daily" },
        { value: "daily-draft", label: "Draft daily, edit same day" },
        { value: "pair-review", label: "Pair: I draft, partner reviews" },
      ],
    },
  ];
}

export function outreachScreens(track: FounderTrack | null): TypeformScreen[] {
  const listScreen: TypeformScreen =
    track === "b2c"
      ? {
          id: "accounts",
          title: "Twenty-five target accounts",
          body: [
            "Name twenty-five accounts you will actually reach.",
            "Mark ready when the list is real, not aspirational.",
          ],
          confirm: {
            key: "targetAccounts",
            label: "Twenty-five target accounts are listed",
          },
        }
      : {
          id: "prospects",
          title: "Prospect list",
          body: [
            "Finalise a B2B prospect list you can work on Saturday.",
            "Mark ready when names and emails are good enough to use.",
          ],
          confirm: {
            key: "prospectList",
            label: "Prospect list is ready",
          },
        };

  return [
    {
      id: "outreach-intro",
      title: "Outreach copy",
      body: [
        "Saturday is content and outreach. Finalise the copy the engines will reuse.",
        "Apollo and GoHighLevel stay weekend work — not a first-login setup here.",
      ],
      confirm: {
        key: "copyFinalised",
        label: "Outreach copy is finalised",
      },
    },
    listScreen,
    {
      id: "outreach-done",
      title: "Outreach chapter complete",
      body: [
        "You have the Saturday outreach artifacts in FounderBrain.",
        "Check Atlanta-ready on Home to see what is still partial.",
      ],
      continueLabel: "Back to Home",
    },
  ];
}

export const firstLoginTotal = ORIENTATION_FIRST_LOGIN_SCREENS;
export const contentTotal = CONTENT_CHAPTER_SCREENS;
export const outreachTotal = OUTREACH_CHAPTER_SCREENS;

export function progressLabel(screen: number, total: number): string {
  return `${screen} of ${total}`;
}

/** Dropped prep-guide delivery that must never appear in chapter copy. */
export const DROPPED_PREP_DELIVERY = [
  "live 90-minute",
  "session recording",
  "scribe",
  "youtube",
  "github import",
  "replit",
  "claude api",
  "google form",
  "watch then build",
  "self-host",
] as const;

export function chapterCopyCorpus(): string {
  const screens = [
    ...firstLoginScreens,
    ...contentScreens("b2b"),
    ...contentScreens("b2c"),
    ...outreachScreens("b2b"),
    ...outreachScreens("b2c"),
  ];
  return screens
    .flatMap((s) => [s.title, ...s.body, ...(s.bullets ?? []), s.continueLabel ?? ""])
    .join("\n")
    .toLowerCase();
}

export type ChapterKind = "first-login" | "content" | "outreach";

export function mergeContentAnswers(
  current: ContentAnswers,
  patch: Partial<ContentAnswers>,
): ContentAnswers {
  return { ...current, ...patch };
}

export function mergeOutreachAnswers(
  current: OutreachAnswers,
  patch: Partial<OutreachAnswers>,
): OutreachAnswers {
  return { ...current, ...patch };
}

export function orientationResumeScreen(state: OrientationState): number {
  if (state.firstLoginCompletedAt) return ORIENTATION_FIRST_LOGIN_SCREENS;
  return state.firstLoginScreen;
}
