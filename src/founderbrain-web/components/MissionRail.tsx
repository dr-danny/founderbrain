/**
 * Left navigation rail: Home / Missions / Brain plus the five mission shortcuts.
 * Readiness checkmarks come from server state; selection is owned by App.
 */
import type { BrainState } from "../types";
import { missionCopy, missions, type Mission } from "../mission-copy";

export type View = "home" | "missions" | "brain";

export function MissionRail({
  view,
  mission,
  readiness,
  onHome,
  onMissions,
  onBrain,
  onSelectMission,
}: {
  view: View;
  mission: Mission;
  readiness: BrainState["readiness"];
  onHome: () => void;
  onMissions: () => void;
  onBrain: () => void;
  onSelectMission: (key: Mission) => void;
}) {
  return (
    <aside className="rail" aria-label="Missions">
      <button className={view === "home" ? "nav active" : "nav"} onClick={onHome}>
        Home
      </button>
      <button className={view === "missions" ? "nav active" : "nav"} onClick={onMissions}>
        Missions
      </button>
      <button className={view === "brain" ? "nav active" : "nav"} onClick={onBrain}>
        Brain
      </button>
      <div className="mission-list">
        {missions.map((key) => (
          <button
            key={key}
            aria-label={`${missionCopy[key].number} ${missionCopy[key].title}${readiness[key] ? " completed" : ""}`}
            className={mission === key ? "mission active" : "mission"}
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
