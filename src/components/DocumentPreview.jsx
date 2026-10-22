import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { BookOpen, Code2, Copy, FilePenLine, Loader2, RefreshCw } from "lucide-react";
import { base44, platformRuntime } from "@/api/iabtClient";
import { storedFileId } from "@/lib/stored-files";
import { isMarkdownArtifact } from "@/lib/artifact-display";
import { studioErrorMessage } from "@/lib/studio-state";
import "@/document-preview.css";

export default function DocumentPreview({ artifact, autoOpen = false, onEdit, disabled = false }) {
  const [opened, setOpened] = useState(autoOpen);
  const [view, setView] = useState("reading");
  const [content, setContent] = useState(typeof artifact.content === "string" ? artifact.content : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function load() {
    if (pending.current || content !== null) return;
    pending.current = true; setLoading(true); setError("");
    try {
      if (platformRuntime.backend !== "standalone") throw new Error("Download this file to open it.");
      const response = await base44.functions.invoke("get-text-preview", { file_id: storedFileId(artifact) || artifact.id });
      const payload = response?.data || response;
      if (typeof payload?.content !== "string") throw new Error("The reading view could not open.");
      if (active.current) setContent(payload.content);
    } catch (failure) { if (active.current) setError(studioErrorMessage(failure, "The reading view could not open. Your download is still available.")); }
    finally { pending.current = false; if (active.current) setLoading(false); }
  }
  useEffect(() => { if (opened && content === null && !error) void load(); }, [opened]);
  async function copyText() {
    try { await navigator.clipboard.writeText(content); setCopied(true); }
    catch { setError("Copy could not complete. Use the Source view to select your text."); }
  }
  return <section className="document-preview" aria-label={"Document preview: " + artifact.name}>
    {!opened ? <button type="button" className="document-open" onClick={() => setOpened(true)}><BookOpen /> Read document</button> : <>
      <div className="document-toolbar">
        <div role="group" aria-label="Document view">
          <button type="button" aria-pressed={view === "reading"} onClick={() => setView("reading")}><BookOpen /> Reading</button>
          <button type="button" aria-pressed={view === "source"} onClick={() => setView("source")}><Code2 /> Source</button>
        </div>
        <div>
          {content !== null && <button type="button" onClick={copyText}><Copy /> {copied ? "Copied" : "Copy text"}</button>}
          {onEdit && content !== null && <button type="button" disabled={disabled} onClick={() => onEdit(content, artifact)}><FilePenLine /> Edit a copy</button>}
        </div>
      </div>
      {loading && <div className="document-preview-state" role="status"><Loader2 className="animate-spin" /> Opening your document…</div>}
      {error && <div className="document-preview-state" role="alert"><p>{error}</p>{content === null && <button type="button" onClick={load}><RefreshCw /> Try again</button>}</div>}
      {content !== null && <div className={"document-paper" + (view === "source" ? " is-source" : "")} tabIndex={0}>
        {view === "source" || !isMarkdownArtifact(artifact) ? <pre>{content}</pre> : <ReactMarkdown components={{
          // Source is inert: no raw HTML plugin, active links or remote images.
          a: ({ children }) => <span className="document-link-text">{children}</span>,
          img: ({ alt }) => <span className="document-image-label">[Image: {alt || "image reference"}]</span>,
        }}>{content}</ReactMarkdown>}
      </div>}
    </>}
  </section>;
}
