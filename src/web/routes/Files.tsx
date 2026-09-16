/** @jsxRuntime automatic */
/**
 * src/web/routes/Files.tsx
 *
 * WHAT IT IS
 * Everything a founder has made. The list, one file open on screen, and the downloads.
 *
 * WHY IT EXISTS
 * Rule 4, and this screen is the whole of it. On a laptop the founder had a folder they
 * could open, copy and keep. On a server they have this, and if it is incomplete or hard to
 * read then their work is not really theirs, whatever the database contains.
 *
 * Three things follow, and each is here because leaving it out is the usual way this goes
 * wrong. Every file has its own download, so nobody has to take the whole folder to get one
 * file. There is one button that takes everything, because a founder who wants to leave
 * with their work should not have to click nineteen times. And the internal folder is shown
 * rather than hidden, behind a disclosure labelled in plain words, because a folder we hide
 * is a folder they do not own.
 *
 * A FOURTH THING FOLLOWS NOW: what a founder attached to a message from inside the chat,
 * via the Composer, is not the app's own work and is shown as its own section, not folded
 * into the list the app wrote. It is first class, the same as everything else here, so it
 * is never behind a disclosure the way `.state/` is.
 *
 * A FIFTH THING: the Composer lets a founder pick one of two folders when they attach a
 * file, and the two mean different things. `voice-samples/` is writing that taught the
 * Brain their voice; `uploads/` is reference material that never did. They get separate
 * sections here for the same reason they get separate folders on disk.
 *
 * THE LINE ABOUT THE CHECK IS DELIBERATE, AND SO IS ITS PLACE. `src/server/rules/` reads
 * every file before it is saved and holds one that breaks a rule. It is a word matcher, so
 * it misses things, and a founder who believes it is a guarantee will send something without
 * reading it. Saying that plainly is cheaper than the alternative, which is a founder finding
 * out from a prospect. It sits on this screen and not on first run because this is where a
 * founder stands when they are about to use a file, and first run promises two questions in
 * thirty seconds.
 *
 * IT NAMES NEITHER TRACK'S TACTICS, WHICH IS RULE 1. The two specifics worth knowing, cold
 * DMs and unbacked numbers, are in `docs/PRE-WORK.md` in the content repo, which a founder
 * reads before the Brain forks them. Putting Instagram on a screen a B2B founder opens every
 * day would be showing them the other track's material.
 *
 * RULE 1. The rows are filtered by track here as well as on the server. `ge index` already
 * forks on the Track line, so in the ordinary case every row that arrives is theirs. This
 * filter is what makes a bug on the other side of the wire show up as a missing row rather
 * than as the other track's material on their screen.
 *
 * WHAT CALLS IT
 * app.tsx, on `#/files` and `#/files/<name>`.
 *
 * WHAT IT READS AND WRITES
 * Reads the file index and one file's text. Downloads are plain links, so the browser does
 * the saving and no JavaScript sits between a founder and their own file.
 */

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { downloadAllUrl, downloadUrl, fetchFile, fetchFiles } from "../lib/api.ts";
import type { FilesState, Founder } from "../lib/api.ts";
import { visibleFileRows } from "../lib/track.ts";
import { parseMarkdown } from "../lib/markdown.ts";
import { isCsvName, parseCsv } from "../lib/csv.ts";
import { plainFileName, sameFileName } from "../lib/format.ts";
import { hrefFor } from "../lib/nav.ts";
import { FileList } from "../components/FileList.tsx";
import { CsvView, MarkdownView } from "../components/MarkdownView.tsx";
import { Notice } from "../components/Notice.tsx";
import { Working } from "../components/Working.tsx";

