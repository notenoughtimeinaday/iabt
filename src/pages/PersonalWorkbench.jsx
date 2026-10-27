import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Box, Braces, Check, ChevronRight, Code2, FileText, FolderGit2, FolderOpen, GitBranch, Layers3, Loader2, LogOut, Plus, Search, Settings2, Sparkles, Upload } from "lucide-react";
import { base44 } from "@/api/iabtClient";
import { useAuth } from "@/lib/AuthContext";
import { workTitle } from "@/lib/artifact-display";
import { isPersonalWorkspaceOwner, repositoryUrl, sourceReviewPrompt, suggestedRepositories } from "../../shared/workspace-sources.js";
import "@/personal-workbench.css";

const actions = [
  { id: "build", title: "Build something", icon: Sparkles, placeholder: "An idea, a useful tool, a better way to do something…" },
  { id: "source", title: "Work with source", icon: Code2, placeholder: "What would you like to improve? Attach the relevant files in Studio…" },
  { id: "document", title: "Export my text", icon: FileText, placeholder: "Paste your complete text. Jericho will preserve your wording…" }
];
const sizeLabel = (count) => String(count).padStart(2, "0");

export default function PersonalWorkbench() {
  const navigate = useNavigate(), { user, logout } = useAuth();
  const personal = isPersonalWorkspaceOwner(user);
  const [sources, setSources] = useState([]), [recent, setRecent] = useState([]), [projects, setProjects] = useState([]);
  const [active, setActive] = useState("build"), [prompt, setPrompt] = useState(""), [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [ready, setReady] = useState(null), [showRepository, setShowRepository] = useState(false), [repoInput, setRepoInput] = useState("");
  const importRef = useRef(null), promptRef = useRef(null), saveLock = useRef(false);
  const scope = useRef(0);
  const label = actions.find((item) => item.id === active);
  const name = personal ? "Derik" : String(user?.full_name || "Builder").split(" ")[0];

  async function refresh() {
    const current = ++scope.current;
    setLoading(true); setError("");
    const results = await Promise.allSettled([
      base44.functions.invoke("get-workspace-sources", {}),
      base44.agents.listConversations({ q: { agent_name: "iabt_creator" }, sort: "-updated_date", limit: 8, skip: 0 }),
      base44.entities.Project.list("-updated_date", 100),
      base44.functions.invoke("get-capability-registry", {})
    ]);
    if (current !== scope.current) return;
    if (results[0].status === "fulfilled") setSources(results[0].value.data?.sources || []);
    else setError("Your source catalog could not load. Existing references are unchanged. Retry before importing.");
    if (results[1].status === "fulfilled") setRecent(results[1].value.filter((item) => item.messages?.some((m) => m.role === "user")).slice(0, 4));
    if (results[2].status === "fulfilled") setProjects(results[2].value);
    if (results[3].status === "fulfilled") setReady(results[3].value.data?.capabilities?.openai_responses?.configured === true);
    else setReady(null);
    if (results.slice(1, 3).some((result) => result.status === "rejected")) setError((message) => message || "Some saved work could not load. Retry to refresh it.");
    setLoading(false);
  }
  useEffect(() => {
    setSources([]); setRecent([]); setProjects([]); setReady(null); setNotice("");
    void refresh();
    return () => { scope.current += 1; };
  }, [user?.id]);

  async function saveSources(items) {
    if (saveLock.current) return;
    saveLock.current = true; setSaving(true); setError(""); setNotice("");
    const current = scope.current;
    try {
      const response = await base44.functions.invoke("save-workspace-sources", { sources: items });
      if (current !== scope.current) return;
      setSources(response.data.sources); setShowRepository(false); setRepoInput("");
      setNotice("Source references saved to your account. Original files and repositories are unchanged.");
    } catch (failure) { if (current === scope.current) setError(failure?.message || "Could not save source references. You can retry the same import safely."); }
    finally { setSaving(false); saveLock.current = false; }
  }
  async function importCatalog(event) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 250_000) throw new Error("Use a catalog under 250 KB. Source archives stay separate.");
      const data = JSON.parse(await file.text());
      if (data.schema_version !== 1 || !Array.isArray(data.sources) || !data.sources.length || data.sources.length > 100) throw new Error("Choose a version-1 source catalog with 1–100 references.");
      await saveSources(data.sources);
    } catch (failure) { setError(failure?.message || "That catalog could not be read. Your existing references are unchanged."); }
  }
  function exportCatalog() {
    const fields = ["kind", "title", "repository_url", "sha256", "filename", "location", "commit_sha", "notes"];
    const data = { schema_version: 1, sources: sources.map((source) => Object.fromEntries(fields.filter((key) => source[key]).map((key) => [key, source[key]]))) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "Jericho-source-catalog.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function start(event) {
    event.preventDefault(); if (!prompt.trim()) return;
    const request = active === "document" ? "Export this text as a document:\n" + prompt : prompt.trim();
    navigate("/studio?new=1&prompt=" + encodeURIComponent(request));
  }
  const filtered = sources.filter((source) => (source.title + " " + (source.notes || "")).toLowerCase().includes(search.toLowerCase()));

  return <div className="personal-workbench">
    <aside className="pw-rail">
      <a className="pw-brand" href="#" onClick={(e) => { e.preventDefault(); navigate("/workbench"); }} aria-label="Jericho workbench"><span className="pw-monogram">J<span /></span><span>JERICHO<small>PERSONAL WORKBENCH</small></span></a>
      <div className="pw-owner"><span className="pw-avatar">{name.slice(0, 1)}</span><div><strong>{name}’s workspace</strong><small>Ideas. Code. Possibilities.</small></div></div>
      <nav aria-label="Workspace navigation">
        <button className="is-current" type="button" aria-current="page" onClick={() => window.scrollTo({ top: 0, behavior: "instant" })}><Layers3 /> Overview <span>01</span></button>
        <button type="button" onClick={() => navigate("/studio")}><Braces /> Creation studio <ChevronRight /></button>
        <a href="#pw-sources"><FolderGit2 /> Source library <span>{sources.length}</span></a>
        <button type="button" onClick={() => navigate("/deliverables")}><FolderOpen /> Saved files <ChevronRight /></button>
        <button type="button" onClick={() => navigate("/integrations")}><Settings2 /> Providers & connections</button>
      </nav>
      <div className="pw-rail-note"><span className="pw-status-dot" /><strong>Your work stays yours.</strong><p>Source projects stay separate. Original files and previous versions stay preserved.</p></div>
      <div className="pw-profile"><span className="pw-avatar">{name.slice(0, 1)}</span><span><strong>{name}</strong><small>{user?.email}</small></span><button type="button" aria-label="Sign out" onClick={() => logout(true)}><LogOut /></button></div>
    </aside>

    <main className="pw-main">
      <header className="pw-topbar"><span>Workspace <ChevronRight /> <strong>Overview</strong></span><div><span className="pw-personal-pill"><span /> Personal workspace</span><button type="button" onClick={() => navigate("/support")} aria-label="Open help">Help <ArrowUpRight /></button></div></header>
      <section className="pw-hero">
        <div className="pw-hero-copy"><span className="pw-eyebrow"><span /> A SPACE TO MAKE IT REAL</span><h1>Your ideas.<br /><em>Without the clutter.</em></h1><p>Welcome back, {name}. Build something useful, bring your code together, and pick up exactly where you left off.</p><div className="pw-hero-links"><a href="#pw-create">Start creating <ArrowRight /></a><a href="#pw-sources">Explore your source library <ArrowUpRight /></a></div></div>
        <div className="pw-orbit" aria-hidden="true"><div className="pw-orbit-grid" /><div className="pw-orbit-ring pw-ring-one" /><div className="pw-orbit-ring pw-ring-two" /><div className="pw-orbit-core"><Braces /><span>IDEA → CREATION</span></div><span className="pw-float pw-float-code"><Code2 /> Your code</span><span className="pw-float pw-float-files"><FolderOpen /> Your files</span><span className="pw-float pw-float-ideas"><Sparkles /> Your next idea</span></div>
      </section>

      <div className="pw-section-title"><div><span className="pw-eyebrow">THE NEXT GOOD THING</span><h2>What are we making?</h2></div><span>One workspace. Your direction.</span></div>
      <section className="pw-composer" id="pw-create" aria-label="Start your next creation">
        <div className="pw-composer-tabs" role="group" aria-label="Creation type">{actions.map((action) => { const Icon = action.icon; return <button key={action.id} type="button" aria-pressed={active === action.id} onClick={() => { setActive(action.id); promptRef.current?.focus(); }}><Icon />{action.title}</button>; })}<span className="pw-composer-label">JERICHO STUDIO</span></div>
        <form onSubmit={start}><label htmlFor="pw-request" className="pw-sr-only">Describe your next creation</label><textarea id="pw-request" ref={promptRef} value={prompt} maxLength={12000} onChange={(e) => setPrompt(e.target.value)} placeholder={label.placeholder} rows={3} /><div className="pw-composer-bottom"><span><Check /> {active === "document" ? "Your text, preserved as Word, PDF & Markdown." : "Review the plan before any paid creation."}</span><button type="submit" disabled={!prompt.trim()}>Open in Studio <ArrowRight /></button></div></form>
        <p className="pw-tool-status"><span className={ready ? "pw-status-dot" : "pw-status-dot is-paused"} />{loading ? "Checking your tools…" : ready === null ? "Tool availability is unconfirmed." : ready ? "Custom creation is configured. Approval and usage limits still apply." : "Custom AI is off. Saved work, source references and text exports remain available."}</p>
      </section>

      <section className="pw-sources" id="pw-sources">
        <div className="pw-section-title"><div><span className="pw-eyebrow">BUILD ON WHAT YOU HAVE</span><h2>Your source library <span className="pw-count">{sizeLabel(sources.length)}</span></h2></div><div className="pw-source-tools"><button type="button" onClick={() => importRef.current?.click()} disabled={saving || loading}><Upload /> Import catalog</button><button type="button" onClick={() => setShowRepository((v) => !v)} disabled={saving || loading}><Plus /> Add repository</button></div></div>
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={importCatalog} />
        {showRepository && <form className="pw-repo-form" onSubmit={(e) => { e.preventDefault(); const url = repositoryUrl(repoInput); if (!url) { setError("Use an HTTPS GitHub repository URL without tokens or query parameters."); return; } void saveSources([{ kind: "repository", title: url.split("/").slice(-2).join("/"), repository_url: url }]); }}><label htmlFor="pw-repo">GitHub repository URL</label><input id="pw-repo" type="url" value={repoInput} maxLength={240} onChange={(e) => setRepoInput(e.target.value)} placeholder="https://github.com/owner/repository" required /><button type="submit" disabled={saving}>Save reference</button><small>This saves a reference. It does not grant repository access or sync code.</small></form>}
        {error && <div className="pw-message is-error" role="alert">{error} <button type="button" onClick={refresh} disabled={loading}>Retry refresh</button></div>}
        {notice && <p className="pw-message" role="status">{notice}</p>}
        <div className="pw-source-filter"><label><Search /><span className="pw-sr-only">Search source library</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a project, repository or archive…" /></label><button type="button" onClick={exportCatalog} disabled={!sources.length}><ArrowDownToLine /> Export catalog</button></div>
        {loading ? <p className="pw-loading"><Loader2 /> Loading your workspace…</p> : sources.length ? <div className="pw-source-grid">{filtered.map((source, index) => <article className="pw-source-card" key={source.id} data-tone={index % 3}><div className="pw-source-card-top"><span className="pw-source-symbol">{source.kind === "repository" ? <FolderGit2 /> : <Box />}</span><span className="pw-source-type">{source.kind === "repository" ? "GITHUB REFERENCE" : source.kind === "archive" ? "PRESERVED ARCHIVE" : "LOCAL REFERENCE"}</span></div><h3>{source.title}</h3><p>{source.notes || "Preserved source reference. Bring relevant files into Studio when you are ready to work."}</p><div className="pw-source-meta">{source.commit_sha ? <><GitBranch /> {source.commit_sha.slice(0, 8)}</> : <><Layers3 /> Original source remains separate</>}</div><div className="pw-source-card-actions"><button type="button" onClick={() => navigate("/studio?new=1&prompt=" + encodeURIComponent(sourceReviewPrompt(source)))}>Work on this <ArrowRight /></button>{source.kind === "repository" && repositoryUrl(source.repository_url) && <a href={repositoryUrl(source.repository_url)} target="_blank" rel="noreferrer" aria-label={"Open " + source.title + " repository"}><ArrowUpRight /></a>}</div></article>)}</div> : <div className="pw-empty"><div><FolderGit2 /><h3>A home for everything you’ve built.</h3><p>Add repository references or import your recovered source catalog. Original files remain where you keep them.</p></div>{personal && <button type="button" disabled={saving} onClick={() => void saveSources(suggestedRepositories)}>{saving ? <Loader2 /> : <Plus />} Add IABT & TreEbay references</button>}</div>}
        {!loading && sources.length > 0 && !filtered.length && <p className="pw-loading">No sources match that search.</p>}
      </section>

      <section className="pw-bottom-grid"><div className="pw-recent"><div className="pw-section-title"><h2>Pick up where you left off</h2><button type="button" onClick={() => navigate("/studio")}>All work <ArrowUpRight /></button></div>{recent.length ? recent.map((work) => <button className="pw-recent-row" type="button" key={work.id} onClick={() => navigate("/studio?conversation=" + encodeURIComponent(work.id))}><span><Braces /></span><div><strong>{workTitle(work)}</strong><small>Saved conversation · continue in Studio</small></div><ArrowRight /></button>) : <p className="pw-muted">Your saved conversations will appear here. Start above when you’re ready.</p>}</div><div className="pw-preservation"><span className="pw-eyebrow">MADE TO KEEP</span><h2>Build forward.<br />Keep the originals.</h2><p>{projects.length} saved app {projects.length === 1 ? "project" : "projects"} in this account. Source references don’t move or overwrite repositories.</p>{personal && <p className="pw-local-path">Primary local workspace<br /><code>E:\Jericho-Master\workspace\iabt</code><small>External drive access is separate from this web app.</small></p>}<button type="button" onClick={() => navigate("/projects-library")}>Open saved projects <ArrowUpRight /></button></div></section>
      <footer className="pw-footer"><span>JERICHO / IABT <span>Built around your next idea.</span></span><button type="button" onClick={() => navigate("/support")}>Help & workspace settings <ArrowUpRight /></button></footer>
    </main>
  </div>;
}
