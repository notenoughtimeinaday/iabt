import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Music2,
  RefreshCw,
  Sparkles,
  Video,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

function readable(value = "") {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function iconFor(artifact) {
  const kind = String(artifact?.kind || "").toLowerCase();
  const mime = String(artifact?.mime_type || "").toLowerCase();
  if (kind === "video" || mime.startsWith("video/")) return Video;
  if (kind === "audio" || mime.startsWith("audio/")) return Music2;
  if (kind === "image" || mime.startsWith("image/")) return ImageIcon;
  return FileText;
}

function downloadInlineArtifact(artifact) {
  if (!artifact?.content) return;
  const blob = new Blob([artifact.content], {
    type: artifact.mime_type || "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.name || "iabt-deliverable.txt";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Deliverables() {
  const { toast } = useToast();
  const [artifacts, setArtifacts] = useState([]);
  const [accessUrls, setAccessUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState({});
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    try {
      const rows = await base44.entities.CreationArtifact.list("-created_date", 250);
      setArtifacts(Array.isArray(rows) ? rows : []);
    } catch (error) {
      toast({
        title: "Could not load deliverables",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return artifacts;
    return artifacts.filter((artifact) =>
      [artifact.name, artifact.kind, artifact.mime_type, artifact.metadata?.requested_kind]
        .some((value) => String(value || "").toLowerCase().includes(term))
    );
  }, [artifacts, query]);

  async function resolvePrivateArtifact(artifact) {
    if (!artifact?.file_uri || resolving[artifact.id]) return;
    setResolving((current) => ({ ...current, [artifact.id]: true }));
    try {
      const response = await base44.functions.invoke("get-artifact-access-url", {
        artifact_id: artifact.id,
      });
      const payload = response?.data || response;
      if (!payload?.ok || !payload.url) throw new Error("The secure download link is not ready.");
      setAccessUrls((current) => ({
        ...current,
        [artifact.id]: {
          url: payload.url,
          expires_at: payload.expires_at,
        },
      }));
    } catch (error) {
      toast({
        title: "Could not prepare this download",
        description: error?.response?.data?.error || error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setResolving((current) => ({ ...current, [artifact.id]: false }));
    }
  }

  return (
    <div className="iabt-home iabt-library-page">
      <header className="iabt-home-nav">
        <Link to="/" className="iabt-home-brand">
          <img className="iabt-mark" src="/iabt-mark.svg" alt="" />
          <div>
            <strong>Intelligent Application Building Tool</strong>
            <span>IABT · Deliverable Library</span>
          </div>
        </Link>
        <div className="iabt-home-user">
          <Button size="sm" asChild>
            <Link to="/studio"><Sparkles className="h-4 w-4 mr-1" /> JERICHO Studio</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={"h-4 w-4 mr-1 " + (loading ? "animate-spin" : "")} /> Refresh
          </Button>
        </div>
      </header>

      <main className="iabt-home-main">
        <section className="iabt-library-heading">
          <div>
            <p className="iabt-eyebrow"><Download className="h-4 w-4" /> Permanent creation history</p>
            <h1>Your deliverables</h1>
            <p>Every completed IABT artifact is collected here, independently of the conversation that created it.</p>
          </div>
          <label className="iabt-library-search">
            <span>Search deliverables</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Audio brief, document, video…"
            />
          </label>
        </section>

        {loading ? (
          <div className="iabt-library-empty"><Loader2 className="animate-spin" /><span>Loading deliverables…</span></div>
        ) : filtered.length === 0 ? (
          <div className="iabt-library-empty">
            <FileText />
            <strong>{query ? "No deliverables match your search" : "No completed deliverables yet"}</strong>
            <span>{query ? "Try a different term." : "Create something in JERICHO Studio and it will appear here."}</span>
          </div>
        ) : (
          <section className="creator-artifacts iabt-library-grid" aria-label="Deliverable library">
            {filtered.map((artifact) => {
              const Icon = iconFor(artifact);
              const cached = accessUrls[artifact.id];
              const signedReady = cached?.url && new Date(cached.expires_at || 0).getTime() > Date.now();
              const deliveryUrl = artifact.file_url || (signedReady ? cached.url : "");
              const preproduction = artifact.metadata?.rendered === false;
              const requestedKind = artifact.metadata?.requested_kind || artifact.metadata?.source_intent || "media";

              return (
                <article key={artifact.id} className="iabt-library-card">
                  <div className="iabt-library-card-head">
                    <span><Icon /></span>
                    <div>
                      <small>{readable(artifact.kind)} · {formatDate(artifact.created_date)}</small>
                      <strong>{artifact.name}</strong>
                    </div>
                  </div>

                  {preproduction && (
                    <p className="creator-artifact-limitation">
                      <AlertTriangle />
                      This is a {requestedKind} preproduction document. No playable {requestedKind} file was rendered.
                    </p>
                  )}

                  {artifact.content && (
                    <details className="iabt-library-preview">
                      <summary>Preview document</summary>
                      <pre>{artifact.content}</pre>
                    </details>
                  )}

                  {deliveryUrl && String(artifact.mime_type || "").startsWith("image/") && (
                    <img className="creator-artifact-media" src={deliveryUrl} alt={artifact.name || "IABT image"} />
                  )}
                  {deliveryUrl && String(artifact.mime_type || "").startsWith("video/") && (
                    <video className="creator-artifact-media" src={deliveryUrl} controls preload="metadata" />
                  )}
                  {deliveryUrl && String(artifact.mime_type || "").startsWith("audio/") && (
                    <audio className="creator-artifact-audio" src={deliveryUrl} controls preload="metadata" />
                  )}

                  <div className="creator-artifact-info">
                    <small>{artifact.mime_type || "IABT deliverable"} · verified delivery</small>
                    <div>
                      {artifact.content && (
                        <button type="button" onClick={() => downloadInlineArtifact(artifact)}>
                          <Download /> Download file
                        </button>
                      )}
                      {deliveryUrl && (
                        <a href={deliveryUrl} target="_blank" rel="noreferrer">
                          <ArrowUpRight /> Open
                        </a>
                      )}
                      {deliveryUrl && (
                        <a href={deliveryUrl} download>
                          <Download /> Download
                        </a>
                      )}
                      {!deliveryUrl && artifact.file_uri && (
                        <button type="button" onClick={() => resolvePrivateArtifact(artifact)} disabled={resolving[artifact.id]}>
                          {resolving[artifact.id] ? <Loader2 className="animate-spin" /> : <Download />}
                          Prepare secure download
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        <Button variant="ghost" asChild className="iabt-library-back">
          <Link to="/"><ArrowLeft className="h-4 w-4 mr-1" /> Back to IABT</Link>
        </Button>
      </main>
    </div>
  );
}