export function Files({ founder }: { readonly founder: Founder }): ReactElement {
  const [state, setState] = useState<FilesState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchFiles().then((result) => {
      if (!live) return;
      if (result.ok) setState(result.value);
      else setProblem(result.problem.text);
    });
    return () => {
      live = false;
    };
  }, []);

  if (problem !== null) {
    return (
      <div className="page">
        <h1>Your files</h1>
        <Notice tone="problem" lines={[problem]} />
      </div>
    );
  }

  if (state === null) {
    return (
      <div className="page">
        <h1>Your files</h1>
        <Working what="Fetching your files." />
      </div>
    );
  }

  const rows = visibleFileRows(state.rows, founder.track);
  const stateRows = visibleFileRows(state.stateRows, founder.track);
  const uploadRows = visibleFileRows(state.uploadRows, founder.track);
  const voiceRows = visibleFileRows(state.voiceRows, founder.track);

  return (
    <div className="page">
      <h1>Your files</h1>
      <p className="lede">
        Everything here is yours. Take a copy whenever you like, and take it with you when the event is over.
      </p>

      <p className="quiet">
        The app reads what it writes before it saves it, and holds back a file that breaks one of the rules
        this programme runs on. That catches the obvious mistakes and it does not catch everything. Read a
        file here before you send it to somebody.
      </p>

      <FileList
        rows={rows}
        timezone={founder.timezone}
        emptyMessage="You have not made anything yet. Start with your Founder Brain."
      />

      {/*
        A FIRST CLASS SECTION, NOT A DISCLOSURE. The `.state/` folder below is the app's own
        notes and is folded shut because a founder in session 1 does not need to read it. A
        file a founder attached themselves is the opposite of that: it is theirs, they chose
        it, and hiding it behind a summary they have to click would tell them it is less
        theirs than what the app wrote. So it gets a heading and stays open, next to the work
        the app made rather than under it.
      */}
      <section className="uploads">
        <h2>What you brought in yourself</h2>
        <p className="quiet">
          These are the files you attached to a message. The app did not write them, so they are kept apart
          from what it made for you.
        </p>
        <FileList
          rows={uploadRows}
          timezone={founder.timezone}
          emptyMessage="You have not attached anything yet."
        />
      </section>

      {/*
        ITS OWN SECTION, SEPARATE FROM "WHAT YOU BROUGHT IN YOURSELF". The two folders mean
        different things to a founder even though both start as an attachment: a writing
        sample taught the Brain how they sound, and an upload never did. Mixing the two rows
        together would tell a founder both did the same job, which is exactly the mistake
        this split exists to prevent.
      */}
      <section className="voice-samples">
        <h2>Your writing samples</h2>
        <p className="quiet">
          These are samples of your own writing you gave us to teach the Brain your voice. They are never
          treated as reference material, only as an example of how you write.
        </p>
        <FileList
          rows={voiceRows}
          timezone={founder.timezone}
          emptyMessage="You have not added any writing samples yet."
        />
      </section>

      <section className="download-all">
        <h2>Take everything</h2>
        <p>One file with all of it inside, in the same shape as the folder. It opens on any computer.</p>
        <label className="checkbox">
          <input type="checkbox" checked={snapshots} onChange={(event) => setSnapshots(event.target.checked)} />
          <span>Include the older versions we have kept</span>
        </label>
        <a className="button button-big" href={downloadAllUrl(snapshots)}>
          Download everything
        </a>
      </section>

      <HandingItToClaude track={founder.track} />

      <details className="state-files">
        <summary>The notes the app keeps for itself</summary>
        <p className="quiet">
          These are ours, and they are yours too. They are how the app knows where you are up to.
        </p>
        <FileList rows={stateRows} timezone={founder.timezone} emptyMessage="Nothing here yet." />
      </details>
    </div>
  );
}

/**
 * One file, open.
 *
 * Markdown is rendered and a spreadsheet becomes a table, because the point is reading it
 * rather than inspecting it. The raw toggle is there for the founder who wants to see
 * exactly what is in the file, which is also what they get when they download it.
 */
