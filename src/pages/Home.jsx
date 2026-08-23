import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmActionDialog, NameDialog } from "@/components/ActionDialogs";
import BillingDialog from "@/components/BillingDialog";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import {
  ArchiveRestore,
  ArrowRight,
  Cloud,
  Copy,
  CreditCard,
  FolderOpen,
  LayoutTemplate,
  Loader2,
  Network,
  LogOut,
  Plus,
  Repeat2,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  cloneValue,
  createDefaultAppDefinition,
  createId,
  normalizeAppDefinition,
} from "@/lib/appDefinition";
import { legacyTag, readLegacyProjects } from "@/lib/legacyProjects";

export default function Home() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, logout } = useAuth();
  const importRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [query, setQuery] = useState("");
  const [legacyProjects, setLegacyProjects] = useState([]);
  const [entitlement, setEntitlement] = useState(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const [nameDialog, setNameDialog] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [records, entitlementResponse] = await Promise.all([
        base44.entities.Project.list("-updated_date", 250),
        user?.id
          ? base44.functions.invoke("get-account-entitlement", {})
          : Promise.resolve(null),
      ]);
      const entitlementPayload = entitlementResponse?.data || entitlementResponse;
      setProjects(records);
      setEntitlement(entitlementPayload?.entitlement || null);
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
    const url = new URL(window.location.href);
    const billing = url.searchParams.get("billing");
    if (!billing) return;
    if (billing === "success") {
      toast({ title: "Stripe test checkout completed", description: "Your plan will update after the verified webhook is processed." });
    } else if (billing === "credits_success") {
      toast({ title: "Stripe test credit purchase completed", description: "Your extra AI credits will appear after the verified webhook is processed." });
    } else if (billing === "canceled") {
      toast({ title: "Checkout canceled", description: "No changes were made to your plan." });
    }
    url.searchParams.delete("billing");
    url.searchParams.delete("session_id");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    load();
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

  async function createProject(title) {
    if (!ensureProjectCapacity()) return;
    setWorking(true);
    try {
      const definition = createDefaultAppDefinition(title);
      const project = await base44.entities.Project.create({
        title: definition.app.name,
        description: definition.app.description,
        category: "SaaS",
        status: "draft",
        color: definition.theme.primary,
        tags: [],
        schema_version: definition.schemaVersion,
        app_definition: definition,
        last_opened_at: new Date().toISOString(),
      });
      setNameDialog(null);
      navigate("/projects/" + project.id);
    } catch (error) {
      toast({ title: "Project creation failed", description: error.message, variant: "destructive" });
    } finally {
      setWorking(false);
    }
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
      toast({ title: "Legacy projects imported", description: records.length + " project" + (records.length === 1 ? "" : "s") + " copied to Base44. Local originals were kept." });
      await load();
    } catch (error) {
      toast({ title: "Legacy import failed", description: error.message, variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="iabt-home">
      <header className="iabt-home-nav">
        <div className="iabt-home-brand">
          <div className="iabt-mark">IA</div>
          <div><strong>IABT</strong><span>Intelligent App Building Technology</span></div>
        </div>
        <div className="iabt-home-user">
          <Button size="sm" onClick={() => navigate("/studio")}><Sparkles className="h-4 w-4 mr-1" /> AI Project Operator</Button>
          {entitlement && <span className="iabt-plan-badge">{entitlement.plan} plan</span>}
          <Button variant="outline" size="sm" onClick={() => setBillingOpen(true)}>
            <CreditCard className="h-4 w-4 mr-1" /> Plans & billing
          </Button>
          <span>{user?.full_name || user?.email || "Builder"}</span>
          <Button variant="ghost" size="sm" onClick={() => logout(true)}><LogOut className="h-4 w-4 mr-1" /> Sign out</Button>
        </div>
      </header>

      <main className="iabt-home-main">
        <section className="iabt-hero">
          <div>
            <p className="iabt-eyebrow"><Sparkles className="h-4 w-4" /> IABT · AI project operator</p>
            <h1>One conversation. Any connected system. Verified deliverables.</h1>
            <p>IABT keeps the project context, plans the work, and routes authorized steps through a provider-neutral connection fabric. Today’s tools can be replaced or expanded with future models, services, enterprise systems, and secure gateways without rebuilding the experience.</p>
            <div className="iabt-hero-actions">
              <Button size="lg" onClick={() => navigate("/studio")}>
                <Sparkles className="h-4 w-4 mr-2" /> Start a project conversation
              </Button>
              <Button size="lg" variant="outline" onClick={() => ensureProjectCapacity() && setNameDialog({ mode: "create" })} disabled={working}>
                {working ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Open visual app builder
              </Button>
              <input ref={importRef} type="file" hidden accept=".json,application/json" onChange={importProject} />
              <Button size="lg" variant="ghost" onClick={() => importRef.current?.click()} disabled={working}>
                <Upload className="h-4 w-4 mr-2" /> Import project
              </Button>
            </div>
            <div className="iabt-hero-capabilities" aria-label="AI project operator capabilities">
              <span>Persistent context</span><span>Provider-neutral routing</span><span>Expandable connection fabric</span><span>Authorized execution</span><span>Verified results</span>
            </div>
          </div>
          <div className="iabt-hero-visual" aria-hidden="true">
            <div className="iabt-orbit orbit-one" />
            <div className="iabt-orbit orbit-two" />
            <div className="iabt-hero-card">
              <Sparkles />
              <strong>Your goal → The right connection → Verified delivery</strong>
              <span>Context · discovery · routing · execution · verification</span>
            </div>
          </div>
        </section>

        <section className="iabt-operator-flow" aria-labelledby="iabt-operator-flow-title">
          <div className="iabt-operator-flow-heading">
            <div>
              <p className="iabt-eyebrow"><Sparkles className="h-4 w-4" /> How IABT works</p>
              <h2 id="iabt-operator-flow-title">A capable operator that stays with the project.</h2>
            </div>
            <p>IABT proceeds independently where it is authorized and pauses only when your judgment, credentials, or approval are genuinely required.</p>
          </div>
          <div className="iabt-operator-steps">
            <article><span>01</span><strong>Keep the context</strong><p>Your goal, decisions, plans, and prior work stay together in one project conversation.</p></article>
            <article><span>02</span><strong>Plan and coordinate</strong><p>IABT breaks down the work and selects the connected tools or services suited to each step.</p></article>
            <article><span>03</span><strong>Execute with authority</strong><p>It completes authorized in-scope work and brings you only the decisions or approvals it cannot make.</p></article>
            <article><span>04</span><strong>Verify and deliver</strong><p>It checks results, reports real limits and costs, and returns usable deliverables with a clear status.</p></article>
          </div>
        </section>

        <section className="iabt-connection-fabric" aria-labelledby="iabt-connection-title">
          <div className="iabt-connection-heading">
            <div className="iabt-connection-mark"><Network /></div>
            <div>
              <p className="iabt-eyebrow">IABT connection fabric</p>
              <h2 id="iabt-connection-title">Not limited to today’s providers. Designed to connect to what comes next.</h2>
            </div>
            <p>IABT separates your objective from the system that performs each step. Every adapter declares its capabilities, authorization method, cost, risk, and verification requirements before IABT treats it as usable.</p>
          </div>
          <div className="iabt-connection-lanes">
            <article><span>ACTIVE NOW</span><strong>Models and media</strong><p>Managed intelligence, images, structured apps, documents, code, and provider-gated rendering.</p></article>
            <article><span>AUTHORIZE</span><strong>Business systems</strong><p>Files, communications, CRM, finance, analytics, commerce, data, and development platforms through scoped connections.</p></article>
            <article><span>ADAPTER-READY</span><strong>Enterprise and mainframes</strong><p>Customer-controlled bridges for APIs, databases, SFTP, queues, batch jobs, ERP, and systems of record.</p></article>
            <article><span>VERIFY FIRST</span><strong>Custom tools and machines</strong><p>Tool servers, webhooks, scanners, devices, and simulation-first machine workflows with explicit safety gates.</p></article>
          </div>
          <div className="iabt-connection-rule">
            <strong>Discover → authorize → quote → execute → verify.</strong>
            <span>“Adapter-ready” never means “already connected.” IABT proves access before it claims control.</span>
          </div>
        </section>

        <section className="iabt-autonomy-engine" aria-labelledby="iabt-autonomy-title">
          <div className="iabt-autonomy-heading">
            <div className="iabt-autonomy-mark"><Repeat2 /></div>
            <div>
              <p className="iabt-eyebrow">Reusable autonomy</p>
              <h2 id="iabt-autonomy-title">Teach it once. Let IABT handle the repeatable work.</h2>
              <p>When a workflow succeeds and its result is verified, IABT can preserve the path as a versioned runbook—complete with permissions, cost limits, retries, recovery, and proof of completion.</p>
            </div>
          </div>
          <div className="iabt-autonomy-grid">
            <article><span>QUALITY FIRST</span><strong>Best connected intelligence</strong><p>Route each workload to the strongest suitable connected model, record what actually ran, and fall back without changing the user’s goal.</p></article>
            <article><span>PROVEN PATHS</span><strong>Reusable runbook memory</strong><p>A pathway becomes reusable only after the final state passes its verification contract.</p></article>
            <article><span>API → BROWSER</span><strong>Hands-off execution</strong><p>Use supported APIs first. When necessary, replay a permitted workflow in an isolated browser or desktop runner.</p></article>
            <article><span>PRECISE HANDOFF</span><strong>Pause only where required</strong><p>IABT completes every safe step before requesting OAuth, MFA, identity checks, payments, destructive changes, or other required owner action.</p></article>
          </div>
          <div className="iabt-autonomy-status">
            <span><i className="is-live" /> Bounded-autonomy policy active</span>
            <span><i className="is-live" /> Runbook registry ready</span>
            <span><i /> Computer-use runtime requires connection</span>
          </div>
        </section>

        <section className="iabt-projects">
          {legacyProjects.length > 0 && (
            <div className="iabt-legacy-banner">
              <div className="iabt-project-icon"><ArchiveRestore /></div>
              <div>
                <strong>{legacyProjects.length} legacy IABT project{legacyProjects.length === 1 ? "" : "s"} found on this computer</strong>
                <span>Copy them into Base44 cloud storage. Your original local projects will remain untouched.</span>
              </div>
              <Button variant="outline" onClick={migrateLegacyProjects} disabled={working}>
                {working ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Cloud className="h-4 w-4 mr-2" />}
                Import to cloud
              </Button>
            </div>
          )}
          <div className="iabt-projects-heading">
            <div>
              <p className="iabt-eyebrow"><Cloud className="h-4 w-4" /> Base44 cloud workspace</p>
              <h2>Your app projects</h2>
            </div>
            <div className="iabt-search">
              <Search className="h-4 w-4" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" />
            </div>
          </div>

          {loading ? (
            <div className="iabt-project-loading"><Loader2 className="h-7 w-7 animate-spin" /> Loading projects…</div>
          ) : filtered.length === 0 ? (
            <div className="iabt-project-empty">
              <div><FolderOpen /></div>
              <h3>{query ? "No projects match that search" : "Create your first SaaS app"}</h3>
              <p>{query ? "Try a different name or clear the search." : "Start in Creator Studio for conversational production, or open the specialist visual builder for an AppDefinition project."}</p>
              {!query && (
                <div className="iabt-empty-actions">
                  <Button onClick={() => navigate("/studio")}><Sparkles className="h-4 w-4 mr-2" /> Start with the AI operator</Button>
                  <Button variant="outline" onClick={() => ensureProjectCapacity() && setNameDialog({ mode: "create" })}><Plus className="h-4 w-4 mr-2" /> New visual app</Button>
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
                      <span className="iabt-open-link">Open builder <ArrowRight /></span>
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
      </main>

      <BillingDialog
        open={billingOpen}
        onOpenChange={setBillingOpen}
        entitlement={entitlement}
      />

      <NameDialog
        open={Boolean(nameDialog)}
        onOpenChange={(open) => { if (!open && !working) setNameDialog(null); }}
        title={nameDialog?.mode === "rename" ? "Rename project" : "Create a new app"}
        description={nameDialog?.mode === "rename"
          ? "Choose a clear, memorable name for this app project."
          : "Start with a project name. You can refine the app name and description inside the builder."}
        label="App name"
        initialValue={nameDialog?.mode === "rename" ? nameDialog.project?.title || "" : "My SaaS App"}
        placeholder="Customer portal, inventory app, booking platform…"
        submitLabel={nameDialog?.mode === "rename" ? "Save name" : "Create app"}
        busy={working}
        maxLength={100}
        onSubmit={(value) => nameDialog?.mode === "rename"
          ? renameProject(nameDialog.project, value)
          : createProject(value)}
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
