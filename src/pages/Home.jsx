import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAppLocation } from "@/lib/routing";
import { base44 } from "@/api/iabtClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmActionDialog, NameDialog } from "@/components/ActionDialogs";
import BillingDialog from "@/components/BillingDialog";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import {
  ArchiveRestore,
  ChevronDown,
  UserRound,
  ArrowRight,
  Cloud,
  Copy,
  CreditCard,
  FolderOpen,
  FileText,
  Code2,
  LayoutTemplate,
  LifeBuoy,
  Loader2,
  LogOut,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  cloneValue,
  createId,
  normalizeAppDefinition,
} from "@/lib/appDefinition";
import { legacyTag, readLegacyProjects } from "@/lib/legacyProjects";
import { workTitle } from "@/lib/artifact-display";
import "@/home-simple.css";

export default function Home() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, logout } = useAuth();
  const importRef = useRef(null);
  const requestRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [recentWork, setRecentWork] = useState([]);
  const [request, setRequest] = useState("");
  const [workError, setWorkError] = useState("");
  const [projectError, setProjectError] = useState("");
  const [capabilities, setCapabilities] = useState(null);
  const [workflow, setWorkflow] = useState("build");
  const [documentMode, setDocumentMode] = useState("export");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [query, setQuery] = useState("");
  const [legacyProjects, setLegacyProjects] = useState([]);
  const [entitlement, setEntitlement] = useState(null);
  const [billingStatus, setBillingStatus] = useState(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const [nameDialog, setNameDialog] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function load() {
    setLoading(true);
    setWorkError("");
    setProjectError("");
    try {
      const [projectResult, entitlementResult, workResult, capabilityResult] = await Promise.allSettled([
        base44.entities.Project.list("-updated_date", 250),
        user?.id
          ? base44.functions.invoke("get-account-entitlement", {})
          : Promise.resolve(null),
        base44.agents.listConversations({ q: { agent_name: "iabt_creator" }, sort: "-updated_date", limit: 30, skip: 0 }),
        base44.functions.invoke("get-capability-registry", {}),
      ]);
      const records = projectResult.status === "fulfilled" && Array.isArray(projectResult.value) ? projectResult.value : [];
      const entitlementResponse = entitlementResult.status === "fulfilled" ? entitlementResult.value : null;
      const conversations = workResult.status === "fulfilled" ? workResult.value : [];
      const entitlementPayload = entitlementResponse?.data || entitlementResponse;
      if (projectResult.status === "fulfilled") setProjects(records);
      else setProjectError("Projects could not load. Your saved work has not been changed.");
      if (workResult.status === "rejected") setWorkError("Recent work could not load. Please try again.");
      const capabilityPayload = capabilityResult.status === "fulfilled" ? (capabilityResult.value?.data || capabilityResult.value) : null;
      setCapabilities(capabilityPayload?.capabilities || null);
      setRecentWork(Array.isArray(conversations) ? conversations.filter((item) => item.messages?.some((message) => message.role === "user")).slice(0, 6) : []);
      setEntitlement(entitlementPayload?.entitlement || entitlementPayload || null);
      setBillingStatus(entitlementPayload?.billing || null);
      const importedTags = new Set(records.flatMap((project) => project.tags || []).filter((tag) => String(tag).startsWith("legacy:")));
      setLegacyProjects(readLegacyProjects().filter((item) => !importedTags.has(legacyTag(item.legacyId))));
    } catch (error) {
      toast({ title: "Could not load projects", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [user?.id]);

  useEffect(() => {
    const url = getAppLocation();
    const billing = url.searchParams.get("billing");
    if (!billing) return;
    if (billing === "success") {
      toast({ title: "Stripe checkout completed", description: "Your plan is updating. Your credits will appear shortly." });
    } else if (billing === "credits_success") {
      toast({ title: "Stripe credit purchase completed", description: "Your extra credits will appear shortly." });
    } else if (billing === "canceled") {
      toast({ title: "Checkout canceled", description: "No changes were made to your plan." });
    }
    url.searchParams.delete("billing");
    url.searchParams.delete("session_id");
    navigate(url.pathname + url.search + url.hash, { replace: true });
    load();
    if (billing === "success" || billing === "credits_success") {
      [1500, 4000, 9000].forEach((delay) => {
        window.setTimeout(() => load(), delay);
      });
    }
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return projects;
    return projects.filter((project) => {
      return String(project.title || "").toLowerCase().includes(term) ||
        String(project.description || "").toLowerCase().includes(term);
    });
  }, [projects, query]);

  function ensureProjectCapacity(additional = 1) {
    const limit = Number(entitlement?.project_limit ?? 1);
    if (limit === 0 || projects.length + additional <= limit) return true;
    setBillingOpen(true);
    toast({
      title: "Project limit reached",
      description: `Your ${entitlement?.plan || "free"} plan includes ${limit} cloud project${limit === 1 ? "" : "s"}. Choose a larger plan to add more.`,
    });
    return false;
  }

  async function renameProject(project, title) {
    setWorking(true);
    try {
      const definition = normalizeAppDefinition(project.app_definition, title);
      definition.app.name = title.slice(0, 100);
      await base44.entities.Project.update(project.id, {
        title: definition.app.name,
        app_definition: definition,
      });
      setNameDialog(null);
      toast({ title: "Project renamed" });
      await load();
    } catch (error) {
      toast({ title: "Rename failed", description: error.message, variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }

  async function duplicateProject(project) {
    if (!ensureProjectCapacity()) return;
    setWorking(true);
    try {
      const definition = cloneValue(normalizeAppDefinition(project.app_definition, project.title));
      definition.app.name = project.title + " Copy";
      definition.pages = definition.pages.map((page) => ({
        ...page,
        id: createId("page"),
        components: page.components.map((component) => ({ ...component, id: createId("component") })),
      }));
      const duplicate = await base44.entities.Project.create({
        user_id: user.id,
        user_email: user.email,
        title: definition.app.name,
        description: definition.app.description,
        category: project.category || "SaaS",
        status: "draft",
        color: definition.theme.primary,
        tags: project.tags || [],
        schema_version: definition.schemaVersion,
        app_definition: definition,
        last_opened_at: new Date().toISOString(),
      });
      toast({ title: "Project duplicated" });
      navigate("/projects/" + duplicate.id);
    } catch (error) {
      toast({ title: "Duplicate failed", description: error.message, variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }

  async function deleteProject(project) {
    setWorking(true);
    try {
      await base44.entities.Project.delete(project.id);
      localStorage.removeItem("iabt.cloudDraft." + project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setDeleteTarget(null);
      toast({ title: "Project deleted" });
    } catch (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }

  async function importProject(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ensureProjectCapacity()) return;
    setWorking(true);
    try {
      if (file.size > 2_000_000) throw new Error("The JSON file is too large.");
      const raw = JSON.parse(await file.text());
      const definition = normalizeAppDefinition(raw, file.name.replace(/\.json$/i, ""));
      const project = await base44.entities.Project.create({
        user_id: user.id,
        user_email: user.email,
        title: definition.app.name,
        description: definition.app.description,
        category: "SaaS",
        status: "draft",
        color: definition.theme.primary,
        tags: ["imported"],
        schema_version: definition.schemaVersion,
        app_definition: definition,
        last_opened_at: new Date().toISOString(),
      });
      toast({ title: "IABT project imported" });
      navigate("/projects/" + project.id);
    } catch (error) {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }

  async function migrateLegacyProjects() {
    if (!legacyProjects.length) return;
    if (!ensureProjectCapacity(legacyProjects.length)) return;
    setWorking(true);
    try {
      const records = legacyProjects.map((item) => ({
        user_id: user.id,
        user_email: user.email,
        title: item.definition.app.name || item.name,
        description: item.definition.app.description,
        category: "SaaS",
        status: "draft",
        color: item.definition.theme.primary,
        tags: ["imported", legacyTag(item.legacyId)],
        schema_version: item.definition.schemaVersion,
        app_definition: item.definition,
        last_opened_at: new Date().toISOString(),
      }));
      await base44.entities.Project.bulkCreate(records);
      toast({ title: "Legacy projects imported", description: records.length + " project" + (records.length === 1 ? "" : "s") + " copied to IABT. Local originals were kept." });
      await load();
    } catch (error) {
      toast({ title: "Legacy import failed", description: error.message, variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }

  function startRequest(event) {
    event.preventDefault();
    if (!request.trim()) return;
    const submission = workflow === "document" && documentMode === "export"
      ? "Export this text as a document:\n" + request
      : workflow === "document" ? "Create a document: " + request.trim() : request.trim();
    navigate("/studio?prompt=" + encodeURIComponent(submission));
  }

  const workflows = [
    { id: "build", icon: Code2, label: "Build an app or website", detail: "Shape an idea, preview it, keep the source.", placeholder: "Describe who it is for, what it should do, and how it should look…" },
    { id: "review", icon: FolderOpen, label: "Work with existing files", detail: "Bring your source or brief into the conversation.", placeholder: "Describe the files you want to review or improve. Attach them in the studio…" },
    { id: "document", icon: FileText, label: "Create a document", detail: "Write something new or export your own text.", placeholder: documentMode === "export" ? "Paste the complete text you want to export. Your wording will be preserved…" : "Describe the document you want Jericho to write…" },
  ];
  const selectedWorkflow = workflows.find((item) => item.id === workflow);
  const customReady = capabilities?.openai_responses?.configured === true;

  return (
    <div className="iabt-home home-simple">
      <header className="iabt-home-nav">
        <div className="iabt-home-brand">
          <img className="iabt-mark" src="/iabt-mark.svg" alt="" />
          <div><strong>Jericho</strong><span>by IABT</span></div>
        </div>
        <nav className="home-simple-nav" aria-label="Main navigation">
          <span className="home-current-nav" aria-current="page">Workspace</span>
          <Button variant="ghost" onClick={() => navigate("/studio")}>Studio</Button>
          <Button variant="ghost" onClick={() => navigate("/deliverables")}>My files</Button>
          <details className="home-account">
            <summary aria-label="Account"><UserRound size={17} /> <span>Account</span><ChevronDown size={14} /></summary>
            <div className="home-account-menu">
              <strong>{user?.full_name || "Your account"}</strong>
              {entitlement && <span>{Number(entitlement.total_iabt_credits_remaining || 0).toLocaleString()} credits available</span>}
              <button type="button" onClick={() => setBillingOpen(true)}><CreditCard size={16} /> Plans & billing</button>
              <button type="button" onClick={() => navigate("/support")}><LifeBuoy size={16} /> Help</button>
              {user?.role === "admin" && <button type="button" onClick={() => navigate("/admin/compliance")}><ShieldCheck size={16} /> Administration</button>}
              <button type="button" onClick={() => logout(true)}><LogOut size={16} /> Sign out</button>
            </div>
          </details>
        </nav>
      </header>

      <main className="iabt-home-main">
        <div className="home-workspace-heading">
          <div><span className="home-create-kicker">YOUR CREATIVE WORKSPACE</span><h1>Make something that matters.</h1><p>Build on your ideas. Keep your work moving.</p></div>
          <button className="home-files-shortcut" type="button" onClick={() => navigate("/deliverables")}><FolderOpen size={18} /> Open my files <ArrowRight size={16} /></button>
        </div>
        <section className="home-create" aria-labelledby="home-create-title">
          <div className="home-workflow-list" aria-label="Choose a starting point">
            <h2 id="home-create-title">Where do you want to start?</h2>
            {workflows.map((item) => {
              const Icon = item.icon;
              return <button key={item.id} type="button" aria-pressed={workflow === item.id} onClick={() => { setWorkflow(item.id); requestRef.current?.focus(); }}>
                <span className="home-workflow-icon"><Icon size={21} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><ArrowRight size={16} />
              </button>;
            })}
          </div>
          <div className="home-request-area">
          <div className="home-request-heading"><Sparkles size={18} /><strong>{selectedWorkflow.label}</strong><span>JERICHO STUDIO</span></div>
          {workflow === "document" && <div className="home-document-mode" aria-label="Document action"><button type="button" aria-pressed={documentMode === "export"} onClick={() => setDocumentMode("export")}>Export my text</button><button type="button" aria-pressed={documentMode === "write"} onClick={() => setDocumentMode("write")}>Write with Jericho</button></div>}
          <form className="home-request" onSubmit={startRequest}>
            <label className="sr-only" htmlFor="home-request">Describe what you want to make</label>
            <textarea ref={requestRef} id="home-request" value={request} onChange={(event) => setRequest(event.target.value)} maxLength={12000}
              placeholder={selectedWorkflow.placeholder} rows={4} />
            <div><span>{workflow === "document" && documentMode === "export" ? "Word, PDF, and Markdown files." : "You can attach files in the studio."}</span><Button type="submit" disabled={!request.trim()}>Continue <ArrowRight size={17} /></Button></div>
          </form>
          <div className="home-workflow-status" role="status">
            <span className={customReady ? "is-ready" : ""} aria-hidden="true" />
            {loading ? "Checking available tools…" : !capabilities ? "Tool availability could not load." : customReady ? "Custom creation is configured. Review the plan and cost before it starts." : "File reviews and text exports are available. Custom apps and AI writing await activation."}
            {!loading && !capabilities && <button type="button" onClick={load}>Retry</button>}
          </div>
          </div>
        </section>

        <section className="home-recent" aria-labelledby="home-recent-title">
          <div className="home-section-heading"><div><h2 id="home-recent-title">Your recent work</h2><p>Conversations, results, and the next change.</p></div><button type="button" onClick={() => navigate("/studio")}>Open studio <ArrowRight size={15} /></button></div>
          {workError && <p className="home-load-error" role="alert">{workError} <button type="button" onClick={load}>Retry</button></p>}
          {loading ? <p>Loading your work…</p> : recentWork.length ? <div className="home-recent-grid">
            {recentWork.map((item) => {
              const title = workTitle(item);
              const updated = item.updated_date ? new Date(item.updated_date) : null;
              const dateLabel = updated && !Number.isNaN(updated.getTime()) ? updated.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Saved conversation";
              return <button className="home-work-card" type="button" key={item.id} onClick={() => navigate("/studio?conversation=" + encodeURIComponent(item.id))}>
                <span className="home-work-card-top"><span className="home-work-icon"><LayoutTemplate size={20} /></span><span>{dateLabel}</span></span>
                <strong>{title}</strong><span>Continue working <ArrowRight size={15} /></span>
              </button>;
            })}
          </div> : !workError && <div className="home-recent-empty"><FolderOpen size={25} /><div><strong>A place for work worth keeping.</strong><p>Your conversations and results appear here after you start.</p></div><button type="button" onClick={() => requestRef.current?.focus()}>Start your first project <ArrowRight size={16} /></button></div>}
        </section>

        <details className="home-imported" open={projects.length > 0 || legacyProjects.length > 0 || undefined}>
          <summary>Saved & imported projects <span>{projects.length || ""}</span></summary>
        <section className="iabt-projects">
          {projectError && <p className="home-load-error" role="alert">{projectError} <button type="button" onClick={load}>Retry</button></p>}
          {legacyProjects.length > 0 && (
            <div className="iabt-legacy-banner">
              <div className="iabt-project-icon"><ArchiveRestore /></div>
              <div>
                <strong>{legacyProjects.length} legacy IABT project{legacyProjects.length === 1 ? "" : "s"} found on this computer</strong>
                <span>Copy them into IABT cloud storage. Your original local projects will remain untouched.</span>
              </div>
              <Button variant="outline" onClick={migrateLegacyProjects} disabled={working}>
                {working ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Cloud className="h-4 w-4 mr-2" />}
                Import to cloud
              </Button>
            </div>
          )}
          <div className="iabt-projects-heading">
            <div>
              <p className="iabt-eyebrow"><Cloud className="h-4 w-4" /> Your workspace</p>
              <h2>App projects</h2>
            </div>
            <div className="iabt-project-tools">
              <input ref={importRef} type="file" hidden accept=".json,application/json" onChange={importProject} />
              <Button variant="outline" onClick={() => importRef.current?.click()} disabled={working}>
                <Upload className="h-4 w-4 mr-2" /> Import
              </Button>
              <div className="iabt-search">
                <Search className="h-4 w-4" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="iabt-project-loading"><Loader2 className="h-7 w-7 animate-spin" /> Loading projects…</div>
          ) : filtered.length === 0 ? (
            <div className="iabt-project-empty">
              <div><FolderOpen /></div>
              <h3>{query ? "No projects match that search" : "Create your first app project"}</h3>
              <p>{query ? "Try a different name or clear the search." : "Import a saved IABT project, or start something new above."}</p>
              {!query && (
                <div className="iabt-empty-actions">
                  <Button onClick={() => navigate("/studio")}><Sparkles className="h-4 w-4 mr-2" /> Create with JERICHO Studio</Button>
                </div>
              )}
            </div>
          ) : (
            <div className="iabt-project-grid">
              {filtered.map((project) => {
                const definition = normalizeAppDefinition(project.app_definition, project.title);
                return (
                  <article key={project.id} className="iabt-project-card">
                    <button type="button" className="iabt-project-open" onClick={() => navigate("/projects/" + project.id)}>
                      <div className="iabt-project-icon" style={{ background: definition.theme.primary }}><LayoutTemplate /></div>
                      <div>
                        <span className="iabt-project-status">{project.status || "draft"}</span>
                        <h3>{project.title}</h3>
                        <p>{project.description || "No description yet."}</p>
                      </div>
                      <dl>
                        <div><dt>Pages</dt><dd>{definition.pages.length}</dd></div>
                        <div><dt>Components</dt><dd>{definition.pages.reduce((sum, page) => sum + page.components.length, 0)}</dd></div>
                        <div><dt>Updated</dt><dd>{project.updated_date ? new Date(project.updated_date).toLocaleDateString() : "Today"}</dd></div>
                      </dl>
                      <span className="iabt-open-link">Open project <ArrowRight /></span>
                    </button>
                    <div className="iabt-project-actions">
                      <button type="button" onClick={() => setNameDialog({ mode: "rename", project })}>Rename</button>
                      <button type="button" onClick={() => duplicateProject(project)}><Copy /> Duplicate</button>
                      <button type="button" className="is-danger" onClick={() => setDeleteTarget(project)}><Trash2 /> Delete</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        </details>
      </main>

      <footer className="iabt-home-footer">
        <span>© 2026 IABT · Jericho</span>
        <nav aria-label="Legal">
          <button type="button" onClick={() => navigate("/legal")}>About & policies</button>
          <button type="button" onClick={() => navigate("/privacy")}>Privacy</button>
          <button type="button" onClick={() => navigate("/terms")}>Terms</button>
          <button type="button" onClick={() => navigate("/acceptable-use")}>Acceptable Use</button>
        </nav>
      </footer>

      <BillingDialog
        open={billingOpen}
        onOpenChange={setBillingOpen}
        entitlement={entitlement}
        billingStatus={billingStatus}
      />

      <NameDialog
        open={nameDialog?.mode === "rename"}
        onOpenChange={(open) => { if (!open && !working) setNameDialog(null); }}
        title="Rename project"
        description="Choose a clear, memorable name for this app project."
        label="App name"
        initialValue={nameDialog?.project?.title || ""}
        placeholder="Customer portal, inventory app, booking platform…"
        submitLabel="Save name"
        busy={working}
        maxLength={100}
        onSubmit={(value) => renameProject(nameDialog.project, value)}
      />

      <ConfirmActionDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open && !working) setDeleteTarget(null); }}
        title="Delete this project?"
        description={deleteTarget ? `“${deleteTarget.title}” and its cloud AppDefinition will be permanently removed. Export it first if you may need it later.` : ""}
        confirmLabel="Delete project"
        busy={working}
        onConfirm={() => deleteTarget && deleteProject(deleteTarget)}
      />
    </div>
  );
}
