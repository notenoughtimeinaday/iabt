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
  Bot,
  Cloud,
  Copy,
  CreditCard,
  Download,
  FolderOpen,
  LayoutTemplate,
  Loader2,
  LogOut,
  PlugZap,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UsersRound,
} from "lucide-react";
import {
  cloneValue,
  createId,
  normalizeAppDefinition,
} from "@/lib/appDefinition";
import { legacyTag, readLegacyProjects } from "@/lib/legacyProjects";
import "@/home-exchange.css";

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
  const [billingStatus, setBillingStatus] = useState(null);
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
    const url = new URL(window.location.href);
    const billing = url.searchParams.get("billing");
    if (!billing) return;
    if (billing === "success") {
      toast({ title: "Stripe checkout completed", description: "Your plan will update after the verified webhook is processed." });
    } else if (billing === "credits_success") {
      toast({ title: "Stripe credit purchase completed", description: "Your extra IABT credits will appear after the verified webhook is processed." });
    } else if (billing === "canceled") {
      toast({ title: "Checkout canceled", description: "No changes were made to your plan." });
    }
    url.searchParams.delete("billing");
    url.searchParams.delete("session_id");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
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
          <img className="iabt-mark" src="/iabt-mark.svg" alt="" />
          <div><strong>Intelligent Application Building Tool</strong><span>IABT · Powered by JERICHO Studio</span></div>
        </div>
        <div className="iabt-home-user">
          <Button size="sm" onClick={() => navigate("/studio")}><Sparkles className="h-4 w-4 mr-1" /> JERICHO Studio</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/deliverables")}><Download className="h-4 w-4 mr-1" /> Deliverables</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/integrations")}><PlugZap className="h-4 w-4 mr-1" /> Integrations</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/exchange")}><UsersRound className="h-4 w-4 mr-1" /> Exchange</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/connect")}><Bot className="h-4 w-4 mr-1" /> Connect AI</Button>
          {entitlement && <span className="iabt-plan-badge">{entitlement.plan} plan</span>}
          {entitlement && <span className="iabt-credit-badge">{Number(entitlement.total_iabt_credits_remaining || 0).toLocaleString()} credits</span>}
          <Button variant="outline" size="sm" onClick={() => setBillingOpen(true)}>
            <CreditCard className="h-4 w-4 mr-1" /> Plans & billing
          </Button>
          {user?.role === "admin" && (
            <Button variant="outline" size="sm" onClick={() => navigate("/admin/compliance")}>
              <ShieldCheck className="h-4 w-4 mr-1" /> Profit & compliance
            </Button>
          )}
          <span>{user?.full_name || user?.email || "Creator"}</span>
          <Button variant="ghost" size="sm" onClick={() => logout(true)}><LogOut className="h-4 w-4 mr-1" /> Sign out</Button>
        </div>
      </header>

      <main className="iabt-home-main">
        <section className="iabt-hero">
          <div>
            <p className="iabt-eyebrow"><Sparkles className="h-4 w-4" /> Intelligent Application Building Tool</p>
            <h1>Bring an objective. Leave with a finished deliverable.</h1>
            <p>Tell JERICHO what you need in plain language. It plans the work, shows you the cost before production, and keeps every finished file in your Deliverables library.</p>
            <div className="iabt-hero-actions">
              <Button size="lg" onClick={() => navigate("/studio")}>
                <Sparkles className="h-4 w-4 mr-2" /> Open JERICHO Studio
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate("/deliverables")}>
                <Download className="h-4 w-4 mr-2" /> View deliverables
              </Button>
            </div>
          </div>
          <div className="iabt-hero-visual" aria-hidden="true">
            <div className="iabt-orbit orbit-one" />
            <div className="iabt-orbit orbit-two" />
            <div className="iabt-hero-card">
              <img className="iabt-hero-emblem" src="/iabt-mark.svg" alt="" />
              <strong>Describe → approve → receive</strong>
              <span>One conversation from idea to verified result.</span>
            </div>
          </div>
        </section>

        <section className="iabt-operator-flow" aria-labelledby="iabt-operator-flow-title">
          <div className="iabt-operator-flow-heading">
            <div>
              <p className="iabt-eyebrow"><Sparkles className="h-4 w-4" /> A simpler way to create</p>
              <h2 id="iabt-operator-flow-title">Three clear steps. No complicated setup.</h2>
            </div>
            <p>JERICHO keeps the technical details in the background and asks for your approval only when it matters.</p>
          </div>
          <div className="iabt-operator-steps">
            <article><span>01</span><strong>Describe the outcome</strong><p>Explain what you want to create and add any important details or files.</p></article>
            <article><span>02</span><strong>Review the plan</strong><p>See the proposed work, expected cost, and any approvals before production begins.</p></article>
            <article><span>03</span><strong>Receive the result</strong><p>Open or download the finished file from your permanent Deliverables library.</p></article>
          </div>
        </section>

        <section className="iabt-exchange-callout" aria-labelledby="iabt-exchange-title">
          <div className="iabt-exchange-callout-copy">
            <p className="iabt-eyebrow"><UsersRound className="h-4 w-4" /> IABT Exchange beta</p>
            <h2 id="iabt-exchange-title">Find the missing capability. Form the right team.</h2>
            <p>Create a match-safe professional profile, map what a project still needs, review explainable collaborator matches, and open a private room only after both people accept the introduction.</p>
            <div className="iabt-exchange-callout-actions">
              <Button onClick={() => navigate("/exchange")}><UsersRound className="h-4 w-4 mr-2" /> Open Exchange</Button>
              <Button variant="outline" onClick={() => navigate("/exchange/assistant")}><Bot className="h-4 w-4 mr-2" /> Ask Exchange AI</Button>
            </div>
          </div>
          <div className="iabt-exchange-principles">
            <article><Sparkles /><div><strong>Capability-gap analysis</strong><span>JERICHO helps identify the expertise, credentials, and institutional relationships a project is missing.</span></div></article>
            <article><Search /><div><strong>Explainable matching</strong><span>Deterministic scores show why a profile fits. There is no random ranking or public contact directory.</span></div></article>
            <article><ShieldCheck /><div><strong>Mutual consent</strong><span>Identity and selected contact details remain concealed until an introduction is accepted by both members.</span></div></article>
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
              <h3>{query ? "No projects match that search" : "Create your first SaaS app"}</h3>
              <p>{query ? "Try a different name or clear the search." : "Start in JERICHO Studio. It plans, quotes, creates, and verifies the generated app package for review and delivery."}</p>
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
                      <span className="iabt-open-link">View generated project <ArrowRight /></span>
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

      <footer className="iabt-home-footer">
        <span>© 2026 Intelligent Application Building Tool (IABT) · Powered by JERICHO Studio.</span>
        <nav aria-label="Legal">
          <button type="button" onClick={() => navigate("/legal")}>Trust & Legal Center</button>
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