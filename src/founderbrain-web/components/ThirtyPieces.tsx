import { useMemo, useState } from "react";
import { parsePieces, type ContentPiece } from "../pack";
import { MediaOptions, PieceMedia } from "./Media";

type Mark = "like" | "dislike" | "";

export function ThirtyPieces({
  content,
  generating,
  revising,
  onGenerate,
  onRevise,
}: {
  content: string;
  generating: boolean;
  revising: boolean;
  onGenerate: () => void;
  onRevise: (pieces: Array<{ n: number; text: string; feedback: string }>) => Promise<ContentPiece[]>;
}) {
  const parsed = useMemo(() => parsePieces(content), [content]);
  const [pieces, setPieces] = useState<ContentPiece[]>(parsed);
  const [marks, setMarks] = useState<Record<number, Mark>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [index, setIndex] = useState(0);
  const [localError, setLocalError] = useState("");
  const shown = pieces.length ? pieces : parsed;
  const disliked = shown.filter((piece) => marks[piece.n] === "dislike");
  const place = shown.length ? Math.min(index, shown.length - 1) : 0;
  const piece = shown[place];
  const posts = shown.map((row) => ({ n: row.n, text: row.text }));

  async function regenerate() {
    setLocalError("");
    try {
      const next = await onRevise(
        disliked.map((piece) => ({
          n: piece.n,
          text: piece.text,
          feedback: notes[piece.n] ?? "",
        })),
      );
      setPieces((current) => {
        const base = current.length ? current : parsed;
        const byN = new Map(base.map((piece) => [piece.n, piece]));
        for (const piece of next) byN.set(piece.n, piece);
        return [...byN.values()].sort((a, b) => a.n - b.n);
      });
      setMarks((current) => {
        const copy = { ...current };
        for (const piece of next) copy[piece.n] = "";
        return copy;
      });
    } catch {
      setLocalError("Could not rewrite those pieces. Try again.");
    }
  }

  if (!shown.length) {
    return (
      <div className="piece-studio">
        <p>The app writes the 30 pieces from your Brain. You do not set them up by hand.</p>
        <MediaOptions posts={[]} />
        <button type="button" className="entry-cta" onClick={onGenerate} disabled={generating}>
          {generating ? "Writing the 30…" : "Generate my 30 pieces"}
        </button>
      </div>
    );
  }

  if (!piece) return null;

  return (
    <div className="piece-studio">
      <p>
        Piece {place + 1} of {shown.length}. One piece at a time. Like the ones that sound like you. Dislike the rest and say why, then regenerate those only.
      </p>
      <MediaOptions posts={posts} />
      <article className={marks[piece.n] ? `piece ${marks[piece.n]}` : "piece"}>
        <p>{piece.text}</p>
        <PieceMedia n={piece.n} text={piece.text} posts={posts} />
        <div className="piece-actions">
          <button type="button" className="typeform-external" onClick={() => setMarks({ ...marks, [piece.n]: "like" })}>
            {marks[piece.n] === "like" ? "Liked" : "Like"}
          </button>
          <button type="button" className="typeform-external" onClick={() => setMarks({ ...marks, [piece.n]: "dislike" })}>
            {marks[piece.n] === "dislike" ? "Disliked" : "Dislike"}
          </button>
        </div>
        {marks[piece.n] === "dislike" ? (
          <textarea
            aria-label={`Feedback for piece ${piece.n}`}
            placeholder="What should change?"
            value={notes[piece.n] ?? ""}
            onChange={(event) => setNotes({ ...notes, [piece.n]: event.target.value })}
          />
        ) : null}
      </article>
      <div className="piece-actions">
        <button type="button" className="typeform-external" disabled={place === 0} onClick={() => setIndex(place - 1)}>
          Previous piece
        </button>
        <button type="button" className="typeform-external" disabled={place >= shown.length - 1} onClick={() => setIndex(place + 1)}>
          Next piece
        </button>
      </div>
      {disliked.length ? (
        <button type="button" className="entry-cta" onClick={() => void regenerate()} disabled={revising}>
          {revising ? "Rewriting…" : `Regenerate ${disliked.length} disliked`}
        </button>
      ) : null}
      {localError ? <p className="entry-error">{localError}</p> : null}
    </div>
  );
}
