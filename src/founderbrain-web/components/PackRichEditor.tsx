import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";

export function PackRichEditor({ value, onChange, label, disabled = false }: {
  value: string; onChange: (value: string) => void; label: string; disabled?: boolean;
}) {
  const change = useRef(onChange);
  change.current = onChange;
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, protocols: ["https", "http", "mailto"], autolink: true } }),
      TableKit.configure({ table: { resizable: false } }),
      Markdown,
    ],
    content: value,
    contentType: "markdown",
    editable: !disabled,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: "pack-prose", role: "textbox", "aria-label": label, "aria-multiline": "true", spellcheck: "true" } },
    onUpdate: ({ editor: current }) => change.current(current.getMarkdown()),
  });
  useEffect(() => { editor?.setEditable(!disabled, false); }, [editor, disabled]);
  if (!editor) return <p role="status">Opening editor…</p>;
  const tool = (name: string, caption: string, run: () => void, active = false, unavailable = false) => (
    <button key={name} type="button" title={name} aria-label={name} aria-pressed={active}
      disabled={disabled || unavailable} onMouseDown={(event) => event.preventDefault()} onClick={run}>{caption}</button>
  );
  function applyLink() {
    const next = url.trim();
    if (next && !/^(https?:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+)$/i.test(next)) {
      setLinkError("Use an https://, http://, or mailto: address."); return;
    }
    if (next) editor!.chain().focus().extendMarkRange("link").setLink({ href: next }).run();
    else editor!.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkOpen(false); setLinkError("");
  }
  return (
    <div className="pack-rich">
      <div className="pack-toolbar" role="toolbar" aria-label="Text formatting">
        <select aria-label="Paragraph style" disabled={disabled}
          value={editor.isActive("heading", { level: 1 }) ? "1" : editor.isActive("heading", { level: 2 }) ? "2" : editor.isActive("heading", { level: 3 }) ? "3" : "0"}
          onChange={(event) => {
            const level = Number(event.target.value);
            if (!level) editor.chain().focus().setParagraph().run();
            else editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run();
          }}>
          <option value="0">Paragraph</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option>
        </select>
        {tool("Bold (⌘/Ctrl+B)", "B", () => { editor.chain().focus().toggleBold().run(); }, editor.isActive("bold"))}
        {tool("Italic (⌘/Ctrl+I)", "I", () => { editor.chain().focus().toggleItalic().run(); }, editor.isActive("italic"))}
        {tool("Underline (⌘/Ctrl+U)", "U", () => { editor.chain().focus().toggleUnderline().run(); }, editor.isActive("underline"))}
        {tool("Strikethrough", "S", () => { editor.chain().focus().toggleStrike().run(); }, editor.isActive("strike"))}
        <span className="pack-tool-divider" />
        {tool("Bullet list", "Bullets", () => { editor.chain().focus().toggleBulletList().run(); }, editor.isActive("bulletList"))}
        {tool("Numbered list", "1. List", () => { editor.chain().focus().toggleOrderedList().run(); }, editor.isActive("orderedList"))}
        {tool("Block quote", "Quote", () => { editor.chain().focus().toggleBlockquote().run(); }, editor.isActive("blockquote"))}
        {tool("Insert or edit link", "Link", () => { setUrl(String(editor.getAttributes("link").href ?? "")); setLinkError(""); setLinkOpen(!linkOpen); }, editor.isActive("link"))}
        {tool("Inline code", "Code", () => { editor.chain().focus().toggleCode().run(); }, editor.isActive("code"))}
        {tool("Code block", "{ }", () => { editor.chain().focus().toggleCodeBlock().run(); }, editor.isActive("codeBlock"))}
        {tool("Horizontal divider", "Rule", () => { editor.chain().focus().setHorizontalRule().run(); })}
        {tool("Insert table", "Table", () => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); })}
        <span className="pack-tool-divider" />
        {tool("Undo (⌘/Ctrl+Z)", "Undo", () => { editor.chain().focus().undo().run(); }, false, !editor.can().undo())}
        {tool("Redo (⌘/Ctrl+Shift+Z)", "Redo", () => { editor.chain().focus().redo().run(); }, false, !editor.can().redo())}
        {tool("Clear formatting", "Clear", () => { editor.chain().focus().unsetAllMarks().clearNodes().run(); })}
        {editor.isActive("table") ? <>
          {tool("Add table row", "+ Row", () => { editor.chain().focus().addRowAfter().run(); })}
          {tool("Add table column", "+ Column", () => { editor.chain().focus().addColumnAfter().run(); })}
          {tool("Delete table row", "− Row", () => { editor.chain().focus().deleteRow().run(); })}
          {tool("Delete table column", "− Column", () => { editor.chain().focus().deleteColumn().run(); })}
          {tool("Delete table", "Remove table", () => { editor.chain().focus().deleteTable().run(); })}
        </> : null}
      </div>
      {linkOpen ? <form className="pack-link-form" onSubmit={(event) => { event.preventDefault(); applyLink(); }}>
        <label htmlFor="pack-link-url">Link address</label>
        <input id="pack-link-url" autoFocus value={url} placeholder="https://example.com" onChange={(event) => setUrl(event.target.value)} />
        <button type="submit">Apply</button><button type="button" onClick={() => setLinkOpen(false)}>Cancel</button>
        {linkError ? <p role="alert">{linkError}</p> : null}
      </form> : null}
      <EditorContent editor={editor} className="pack-editor-scroll" />
    </div>
  );
}
