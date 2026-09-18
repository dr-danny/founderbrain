/**
 * Left navigation rail: Home / Missions / Brain plus the five mission shortcuts.
 * Readiness checkmarks come from server state; selection is owned by App.
 */
import type { BrainState } from "../types";
import { missionCopy, missions, type Mission } from "../mission-copy";

export type View = "home" | "missions" | "brain" | "privacy" | "atlanta" | "content" | "outreach";

export function MissionRail({
  view,
  mission,
  readiness,
  firstLoginDone,
  onHome,
  onMissions,
  onBrain,
  onAtlanta,
  onContent,
  onOutreach,
  onSelectMission,
}: {
  view: View;
  mission: Mission;
  readiness: BrainState["readiness"];
  firstLoginDone: boolean;
  onHome: () => void;
  onMissions: () => void;
  onBrain: () => void;
  onAtlanta: () => void;
  onContent: () => void;
  onOutreach: () => void;
  onSelectMission: (key: Mission) => void;
}) {
  return (
    <aside className="rail" aria-label="Missions">
      <button
        className={view === "home" ? "nav active" : "nav"}
        onClick={onHome}
        aria-current={view === "home" ? "page" : undefined}
      >
        Home
      </button>
      <button
        className={view === "missions" ? "nav active" : "nav"}
        onClick={onMissions}
        aria-current={view === "missions" ? "page" : undefined}
      >
        Missions
      </button>
      {firstLoginDone ? (
        <>
          <button
            className={view === "atlanta" ? "nav active" : "nav"}
            onClick={onAtlanta}
            aria-current={view === "atlanta" ? "page" : undefined}
          >
            Atlanta
          </button>
          <button
            className={view === "content" ? "nav active" : "nav"}
            onClick={onContent}
            aria-current={view === "content" ? "page" : undefined}
          >
            Content
          </button>
          <button
            className={view === "outreach" ? "nav active" : "nav"}
            onClick={onOutreach}
            aria-current={view === "outreach" ? "page" : undefined}
          >
            Outreach
          </button>
        </>
      ) : null}
      <button
        className={view === "brain" ? "nav active" : "nav"}
        onClick={onBrain}
        aria-current={view === "brain" ? "page" : undefined}
      >
        Brain
      </button>
      <div className="mission-list">
        {missions.map((key) => (
          <button
            key={key}
            aria-label={`${missionCopy[key].number} ${missionCopy[key].title}${readiness[key] ? " completed" : ""}`}
            aria-current={view === "missions" && mission === key ? "page" : undefined}
            className={mission === key && view === "missions" ? "mission active" : "mission"}
            onClick={() => onSelectMission(key)}
          >
            <span>{missionCopy[key].number}</span>
            <b>{missionCopy[key].title}</b>
            {readiness[key] && <i aria-hidden="true">✓</i>}
          </button>
        ))}
      </div>
    </aside>
  );
}