export function FileView({ founder, name }: { readonly founder: Founder; readonly name: string }): ReactElement {
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);

  useEffect(() => {
    let live = true;
    setText(null);
    setProblem(null);
    void fetchFile(name).then((result) => {
      if (!live) return;
      if (result.ok) setText(result.value.text);
      else setProblem(result.problem.text);
    });
    return () => {
      live = false;
    };
  }, [name]);

  // Rule 1. An address can be typed, so the name is checked against the rows this founder
  // is allowed to see before anything is fetched onto the screen.
  const allowed = useAllowedFileNames(founder);
  const permitted = allowed === null || allowed.some((known) => sameFileName(known, name));

  return (
    <div className="page">
      <p className="crumb">
        <a href={hrefFor({ kind: "files" })}>Back to your files</a>
      </p>
      <h1>{plainFileName(name)}</h1>
      <p className="quiet">{name}</p>

      {!permitted ? (
        <Notice
          tone="problem"
          title="That is not one of yours"
          lines={["There is no file of that name in your folder. If somebody sent you this link, they had the wrong one."]}
        />
      ) : problem !== null ? (
        <Notice tone="problem" lines={[problem]} />
      ) : text === null ? (
        <Working what="Opening the file." />
      ) : (
        <>
          <div className="button-row">
            <a className="button button-small" href={downloadUrl(name)}>
              Download
            </a>
            <button type="button" className="button button-small button-quiet" onClick={() => setRaw(!raw)}>
              {raw ? "Show it tidied up" : "Show it exactly as it is"}
            </button>
          </div>
          {isBinaryName(name) ? (
            /*
             * A PDF or a photo the founder uploaded. Everything below this line
             * assumes text: the fetch decodes the body as UTF-8 and the markdown
             * parser reads it as prose, so a PDF shown here is a screen of
             * mojibake that reads as the file being corrupted. It is not. Say
             * what it is, and the Download button above already works.
             */
            <p className="lede">
              This is a file you added. It cannot be shown here, and it is not damaged. Use
              Download above to open it on your own machine. Your engines can read it where it is.
            </p>
          ) : raw ? (
            <pre className="raw">{text}</pre>
          ) : isCsvName(name) ? (
            <CsvView rows={parseCsv(text)} />
          ) : (
            <MarkdownView blocks={parseMarkdown(text)} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The names this founder is allowed to open.
 *
 * Null while the index has not arrived, which means "we do not know yet" and not "nothing is
 * allowed". The server is the real guard; this stops a pasted link rendering a heading and
 * a file name from the other track before the request comes back.
 */
function useAllowedFileNames(founder: Founder): readonly string[] | null {
  const [names, setNames] = useState<readonly string[] | null>(null);
  useEffect(() => {
    let live = true;
    void fetchFiles().then((result) => {
      if (!live || !result.ok) return;
      const rows = [
        ...visibleFileRows(result.value.rows, founder.track),
        ...visibleFileRows(result.value.stateRows, founder.track),
        ...visibleFileRows(result.value.uploadRows, founder.track),
        ...visibleFileRows(result.value.voiceRows, founder.track),
      ];
      setNames(rows.map((r) => r.name));
    });
    return () => {
      live = false;
    };
  }, [founder.track]);
  return names;
}

/**
 * What to do with the download, on the screen where they just pressed the button.
 *
 * WHY IT IS HERE AND NOT A PAGE OF ITS OWN. This is the handover, and it is session
 * 3. A founder is standing on this screen the moment it becomes relevant, because
 * downloading is step one of it. A separate page would be a page nobody opens at
 * the moment they need it.
 *
 * FROM SESSION 3 THE WORK MOVES TO LAUNCHHOUSE-V3. Each founder imports a
 * private copy of that repository, opens it in Claude with its plugin, and says
 * "bring my work across", which unpacks this download into the right place. So
 * the file stays zipped, and nobody has to choose which folder to open: the copy
 * is the folder. Private and not a fork, because a fork of a public repository is
 * always public and the copy is where their work is saved.
 *
 * THE STEPS ARE THE WHOLE ROUTE, IN ORDER, AND MATCH THE V3 README. Installing the
 * two apps comes first because every later step needs one of them. The plugin step
 * carries its own fallback, because "say yes when it offers" is a dead end on the
 * day it is not offered. The connector is named HighLevel, as Settings, then
 * Connectors lists it, and "connect my tools" follows it so Claude checks the
 * connection by reading the founder's own account back. Safari on a Mac unzips the
 * download by itself, so the download step says what to do with the folder instead.
 *
 * IT IS FOLDED SHUT BY DEFAULT. A founder in session 1 is not doing this and does
 * not need a wall of instructions under their files for a fortnight.
 *
 * RULE 1: the Apollo step is B2B only, and a B2C founder is not shown the word.
 */
export function HandingItToClaude({ track }: { readonly track: Founder["track"] }): ReactElement {
  return (
    <details className="handover">
      <summary>Giving this to Claude, in Session 3</summary>
      <p className="quiet">
        From Session 3 you work in Claude rather than here. This is how your work gets there. We do it
        together in the session, so there is nothing to get right on your own.
      </p>
      <ol>
        <li>
          <strong>Install the Claude desktop app and GitHub Desktop</strong>, and sign in to both. On a Windows PC, also
          install Git for Windows from git-scm.com, pressing Next on every screen.
        </li>
        <li>
          <strong>Press Download everything, above.</strong> You get one file. Leave it as it is, zipped.
          <br />
          <span className="quiet">
            If your Mac opens it into a folder called <code>growth-engine</code> instead, do not drag that folder
            anywhere. Leave it where it is, and Claude finds it when you say &quot;bring my work across&quot;.
          </span>
        </li>
        <li>
          <strong>Take your own private copy of the Launchhouse folder.</strong> Go to{" "}
          <code>github.com/new/import</code>, paste <code>https://github.com/Philm-moxywolf/launchhouse-v3</code>,
          give it a name, choose <strong>Private</strong>, and press Begin import.
          <br />
          <span className="quiet">
            Private, not a fork. A fork is always public, and this copy is where your work will be saved.
          </span>
        </li>
        <li>
          <strong>Put it on your computer.</strong> On your new copy, press <strong>Code</strong>, then{" "}
          <strong>Open with GitHub Desktop</strong>, then <strong>Clone</strong>.
        </li>
        <li>
          <strong>Open that folder in Claude</strong>, in the desktop app&apos;s Code tab, and say yes when it offers
          the Launchhouse plugin. That is what teaches it your track, your voice and the rules. Then say{" "}
          &quot;start launchhouse&quot;.
          <br />
          <span className="quiet">
            If it does not offer the plugin, press the <strong>+</strong> button next to the message box, then{" "}
            <strong>Plugins</strong>, add <code>Philm-moxywolf/launchhouse-v3</code>, and install{" "}
            <strong>growth-engine</strong>.
          </span>
        </li>
        <li>
          <strong>Drag the file you downloaded into that folder</strong>, or leave the folder where it is if your Mac unzipped it, and say &quot;bring my work across&quot;. Your
          work arrives as it was, and nothing you wrote is rewritten.
        </li>
        <li>
          <strong>Connect your tools.</strong> In Claude, open Settings, then Connectors, and connect HighLevel, which is
          GoHighLevel&apos;s own connector.
          {track === "b2b" ? " Connect Apollo too, so it can find your 25 and build your sequence, paused, for you to start." : ""}
          {" "}Then say &quot;connect my tools&quot;. Claude checks each connection by reading your own account back.
        </li>
        <li>
          <strong>Say &quot;where am I up to&quot;.</strong> If it tells you what you have built, it can read
          your Brain and you are done.
        </li>
      </ol>
      <p className="quiet">
        Download this again whenever you rebuild something here. It is a copy, not a live link, and a stale
        copy is how you publish last month&apos;s offer.
      </p>
    </details>
  );
}

/**
 * A file whose bytes are not text, so nothing on this screen can render it.
 *
 * Read from the name rather than from a content type, because the name is what the
 * list already has, and a founder's own uploads are the only files here that are
 * ever binary. The server decides what may be uploaded. This only decides what can
 * be shown.
 */
function isBinaryName(name: string): boolean {
  return /\.(pdf|png|jpe?g|gif|webp)$/i.test(name);
}
