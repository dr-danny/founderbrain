/**
 * FounderBrain app state machine: auth/session, workspace load, save/conflict,
 * jobs, and handlers. Presentation stays in app.tsx + ./components.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, FounderBrainApi } from "./api";
import { createHexclave, type HexclaveSession } from "./hexclave";
import {
  emptyBrain,
  sectionWouldApprove,
  type Artifact,
  type Brain,
  type BrainState,
  type Config,
  type HistoryItem,
  type Job,
  type MissionSection,
} from "./types";
import {
  PENDING_JOB_STORAGE_KEY,
  nextSaveOperation,
  patchBrain,
  settleSaveDecision,
} from "./lib/brain-draft";
import {
  JOB_POLL_DEADLINE_MS,
  JOB_POLL_INITIAL_WAIT_MS,
  interpretJobStatus,
  interpretPollTimeout,
  nextPollWaitMs,
  stillRunningNotice,
  unresolvedJobNotice,
} from "./lib/job-poll";
import { type Mission } from "./mission-copy";
import { type View } from "./components/MissionRail";
import {
  emptyOrientationState,
  isFirstLoginComplete,
  GHL_CHAPTER_SCREENS,
  type OrientationPatch,
  type OrientationState,
} from "../founderbrain-shared/orientation";

export function useFounderBrainApp() {
  const [config, setConfig] = useState<Config | null>(null);
  // Sign-in state is four things: which mode we are in (config), whether Hexclave has a
  // session for this browser (session: undefined while asking, null when signed out),
  // whether the API accepted that session (email), and whether it has since lapsed
  // (sessionExpired). The Hexclave SDK holds the refresh token; we never store a token.
  const [session, setSession] = useState<HexclaveSession | null | undefined>(undefined);
  const [email, setEmail] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [demoEntered, setDemoEntered] = useState(false);
  const [state, setState] = useState<BrainState | null>(null);
  const [draft, setDraft] = useState<Brain>(emptyBrain());
  const [orientation, setOrientation] = useState<OrientationState | null>(null);
  const [orientationSaving, setOrientationSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [view, setView] = useState<View>("atlanta");
  const [mission, setMission] = useState<Mission>("identity");
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [comparison, setComparison] = useState<BrainState | null>(null);
  const [conflict, setConflict] = useState<BrainState | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [artifactText, setArtifactText] = useState("");
  const [artifactStale, setArtifactStale] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationRetry, setGenerationRetry] = useState(false);
  const [acceptRetry, setAcceptRetry] = useState(false);
  const [jobNeedsReconcile, setJobNeedsReconcile] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const latestDraft = useRef(draft);
  const sessionEpoch = useRef(0);
  const oauthHandled = useRef(false);
  const saveOperation = useRef<{ brain: Brain; expectedVersion: number; key: string } | null>(null);
  const jobOperation = useRef<{ expectedVersion: number; key: string } | null>(null);
  const acceptOperation = useRef<{
    id: string;
    text: string;
    expectedVersion: number;
    key: string;
  } | null>(null);
  const closeConflict = useRef<HTMLButtonElement | null>(null);
  const hexclave = useMemo(
    () => (config?.hexclave ? createHexclave(config.hexclave) : null),
    [config],
  );
  const api = useMemo(() => {
    if (!config) return null;
    if (config.authMode === "local-demo") return new FounderBrainApi(null, true);
    return session ? new FounderBrainApi(session.getToken) : null;
  }, [config, session]);
  const friendlyError = (err: unknown) => {
    if (err instanceof ApiError && err.code === "session_expired") setSessionExpired(true);
    return err instanceof ApiError
      ? err.message
      : "Something went wrong. Your draft has not been discarded.";
  };
  const jobStorage = PENDING_JOB_STORAGE_KEY;
  const clearPrivate = () => {
    sessionEpoch.current += 1;
    saveOperation.current = null;
    jobOperation.current = null;
    acceptOperation.current = null;
    window.sessionStorage.removeItem(jobStorage);
    setState(null);
    setOrientation(null);
    setOrientationSaving(false);
    latestDraft.current = emptyBrain();
    setDraft(latestDraft.current);
    setChanged(false);
    setHistory([]);
    setComparison(null);
    setConflict(null);
    setArtifact(null);
    setArtifactText("");
    setArtifactStale(false);
    setGenerating(false);
    setGenerationRetry(false);
    setAcceptRetry(false);
    setJobNeedsReconcile(false);
    setDeleteOpen(false);
    setDeleteText("");
  };

  useEffect(() => {
    void (async () => {
      try {
        setConfig(await new FounderBrainApi().config());
      } catch {
        setError("FounderBrain configuration is unavailable. Try again shortly.");
      }
    })();
  }, []);
  // Ask Hexclave whether this browser is signed in. On the way back from the hosted sign-in
  // page this is also what completes the sign-in. Failure to reach Hexclave is not "signed
  // out": it is shown as an error so nobody is bounced to a sign-in page they cannot use.
  useEffect(() => {
    if (!hexclave) return;
    const epoch = sessionEpoch.current;
    void (async () => {
      try {
        const current = await hexclave.currentSession();
        if (epoch === sessionEpoch.current) setSession(current);
      } catch {
        if (epoch === sessionEpoch.current) {
          setError("Sign-in service is unavailable. Try again shortly.");
        }
      }
    })();
  }, [hexclave]);
  // A Hexclave session is a claim; `/api/me` is the API confirming it verified the token and
  // telling us who it saw. In local demo mode the person has to click through first, so the
  // demo is never mistaken for real sign-in.
  useEffect(() => {
    if (!api || !config) return;
    if (config.authMode === "local-demo" && !demoEntered) return;
    const epoch = sessionEpoch.current;
    void (async () => {
      try {
        const me = await api.me();
        if (epoch !== sessionEpoch.current) return;
        setEmail(me.email);
        setSessionExpired(false);
      } catch (err) {
        if (epoch === sessionEpoch.current) setError(friendlyError(err));
      }
    })();
  }, [api, config, demoEntered]);
  useEffect(() => {
    if (api && email) void loadWorkspace();
  }, [api, email]);
  useEffect(() => {
    if (!conflict) return undefined;
    const prior = document.activeElement as HTMLElement | null;
    closeConflict.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") keepMyDraft();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prior?.focus();
    };
  }, [conflict]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!changed || saving) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [changed, saving]);

  async function loadWorkspace() {
    if (!api) return;
    const epoch = sessionEpoch.current;
    setError("");
    try {
      const [nextState, output] = await Promise.all([api.brain(), api.artifact()]);
      let nextOrientation;
      try {
        nextOrientation = await api.orientation();
      } catch (err) {
        if (!(err instanceof ApiError && (err.status === 404 || err.status === 503))) throw err;
        nextOrientation = emptyOrientationState();
      }
      if (epoch !== sessionEpoch.current) return;
      setState(nextState);
      setOrientation(nextOrientation);
      latestDraft.current = nextState.brain;
      setDraft(nextState.brain);
      setChanged(false);
      setArtifact(output.artifact ?? nextState.artifact ?? null);
      setArtifactText((output.artifact ?? nextState.artifact)?.text ?? "");
      setArtifactStale(output.stale);
      const pendingJob = window.sessionStorage.getItem(jobStorage);
      if (pendingJob) void pollJob(pendingJob, epoch);
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(friendlyError(err));
    }
  }

  async function saveOrientation(patch: OrientationPatch): Promise<OrientationState> {
    if (!api) throw new Error("api_unavailable");
    const epoch = sessionEpoch.current;
    setOrientationSaving(true);
    setError("");
    try {
      const saved = await api.saveOrientation(patch);
      if (epoch !== sessionEpoch.current) return saved;
      setOrientation(saved);
      return saved;
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(friendlyError(err));
      throw err;
    } finally {
      if (epoch === sessionEpoch.current) setOrientationSaving(false);
    }
  }

  useEffect(() => {
    if (!api || !email || oauthHandled.current) return;
    if (window.location.pathname !== "/oauth/callback") return;
    oauthHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthState = params.get("state");
    const denied = params.get("error");
    window.history.replaceState({}, "", "/");
    setView("ghl");
    if (denied || !code || !oauthState) {
      setError("HighLevel Connect did not finish. Try Connect again.");
      return;
    }
    setConnecting(true);
    void (async () => {
      try {
        await api.completeOauth({ code, state: oauthState });
        const saved = await api.saveOrientation({
          ghlScreen: GHL_CHAPTER_SCREENS,
          ghlComplete: true,
          ghlAnswers: { connected: true },
        });
        setOrientation(saved);
        setNotice("HighLevel connected.");
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setConnecting(false);
      }
    })();
  }, [api, email]);

  async function startConnect() {
    if (!api) throw new Error("api_unavailable");
    setConnecting(true);
    setError("");
    try {
      const started = await api.startOauth();
      window.location.assign(started.url);
    } catch (err) {
      setConnecting(false);
      setError(friendlyError(err));
    }
  }

  async function importSite(url: string) {
    if (!api) throw new Error("api_unavailable");
    return api.importSite(url);
  }

  async function transcribeVoice(blob: Blob, seconds: number) {
    if (!api) throw new Error("api_unavailable");
    const audioBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("read_failed"));
      reader.readAsDataURL(blob);
    });
    return api.transcribeVoice({ audioBase64, mime: blob.type || "audio/webm", seconds });
  }

  async function getUsage() {
    if (!api) throw new Error("api_unavailable");
    return api.usage();
  }

  async function completeFirstLogin() {
    await saveOrientation({
      firstLoginScreen: 4,
      firstLoginComplete: true,
    });
    setMission("identity");
    setView("atlanta");
  }

  async function commitField(
    section: Exclude<Mission, "output">,
    field: string,
    value: string | boolean,
  ) {
    const next = patchBrain(latestDraft.current, section, field, value);
    latestDraft.current = next;
    setDraft(next);
    setChanged(true);
    await save(next);
  }

  async function applyIntake(proposal: {
    identity?: Record<string, string>;
    customer?: Record<string, string>;
    offer?: Record<string, string>;
    voice?: Record<string, string>;
  }) {
    let next = latestDraft.current;
    for (const section of ["identity", "customer", "offer", "voice"] as const) {
      const fields = proposal[section];
      if (!fields) continue;
      for (const [field, value] of Object.entries(fields)) {
        if (typeof value === "string" && value.trim()) {
          next = patchBrain(next, section, field, value);
        }
      }
    }
    latestDraft.current = next;
    setDraft(next);
    setChanged(true);
    await save(next);
  }

  function patch(section: Exclude<Mission, "output">, field: string, value: string | boolean) {
    if (saving) return;
    setDraft((current) => {
      const next = patchBrain(current, section, field, value);
      latestDraft.current = next;
      return next;
    });
    setChanged(true);
    setError("");
    setNotice("");
  }

  function settleSave(
    saved: BrainState,
    operation: { brain: Brain; expectedVersion: number; key: string },
    epoch: number,
    pendingVerification = false,
  ) {
    if (epoch !== sessionEpoch.current) return;
    const decision = settleSaveDecision(latestDraft.current, saved, operation, pendingVerification);
    setState(saved);
    if (decision.draftMatchesSaved) {
      latestDraft.current = decision.nextDraft;
      setDraft(decision.nextDraft);
    }
    setChanged(decision.changed);
    setNotice(decision.notice);
    saveOperation.current = null;
  }

  async function save(next = draft) {
    if (!api || !state || saving) return;
    const epoch = sessionEpoch.current;
    const operation = nextSaveOperation(saveOperation.current, next, state.version, () =>
      crypto.randomUUID(),
    );
    saveOperation.current = operation;
    setSaving(true);
    setError("");
    try {
      const saved = await api.save(operation.brain, operation.expectedVersion, operation.key);
      settleSave(saved, operation, epoch);
    } catch (err) {
      if (epoch !== sessionEpoch.current) return;
      if (err instanceof ApiError && err.status === 409) {
        saveOperation.current = null;
        try {
          const remote = await api.brain();
          if (epoch !== sessionEpoch.current) return;
          setConflict(remote);
          setError("A newer version exists. Compare it with your draft before saving again.");
        } catch {
          if (epoch === sessionEpoch.current) {
            setError("A newer version exists, but it could not be loaded. Your draft is intact.");
          }
        }
      } else if (
        err instanceof ApiError &&
        err.status === 503 &&
        err.code === "verification_pending" &&
        typeof err.details.committedVersion === "number"
      ) {
        try {
          const receipt = await api.brain(err.details.committedVersion);
          settleSave(receipt, operation, epoch, true);
        } catch {
          if (epoch === sessionEpoch.current) {
            setError(
              "The saved receipt is still unavailable. Retry the exact saved request; your draft is intact.",
            );
          }
        }
      } else {
        setError(friendlyError(err));
        setNotice(
          "Save outcome is unresolved. Retry the exact saved request or continue editing after it resolves.",
        );
      }
    } finally {
      if (epoch === sessionEpoch.current) setSaving(false);
    }
  }

  async function retrySave() {
    if (saveOperation.current) await save(saveOperation.current.brain);
  }

  async function approve(section: MissionSection) {
    if (!sectionWouldApprove(draft, section) && !draft[section].approved) {
      setError(
        `Finish the required ${section} fields before approving. ` +
          `Empty values and placeholders like “tbd” do not count. You can still save a draft.`,
      );
      return;
    }
    const next = structuredClone(latestDraft.current);
    next[section].approved = !next[section].approved;
    latestDraft.current = next;
    setDraft(next);
    setChanged(true);
    await save(next);
  }

  function keepMyDraft() {
    if (!conflict) return;
    setState(conflict);
    setConflict(null);
    setChanged(true);
    setNotice(
      "Your draft is retained. Saving now creates a new request against the current version.",
    );
  }

  function loadServerConflict() {
    if (!conflict) return;
    setState(conflict);
    latestDraft.current = conflict.brain;
    setDraft(conflict.brain);
    setChanged(false);
    setConflict(null);
  }

  async function openHistory() {
    if (!api) return;
    const epoch = sessionEpoch.current;
    try {
      const result = await api.history();
      if (epoch !== sessionEpoch.current) return;
      setHistory(result.versions);
      setView("brain");
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(friendlyError(err));
    }
  }

  async function compare(version: number) {
    if (!api) return;
    const epoch = sessionEpoch.current;
    try {
      const selected = await api.brain(version);
      if (epoch === sessionEpoch.current) setComparison(selected);
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(friendlyError(err));
    }
  }

  async function restore(version: number) {
    if (!api || !state) return;
    const epoch = sessionEpoch.current;
    try {
      const restored = await api.restore(version, state.version);
      if (epoch !== sessionEpoch.current) return;
      setState(restored);
      latestDraft.current = restored.brain;
      setDraft(restored.brain);
      setChanged(false);
      setComparison(null);
      setNotice(`Restored version ${version} as new version ${restored.version}.`);
      const refreshed = await api.history();
      if (epoch === sessionEpoch.current) setHistory(refreshed.versions);
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(friendlyError(err));
    }
  }

  async function pollJob(id: string, epoch = sessionEpoch.current) {
    if (!api || epoch !== sessionEpoch.current) return;
    setGenerating(true);
    const deadline = Date.now() + JOB_POLL_DEADLINE_MS;
    let waitMs = JOB_POLL_INITIAL_WAIT_MS;
    let lastStatus: Job["status"] | null = null;
    try {
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, waitMs));
        if (epoch !== sessionEpoch.current) return;
        const job = await api.job(id);
        if (epoch !== sessionEpoch.current) return;
        lastStatus = job.status;
        const outcome = interpretJobStatus(job.status);
        if (outcome.kind === "completed" && job.artifact) {
          window.sessionStorage.removeItem(jobStorage);
          setArtifact(job.artifact);
          setArtifactText(job.artifact.text);
          setArtifactStale(false);
          setJobNeedsReconcile(false);
          setNotice("A draft output is ready for review.");
          return;
        }
        if (outcome.kind === "failed") {
          window.sessionStorage.removeItem(jobStorage);
          throw new Error(job.error ?? "Generation did not complete.");
        }
        if (outcome.kind === "uncertain") {
          window.sessionStorage.removeItem(jobStorage);
          setJobNeedsReconcile(true);
          setNotice(
            "Generation outcome is uncertain. Reconcile by refreshing the output before starting another job.",
          );
          return;
        }
        waitMs = nextPollWaitMs(waitMs);
      }
      const timeout = interpretPollTimeout(lastStatus);
      if (timeout.kind === "still_running") setNotice(stillRunningNotice());
      else {
        setJobNeedsReconcile(true);
        setNotice(unresolvedJobNotice());
      }
    } catch (err) {
      if (epoch === sessionEpoch.current) {
        setJobNeedsReconcile(true);
        setError(friendlyError(err));
      }
    } finally {
      if (epoch === sessionEpoch.current) setGenerating(false);
    }
  }

  async function generate() {
    if (!api || !state || !config?.aiEnabled || generating) return;
    const epoch = sessionEpoch.current;
    const operation = jobOperation.current ?? {
      expectedVersion: state.version,
      key: crypto.randomUUID(),
    };
    jobOperation.current = operation;
    setGenerating(true);
    setGenerationRetry(false);
    setError("");
    try {
      const start = await api.startJob(operation.expectedVersion, operation.key);
      if (epoch !== sessionEpoch.current) return;
      jobOperation.current = null;
      window.sessionStorage.setItem(jobStorage, start.id);
      await pollJob(start.id, epoch);
    } catch (err) {
      if (epoch === sessionEpoch.current) {
        setError(friendlyError(err));
        setGenerationRetry(true);
        setNotice("Generation start is unresolved. Retry uses the same request key.");
        setGenerating(false);
      }
    }
  }

  async function reconcileOutput() {
    if (!api) return;
    const epoch = sessionEpoch.current;
    try {
      const output = await api.artifact();
      if (epoch !== sessionEpoch.current) return;
      setArtifact(output.artifact);
      setArtifactText(output.artifact?.text ?? "");
      setArtifactStale(output.stale);
      setJobNeedsReconcile(false);
      setNotice(
        output.artifact
          ? "Output refreshed from the server."
          : "No completed output is available yet.",
      );
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(friendlyError(err));
    }
  }

  async function acceptOutput() {
    if (!api || !state || !artifact || artifactStale || artifact.acceptedAt || accepting) return;
    const epoch = sessionEpoch.current;
    const operation = acceptOperation.current ?? {
      id: artifact.id,
      text: artifactText,
      expectedVersion: state.version,
      key: crypto.randomUUID(),
    };
    acceptOperation.current = operation;
    setAccepting(true);
    setAcceptRetry(false);
    try {
      const accepted = await api.acceptArtifact(
        operation.id,
        operation.text,
        operation.expectedVersion,
        operation.key,
      );
      if (epoch !== sessionEpoch.current) return;
      const fresh = await api.brain();
      if (epoch !== sessionEpoch.current) return;
      acceptOperation.current = null;
      setArtifact(accepted.artifact);
      setArtifactText(accepted.artifact.text);
      setState(fresh);
      latestDraft.current = fresh.brain;
      setDraft(fresh.brain);
      setArtifactStale(false);
      setNotice(
        accepted.verified
          ? "Output accepted and verified by the server."
          : "Output accepted; server verification is pending.",
      );
    } catch (err) {
      if (epoch === sessionEpoch.current) {
        setError(friendlyError(err));
        setAcceptRetry(true);
        setNotice("Acceptance outcome is unresolved. Retry uses the same request key.");
      }
    } finally {
      if (epoch === sessionEpoch.current) setAccepting(false);
    }
  }

  // Signing out asks the Hexclave SDK to end the session, which clears its cookie and
  // navigates to `/`. Private state is cleared first so nothing lingers if that is slow, and
  // the session is dropped locally even if Hexclave cannot be reached. In local demo there is
  // no session; we just leave the demo.
  async function leaveSession(message: string) {
    const current = session;
    setEmail(null);
    setSession(null);
    setDemoEntered(false);
    clearPrivate();
    if (current) {
      try {
        await current.signOut();
      } catch {
        setError(
          "Signed out of this page, but Hexclave could not be reached to end the session. " +
            "Close the browser to be sure.",
        );
      }
      return;
    }
    setNotice(message);
  }

  async function deleteWorkspace() {
    if (!api || deleteText !== "DELETE") return;
    const epoch = sessionEpoch.current;
    try {
      await api.deleteWorkspace();
      if (epoch !== sessionEpoch.current) return;
      await leaveSession("Workspace deleted and session cleared.");
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(friendlyError(err));
    }
  }

  function signOut() {
    void leaveSession("Signed out of the local demo.");
  }

  function download(format: "json" | "markdown") {
    void api?.download(format).catch((err) => setError(friendlyError(err)));
  }

  function onSignInError() {
    setError("Sign-in service is unavailable. Try again shortly.");
  }

  return {
    config,
    session,
    email,
    sessionExpired,
    demoEntered,
    setDemoEntered,
    state,
    draft,
    orientation: orientation ?? emptyOrientationState(),
    orientationLoaded: orientation !== null,
    orientationSaving,
    firstLoginComplete: orientation ? isFirstLoginComplete(orientation) : false,
    view,
    setView,
    mission,
    setMission,
    changed,
    saving,
    accepting,
    notice,
    error,
    history,
    comparison,
    conflict,
    artifact,
    artifactText,
    setArtifactText,
    artifactStale,
    generating,
    generationRetry,
    acceptRetry,
    jobNeedsReconcile,
    deleteOpen,
    setDeleteOpen,
    deleteText,
    setDeleteText,
    saveOperation,
    closeConflict,
    hexclave,
    patch,
    commitField,
    applyIntake,
    save,
    retrySave,
    approve,
    keepMyDraft,
    loadServerConflict,
    openHistory,
    compare,
    restore,
    generate,
    reconcileOutput,
    acceptOutput,
    signOut,
    deleteWorkspace,
    download,
    onSignInError,
    saveOrientation,
    completeFirstLogin,
    importSite,
    getUsage,
    transcribeVoice,
    connecting,
    startConnect,
  };
}
