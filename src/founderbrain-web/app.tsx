/**
 * FounderBrain web shell: auth gates, first-login orientation, and layout wiring.
 * State machine lives in ./use-founderbrain-app; presentation under ./components.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { missions } from "./mission-copy";
import { useFounderBrainApp } from "./use-founderbrain-app";
import { AuthPage } from "./components/AuthPage";
import { TopBar, AccountChip } from "./components/TopBar";
import { MissionRail } from "./components/MissionRail";
import { MissionTypeform } from "./components/MissionTypeform";
import { AtlantaReady } from "./components/AtlantaReady";
import { BrainPanel } from "./components/BrainPanel";
import { ConflictDialog } from "./components/ConflictDialog";
import { PrivacyDisclosure } from "./components/PrivacyDisclosure";
import { OrientationFlow } from "./components/OrientationFlow";
import { ContentChapter, GhlChapter, OutreachChapter } from "./components/ChapterFlows";
import { TypeformExitContext } from "./components/TypeformShell";
import { DeleteAccountModal } from "./components/DeleteAccountModal";
import { PackReview } from "./components/PackReview";
import { BuildPackModal } from "./components/BuildPackModal";
import { GmailStudio } from "./components/GmailStudio";
import { isPack } from "./pack";

export function App() {
  const app = useFounderBrainApp();
  const {
    config,
    session,
    email,
    sessionExpired,
    demoEntered,
    setDemoEntered,
    state,
    draft,
    orientation,
    orientationLoaded,
    orientationSaving,
    firstLoginComplete,
    view,
    setView,
    mission,
    setMission,
    notice,
    error,
    history,
    comparison,
    conflict,
    deleteOpen,
    setDeleteOpen,
    saveOperation,
    closeConflict,
    hexclave,
  } = app;

  const [reviewOpen, setReviewOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [buildDismissed, setBuildDismissed] = useState(false);
  // Artifact id a Rebuild started from; null when no rebuild is running.
  const [rebuildFrom, setRebuildFrom] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [buildStartedAt, setBuildStartedAt] = useState(() => Date.now());
  const v2Key = email ? `fb-v2-clicked:${email}` : "";
  const [v2Clicked, setV2Clicked] = useState(false);
  useEffect(() => {
    if (!v2Key) return;
    setV2Clicked(window.localStorage.getItem(v2Key) === "1");
  }, [v2Key]);
  const dismissedPack = useRef<string | null>(null);
  const packDraft = Boolean(app.artifact && !app.artifact.acceptedAt && isPack(app.artifactText));
  const packAccepted = Boolean(app.artifact?.acceptedAt && isPack(app.artifactText));
  useEffect(() => {
    if (!packDraft || !app.artifact) return;
    if (dismissedPack.current === app.artifact.id) return;
    setReviewOpen(true);
  }, [packDraft, app.artifact?.id]);

  const usedApp = (state?.version ?? 0) > 0 || Boolean(orientation.firstLoginCompletedAt);
  const packText = app.artifactText || "";
  const hasV2Plan =
    packText.includes("90 day plan") &&
    packText.includes("## Content") &&
    packText.includes("## Outreach");
  const showV2 =
    Boolean(email) &&
    Boolean(config?.aiEnabled) &&
    usedApp &&
    !hasV2Plan &&
    !v2Clicked &&
    !buildOpen &&
    !app.generating;
  // Once Update to V2 is clicked the banner is gone for good. Until the pack
  // exists, the build modal is the one place to watch it or try again.
  const rebuilding = rebuildFrom !== null;
  const showBuild =
    Boolean(email) &&
    Boolean(config?.aiEnabled) &&
    !buildDismissed &&
    (rebuilding || (!hasV2Plan && !packDraft && (buildOpen || v2Clicked || app.generating)));
  const buildFailed =
    showBuild && !app.generating && (!rebuilding || (app.artifact?.id ?? "") === rebuildFrom);
  useEffect(() => {
    if (rebuildFrom === null || app.generating) return;
    if (app.artifact && app.artifact.id !== rebuildFrom) {
      setRebuildFrom(null);
      setBuildOpen(false);
    }
  }, [rebuildFrom, app.artifact?.id, app.generating]);

  // Hub continuity: every typeform screen gets the one-tap Atlanta hub pill.
  // The delete-account modal rides along so it works wherever the chip is.
  const inTypeform = (node: ReactNode) => (
    <TypeformExitContext.Provider value={() => setView("atlanta")}>
      {node}
      {reviewOpen && packDraft ? (
        <PackReview
          text={app.artifactText}
          accepting={app.accepting}
          onClose={() => {
            dismissedPack.current = app.artifact?.id ?? null;
            setReviewOpen(false);
          }}
          onAccept={(joined) => {
            void app.acceptOutput(joined).then(() => setReviewOpen(false));
          }}
          onRebuild={
            config?.aiEnabled
              ? () => {
                  dismissedPack.current = app.artifact?.id ?? null;
                  setReviewOpen(false);
                  setRebuildFrom(app.artifact?.id ?? "");
                  setBuildDismissed(false);
                  setBuildStartedAt(Date.now());
                  setBuildOpen(true);
                  void app.generate();
                }
              : undefined
          }
        />
      ) : null}
      {showBuild ? (
        <BuildPackModal
          startedAt={buildStartedAt}
          done={false}
          failed={buildFailed}
          message={app.error}
          onRetry={() => {
            setBuildStartedAt(Date.now());
            setBuildOpen(true);
            void app.generate();
          }}
          onClose={() => {
            setBuildOpen(false);
            setBuildDismissed(true);
            setRebuildFrom(null);
          }}
        />
      ) : null}
      {showV2 ? (
        <div className="v2-banner" role="region" aria-label="Update to V2">
          <p>Your saved Brain has not been run through the 90 day plan, content, and outreach yet.</p>
          <button
            className="entry-cta"
            type="button"
            onClick={() => {
              if (v2Key) window.localStorage.setItem(v2Key, "1");
              setV2Clicked(true);
              setBuildStartedAt(Date.now());
              setBuildOpen(true);
              setMission("output");
              setView("missions");
              void app.generate();
            }}
          >
            Update to V2
          </button>
        </div>
      ) : null}
      {deleteOpen ? (
        <DeleteAccountModal
          email={email ?? ""}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => {
            setDeleteOpen(false);
            void app.deleteAccountNow();
          }}
        />
      ) : null}
    </TypeformExitContext.Provider>
  );

  if (window.location.pathname === "/privacy") {
    return <main className="public-privacy"><PrivacyDisclosure onBack={() => window.location.assign("/")} /></main>;
  }
  if (!config) {
    return <AuthPage kind="boot" message={error || "Opening your FounderBrain…"} />;
  }
  if (config.authMode === "local-demo" && !demoEntered) {
    return (
      <AuthPage
        kind="local-demo"
        notice={notice}
        error={error}
        onEnter={() => setDemoEntered(true)}
      />
    );
  }
  if (hexclave && (session === null || (sessionExpired && !email))) {
    return (
      <AuthPage
        kind="sign-in"
        sessionExpired={sessionExpired}
        notice={notice}
        error={error}
        hexclave={hexclave}
        onSignInError={app.onSignInError}
      />
    );
  }
  if (!email) return <AuthPage kind="checking" error={error} />;
  if (!state || !orientationLoaded) {
    return <AuthPage kind="boot" message={error || "Preparing your private workspace…"} />;
  }

  // Signed-in views without the full TopBar still get the account chip top right.
  const accountChip = email ? <AccountChip email={email} usage={app.usage} onSignOut={() => void app.signOut()} onDeleteAccount={() => setDeleteOpen(true)} /> : null;
  if (view === "gmail" && app.api) {
    return <>{accountChip}<GmailStudio api={app.api} onBack={() => setView("atlanta")} />{deleteOpen ? <DeleteAccountModal email={email ?? ""} onClose={() => setDeleteOpen(false)} onConfirm={() => { setDeleteOpen(false); void app.deleteAccountNow(); }} /> : null}</>;
  }
  const guidedOpen =
    !draft.identity.venture.trim() ||
    !draft.identity.role.trim() ||
    !draft.identity.goal.trim() ||
    !draft.customer.segment.trim() ||
    !draft.customer.problem.trim() ||
    !draft.offer.description.trim() ||
    !draft.voice.tone.trim();
  if (!firstLoginComplete || guidedOpen) {
    return inTypeform(
      <>
      {accountChip}
      <OrientationFlow
        screen={orientation.firstLoginScreen}
        saving={orientationSaving || app.saving}
        error={error}
        welcomeDone={firstLoginComplete}
        brain={draft}
        track={orientation.track}
        siteImportEnabled={Boolean(config.siteImportEnabled)}
        onNamed={(name) => app.patch("identity", "name", name)}
        onAdvance={async (next) => {
          await app.saveOrientation({ firstLoginScreen: next });
        }}
        onComplete={() => app.completeFirstLogin()}
        onDecline={() => void app.signOut()}
        onFill={async (section, field, value) => {
          await app.commitField(section, field, value);
        }}
        onApplyIntake={async (proposal) => {
          await app.applyIntake(proposal);
        }}
        onTrack={async (value) => {
          await app.saveOrientation({ track: value });
        }}
        onImport={(url) => app.importSite(url)}
        onTranscribe={(blob, seconds) =>
          app.transcribeVoice(blob, seconds).then((result) => result.text)
        }
      />
      {conflict ? (
        <ConflictDialog
          conflict={conflict}
          draft={draft}
          closeRef={closeConflict}
          onKeepDraft={app.keepMyDraft}
          onLoadServer={app.loadServerConflict}
        />
      ) : null}
      </>
    );
  }

  if (view === "content") {
    return inTypeform(
      <>
        {accountChip}
        <ContentChapter
          orientation={orientation}
          saving={orientationSaving}
          error={error}
          mediaApi={config.mediaEnabled ? app.api : null}
          artifactText={app.artifactText}
          generating={app.generating}
          revising={revising}
          onGenerate={() => {
            setBuildDismissed(false);
            setBuildStartedAt(Date.now());
            setBuildOpen(true);
            void app.generate();
          }}
          onRevise={async (pieces) => {
            setRevising(true);
            try {
              return await app.regeneratePieces(pieces);
            } finally {
              setRevising(false);
            }
          }}
          onPatch={async (patch) => {
            await app.saveOrientation(patch);
          }}
          onFinished={() => setView("atlanta")}
        />
      </>
    );
  }

  if (view === "outreach") {
    return inTypeform(
      <>
        {accountChip}
        <OutreachChapter
          orientation={orientation}
          saving={orientationSaving}
          error={error}
          onPatch={async (patch) => {
            await app.saveOrientation(patch);
          }}
          onFinished={() => setView("atlanta")}
        />
      </>
    );
  }

  if (view === "ghl") {
    return inTypeform(
      <>
        {accountChip}
        <GhlChapter
        orientation={orientation}
        saving={orientationSaving}
        error={error}
        connectEnabled={Boolean(config.crmConnectEnabled)}
        connecting={app.connecting}
        onConnect={() => app.startConnect()}
        loadUsage={() => app.getUsage()}
        packAccepted={packAccepted}
        packReady={packDraft}
        onReviewPack={() => setReviewOpen(true)}
        onGhlPush={() => app.ghlPush()}
        onPatch={async (patch) => {
          await app.saveOrientation(patch);
        }}
        onFinished={() => setView("atlanta")}
        />
      </>
    );
  }

  if (view === "missions") {
    return inTypeform(
      <>
        {accountChip}
        {conflict ? (
          <ConflictDialog
            conflict={conflict}
            draft={draft}
            closeRef={closeConflict}
            onKeepDraft={app.keepMyDraft}
            onLoadServer={app.loadServerConflict}
          />
        ) : null}
        {notice ? (
          <p className="mission-toast notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mission-toast error" role="alert">
            {error}
            {sessionExpired ? (
              <>
                {" "}
                <a href={window.location.pathname} target="_blank" rel="noopener">
                  Open a new tab to sign in
                </a>
                , then come back here and retry.
              </>
            ) : null}
          </p>
        ) : null}
        <MissionTypeform
          mission={mission}
          draft={draft}
          saving={app.saving}
          changed={app.changed}
          config={config}
          artifact={app.artifact}
          artifactText={app.artifactText}
          artifactStale={app.artifactStale}
          generating={app.generating}
          generationRetry={app.generationRetry}
          accepting={app.accepting}
          acceptRetry={app.acceptRetry}
          jobNeedsReconcile={app.jobNeedsReconcile}
          verified={state.verified}
          canRetrySave={Boolean(saveOperation.current)}
          onPatch={app.patch}
          onSave={() => void app.save()}
          onRetrySave={() => void app.retrySave()}
          onApprove={(section) => void app.approve(section)}
          onFinished={() => setView("atlanta")}
          onTranscribe={(blob, seconds) =>
            app.transcribeVoice(blob, seconds).then((result) => result.text)
          }
          onLookFirst={async (url) => {
            const result = await app.importSite(url);
            await app.applyIntake(result.proposal);
          }}
          onVoiceSamples={() => app.voiceSamples()}
          onAddVoiceSample={(name, text) => app.addVoiceSample(name, text)}
          onDeleteVoiceSample={(id) => app.deleteVoiceSample(id)}
          onText={app.setArtifactText}
          onGenerate={() => void app.generate()}
          onReconcile={() => void app.reconcileOutput()}
          onAccept={() => void app.acceptOutput()}
        />
      </>
    );
  }

  // Files and downloads: the same immersive glass stage, wired to the chip modal.
  if (view === "brain") {
    return inTypeform(
      <>
        {accountChip}
        {notice ? (
          <p className="mission-toast notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mission-toast error" role="alert">
            {error}
            {sessionExpired ? (
              <>
                {" "}
                <a href={window.location.pathname} target="_blank" rel="noopener">
                  Open a new tab to sign in
                </a>
                , then come back here and retry.
              </>
            ) : null}
          </p>
        ) : null}
        <BrainPanel
          state={state}
          history={history}
          comparison={comparison}
          onCompare={(v) => void app.compare(v)}
          onRestore={(v) => void app.restore(v)}
          onDownload={app.download}
          onHome={() => setView("atlanta")}
          onPrivacy={() => setView("privacy")}
        />
      </>
    );
  }

  // Atlanta hub: the same immersive glass stage as the typeform screens, now
  // the control room with versions and the jump-off points (Danny, 2026-09-21).
  if (view === "atlanta") {
    return inTypeform(
      <>
        {accountChip}
        {notice ? (
          <p className="mission-toast notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mission-toast error" role="alert">
            {error}
            {sessionExpired ? (
              <>
                {" "}
                <a href={window.location.pathname} target="_blank" rel="noopener">
                  Open a new tab to sign in
                </a>
                , then come back here and retry.
              </>
            ) : null}
          </p>
        ) : null}
        <AtlantaReady
          state={state}
          orientation={orientation}
          drafts={app.routineDrafts}
          history={history}
          onDraftStatus={(id, status) => void app.setDraftStatus(id, status)}
          onContent={() => setView("content")}
          onOutreach={() => setView("outreach")}
          onGhl={() => setView("ghl")}
          onGmail={() => setView("gmail")}
          onMissions={() => {
            const first = missions.find((key) => !state.readiness[key]) ?? "output";
            setMission(first);
            setView("missions");
          }}
          onOpenArtifact={(target) => {
            if (target === "chapter-content") return setView("content");
            if (target === "chapter-outreach") return setView("outreach");
            if (target === "chapter-ghl") return setView("ghl");
            const mission = target.replace("mission-", "") as (typeof missions)[number];
            setMission(mission);
            setView("missions");
          }}
          onBrain={() => void app.openHistory()}
          onRestore={(v) => void app.restore(v)}
        />
        {conflict ? (
          <ConflictDialog
            conflict={conflict}
            draft={draft}
            closeRef={closeConflict}
            onKeepDraft={app.keepMyDraft}
            onLoadServer={app.loadServerConflict}
          />
        ) : null}
      </>
    );
  }

  return (
    <main className="app-shell">
      <TopBar
        config={config}
        email={email}
        state={state}
        changed={app.changed}
        saving={app.saving}
        onHome={() => setView("atlanta")}
        onSignOut={() => void app.signOut()}
      />
      <div className="layout">
        <MissionRail
          view={view}
          mission={mission}
          readiness={state.readiness}
          onHome={() => setView("atlanta")}
          onMissions={() => setView("missions")}
          onBrain={() => void app.openHistory()}
          onSelectMission={(key) => {
            setMission(key);
            setView("missions");
          }}
        />
        <section className="stage">
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
              {sessionExpired && (
                <>
                  {" "}
                  <a href={window.location.pathname} target="_blank" rel="noopener">
                    Open a new tab to sign in
                  </a>
                  , then come back here and retry.
                </>
              )}
            </p>
          )}
          {view === "privacy" && <PrivacyDisclosure onBack={() => setView("brain")} />}
        </section>
      </div>
      {conflict && (
        <ConflictDialog
          conflict={conflict}
          draft={draft}
          closeRef={closeConflict}
          onKeepDraft={app.keepMyDraft}
          onLoadServer={app.loadServerConflict}
        />
      )}
    </main>
  );
}
