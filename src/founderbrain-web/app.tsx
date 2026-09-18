/**
 * FounderBrain web shell: auth gates and layout wiring.
 * State machine lives in ./use-founderbrain-app; presentation under ./components.
 */
import { missions } from "./mission-copy";
import { useFounderBrainApp } from "./use-founderbrain-app";
import { AuthPage } from "./components/AuthPage";
import { TopBar } from "./components/TopBar";
import { MissionRail } from "./components/MissionRail";
import { MissionStage } from "./components/MissionStage";
import { Home } from "./components/Home";
import { BrainPanel } from "./components/BrainPanel";
import { ConflictDialog } from "./components/ConflictDialog";
import { PrivacyDisclosure } from "./components/PrivacyDisclosure";

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
    deleteText,
    setDeleteText,
    saveOperation,
    closeConflict,
    hexclave,
  } = app;

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
  if (!state) {
    return <AuthPage kind="boot" message={error || "Preparing your private workspace…"} />;
  }

  return (
    <main className="app-shell">
      <TopBar
        config={config}
        email={email}
        state={state}
        changed={app.changed}
        saving={app.saving}
        onHome={() => setView("home")}
        onSignOut={() => void app.signOut()}
      />
      <div className="layout">
        <MissionRail
          view={view}
          mission={mission}
          readiness={state.readiness}
          onHome={() => setView("home")}
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
          {view === "home" && (
            <Home
              state={state}
              draft={draft}
              onBegin={() => {
                const first = missions.find((key) => !state.readiness[key]) ?? "output";
                setMission(first);
                setView("missions");
              }}
              onHistory={() => void app.openHistory()}
            />
          )}
          {view === "missions" && (
            <MissionStage
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
              canRetrySave={Boolean(saveOperation.current)}
              onPatch={app.patch}
              onSave={() => void app.save()}
              onRetrySave={() => void app.retrySave()}
              onApprove={(section) => void app.approve(section)}
              onNext={setMission}
              onText={app.setArtifactText}
              onGenerate={() => void app.generate()}
              onReconcile={() => void app.reconcileOutput()}
              onAccept={() => void app.acceptOutput()}
            />
          )}
          {view === "brain" && (
            <BrainPanel
              state={state}
              history={history}
              comparison={comparison}
              deleteOpen={deleteOpen}
              deleteText={deleteText}
              onDeleteOpen={() => setDeleteOpen(true)}
              onDeleteText={setDeleteText}
              onDelete={() => void app.deleteWorkspace()}
              onCompare={(v) => void app.compare(v)}
              onRestore={(v) => void app.restore(v)}
              onDownload={app.download}
              onPrivacy={() => setView("privacy")}
            />
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
