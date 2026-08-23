import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmActionDialog, NameDialog } from "@/components/ActionDialogs";
import BillingDialog from "@/components/BillingDialog";
import { useToast } from "@/components/ui/use-toast";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Code2,
  Copy,
  CreditCard,
  Download,
  FileJson,
  Loader2,
  Monitor,
  MousePointerClick,
  Package,
  Plus,
  Redo2,
  Save,
  ScanLine,
  Smartphone,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
} from "lucide-react";
import {
  cloneValue,
  createComponent,
  createId,
  createPage,
  normalizeAppDefinition,
  normalizeRoute,
  validateAppDefinition,
} from "@/lib/appDefinition";
import {
  downloadDefinitionJson,
  downloadReactSource,
  downloadReactZip,
  downloadStandaloneHtml,
  downloadStaticZip,
} from "@/lib/exporters";

const DRAFT_PREFIX = "iabt.cloudDraft.";

function moveItem(items, from, to) {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function componentName(component) {
  if (!component) return "Component";
  if (component.type === "Text") return component.props?.value || "Text";
  if (component.type === "Input") return component.props?.placeholder || "Input";
  if (component.type === "Button") return component.props?.label || "Button";
  return component.props?.label || "Scanner";
}

function PreviewComponent({ component, pageId, componentIndex, selected, onSelect, onNavigate, onScan }) {
  const props = component.props || {};
  const className = "iabt-preview-component" + (selected ? " is-selected" : "");

  if (component.type === "Text") {
    return (
      <button type="button" className={className + " iabt-preview-text"} onClick={onSelect}>
        {props.value || "Text block"}
      </button>
    );
  }

  if (component.type === "Input") {
    return (
      <div className={className} onClick={onSelect}>
        <input className="iabt-preview-input" placeholder={props.placeholder || "Enter a value"} onClick={(event) => event.stopPropagation()} />
      </div>
    );
  }

  if (component.type === "ScannerInput") {
    return (
      <label className={className + " iabt-preview-scanner"} onClick={onSelect}>
        <span>{props.label || "Scan code"}</span>
        <input
          className="iabt-preview-input"
          placeholder="Scan or type a code, then press Enter"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const code = event.currentTarget.value.trim();
            if (!code) return;
            event.currentTarget.dispatchEvent(new CustomEvent("iabt:scan", {
              bubbles: true,
              detail: {
                code,
                value: code,
                source: "ScannerInput",
                componentId: component.id,
                pageId,
                componentIndex,
              },
            }));
            onScan(code);
            event.currentTarget.select();
          }}
        />
      </label>
    );
  }

  return (
    <button
      type="button"
      className={className + " iabt-preview-button"}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
        if (props.to) onNavigate(props.to);
      }}
    >
      {props.label || "Continue"}
    </button>
  );
}

export default function Builder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const importRef = useRef(null);
  const [project, setProject] = useState(null);
  const [definition, setDefinition] = useState(null);
  const [selectedPageId, setSelectedPageId] = useState(null);
  const [selectedComponentId, setSelectedComponentId] = useState(null);
  const [previewRoute, setPreviewRoute] = useState("/");
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [aiMode, setAiMode] = useState("replace");
  const [aiProvider, setAiProvider] = useState("");
  const [aiUsage, setAiUsage] = useState(null);
  const [device, setDevice] = useState("phone");
  const [lastScan, setLastScan] = useState("");
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [pageDialog, setPageDialog] = useState(null);
  const [pageDeleteTarget, setPageDeleteTarget] = useState(null);
  const [entitlement, setEntitlement] = useState(null);
  const [billingOpen, setBillingOpen] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadProject() {
      setLoading(true);
      try {
        const [remote, entitlementResponse] = await Promise.all([
          base44.entities.Project.get(id),
          base44.functions.invoke("get-account-entitlement", {}),
        ]);
        if (!active) return;
        const entitlementPayload = entitlementResponse?.data || entitlementResponse;
        setEntitlement(entitlementPayload?.entitlement || null);
        const remoteDefinition = normalizeAppDefinition(remote.app_definition, remote.title);
        let initial = remoteDefinition;
        let recovered = false;
        try {
          const draft = JSON.parse(localStorage.getItem(DRAFT_PREFIX + id) || "null");
          const remoteTime = Date.parse(remote.updated_date || 0) || 0;
          if (draft?.definition && Number(draft.savedAt || 0) > remoteTime) {
            initial = normalizeAppDefinition(draft.definition, remote.title);
            recovered = true;
          }
        } catch {
          localStorage.removeItem(DRAFT_PREFIX + id);
        }
        setProject(remote);
        setDefinition(initial);
        setSelectedPageId(initial.pages[0]?.id || null);
        setPreviewRoute(initial.pages[0]?.route || "/");
        setDirty(recovered);
        setHistory([]);
        setFuture([]);
        if (recovered) toast({ title: "Local draft recovered", description: "Save to cloud when you are ready." });
        base44.entities.Project.update(id, { last_opened_at: new Date().toISOString() }).catch(() => {});
      } catch (error) {
        toast({ title: "Project unavailable", description: error.message, variant: "destructive" });
        navigate("/");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadProject();
    return () => {
      active = false;
    };
  }, [id, navigate, toast]);

  useEffect(() => {
    if (!definition || !project) return;
    localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify({ savedAt: Date.now(), definition }));
  }, [definition, id, project]);

  useEffect(() => {
    const warn = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const selectedPage = useMemo(
    () => definition?.pages.find((page) => page.id === selectedPageId) || definition?.pages[0] || null,
    [definition, selectedPageId],
  );
  const selectedComponent = useMemo(
    () => selectedPage?.components.find((component) => component.id === selectedComponentId) || null,
    [selectedPage, selectedComponentId],
  );
  const previewPage = useMemo(
    () => definition?.pages.find((page) => page.route === previewRoute) || selectedPage || definition?.pages[0] || null,
    [definition, previewRoute, selectedPage],
  );

  function commit(next, recordHistory = true) {
    if (recordHistory && definition) {
      setHistory((current) => [...current.slice(-49), cloneValue(definition)]);
      setFuture([]);
    }
    const normalized = normalizeAppDefinition(next, next?.app?.name || project?.title);
    setDefinition(normalized);
    setDirty(true);
    if (!normalized.pages.some((page) => page.id === selectedPageId)) {
      setSelectedPageId(normalized.pages[0]?.id || null);
      setSelectedComponentId(null);
    }
    if (!normalized.pages.some((page) => page.route === previewRoute)) {
      setPreviewRoute(normalized.pages[0]?.route || "/");
    }
  }

  function mutate(mutator) {
    const next = cloneValue(definition);
    mutator(next);
    commit(next);
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((current) => [cloneValue(definition), ...current].slice(0, 50));
    setHistory((current) => current.slice(0, -1));
    commit(previous, false);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setHistory((current) => [...current.slice(-49), cloneValue(definition)]);
    setFuture((current) => current.slice(1));
    commit(next, false);
  }

  function selectPage(page) {
    setSelectedPageId(page.id);
    setSelectedComponentId(null);
    setPreviewRoute(page.route);
  }

  function addPage(name) {
    const page = createPage(name, definition.pages);
    mutate((next) => next.pages.push(page));
    setSelectedPageId(page.id);
    setSelectedComponentId(null);
    setPreviewRoute(page.route);
  }

  function renamePage(page, name) {
    mutate((next) => {
      const target = next.pages.find((item) => item.id === page.id);
      target.name = name.slice(0, 80);
    });
  }

  function duplicatePage(page) {
    const duplicate = cloneValue(page);
    duplicate.id = createId("page");
    duplicate.name = page.name + " Copy";
    duplicate.route = normalizeRoute(page.name + "-copy-" + Date.now().toString(36));
    duplicate.components = duplicate.components.map((component) => ({ ...component, id: createId("component") }));
    mutate((next) => {
      const index = next.pages.findIndex((item) => item.id === page.id);
      next.pages.splice(index + 1, 0, duplicate);
    });
    setSelectedPageId(duplicate.id);
    setSelectedComponentId(null);
    setPreviewRoute(duplicate.route);
  }

  function deletePage(page) {
    if (definition.pages.length === 1) {
      toast({ title: "Keep at least one page", variant: "destructive" });
      return;
    }
    const index = definition.pages.findIndex((item) => item.id === page.id);
    mutate((next) => {
      next.pages = next.pages.filter((item) => item.id !== page.id);
      for (const item of next.pages) {
        for (const component of item.components) {
          if (component.type === "Button" && component.props?.to === page.route) delete component.props.to;
        }
      }
    });
    const fallback = definition.pages[index - 1] || definition.pages[index + 1];
    setSelectedPageId(fallback?.id || null);
    setSelectedComponentId(null);
    setPreviewRoute(fallback?.route || "/");
  }

  function reorderPage(page, delta) {
    const index = definition.pages.findIndex((item) => item.id === page.id);
    mutate((next) => {
      next.pages = moveItem(next.pages, index, index + delta);
    });
  }

  function addComponent(type) {
    const component = createComponent(type);
    mutate((next) => {
      const page = next.pages.find((item) => item.id === selectedPage.id);
      page.components.push(component);
    });
    setSelectedComponentId(component.id);
  }

  function updatePage(patch) {
    mutate((next) => {
      const page = next.pages.find((item) => item.id === selectedPage.id);
      Object.assign(page, patch);
    });
  }

  function updateComponent(patch) {
    mutate((next) => {
      const page = next.pages.find((item) => item.id === selectedPage.id);
      const component = page.components.find((item) => item.id === selectedComponent.id);
      component.props = { ...component.props, ...patch };
    });
  }

  function deleteComponent() {
    if (!selectedComponent) return;
    mutate((next) => {
      const page = next.pages.find((item) => item.id === selectedPage.id);
      page.components = page.components.filter((item) => item.id !== selectedComponent.id);
    });
    setSelectedComponentId(null);
  }

  function reorderComponent(delta) {
    const index = selectedPage.components.findIndex((item) => item.id === selectedComponent.id);
    mutate((next) => {
      const page = next.pages.find((item) => item.id === selectedPage.id);
      page.components = moveItem(page.components, index, index + delta);
    });
  }

  async function saveCloud() {
    const errors = validateAppDefinition(definition);
    if (errors.length) {
      toast({ title: "Cannot save yet", description: errors[0], variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const updated = await base44.entities.Project.update(id, {
        title: definition.app.name,
        description: definition.app.description,
        schema_version: definition.schemaVersion,
        app_definition: definition,
        status: "in_progress",
        last_opened_at: new Date().toISOString(),
      });
      setProject(updated);
      setDirty(false);
      localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify({ savedAt: Date.parse(updated.updated_date) || Date.now(), definition }));
      toast({ title: "Saved to Base44 cloud" });
    } catch (error) {
      toast({ title: "Cloud save failed", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function generateApp() {
    if (!prompt.trim()) {
      toast({ title: "Describe the app first" });
      return;
    }
    setAiBusy(true);
    setAiProvider("");
    setAiUsage(null);
    try {
      const response = await base44.functions.invoke("generate-app", {
        prompt: prompt.trim(),
        context: {
          app: definition.app,
          pages: definition.pages.map((page) => ({
            name: page.name,
            route: page.route,
            components: page.components.map((component) => component.type),
          })),
        },
      });
      const payload = response?.data || response;
      if (payload?.error) throw new Error(payload.error);
      const generated = normalizeAppDefinition(
        {
          app: payload.app,
          pages: payload.pages,
          theme: definition.theme,
          data: definition.data,
          workflows: definition.workflows,
          integrations: definition.integrations,
          permissions: definition.permissions,
        },
        definition.app.name,
      );

      if (aiMode === "append") {
        commit({
          ...definition,
          app: generated.app,
          pages: [...definition.pages, ...generated.pages],
        });
      } else {
        commit(generated);
      }
      setSelectedPageId(generated.pages[0]?.id || null);
      setSelectedComponentId(null);
      setPreviewRoute(generated.pages[0]?.route || "/");
      setAiProvider(payload.provider || "AI");
      setAiUsage(payload.usage ? { ...payload.usage, plan: payload.entitlement?.plan || "free" } : null);
      toast({ title: "App flow generated", description: generated.pages.length + " pages are ready to edit." });
    } catch (error) {
      const message = error.response?.data?.error || error.message || "AI generation failed.";
      toast({ title: "AI generation failed", description: message, variant: "destructive" });
    } finally {
      setAiBusy(false);
    }
  }

  async function importJson(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("The JSON file is too large.");
      const parsed = JSON.parse(await file.text());
      const imported = normalizeAppDefinition(parsed, project.title);
      const errors = validateAppDefinition(imported);
      if (errors.length) throw new Error(errors[0]);
      commit(imported);
      setSelectedPageId(imported.pages[0].id);
      setSelectedComponentId(null);
      setPreviewRoute(imported.pages[0].route);
      toast({ title: "AppDefinition imported" });
    } catch (error) {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    }
  }

  async function runExport(label, action, requiredEntitlement) {
    if (requiredEntitlement && !entitlement?.[requiredEntitlement]) {
      setBillingOpen(true);
      toast({
        title: label + " requires a larger plan",
        description: requiredEntitlement === "react_export_enabled"
          ? "React exports are included with Pro and Agency."
          : "Static ZIP exports are included with Builder, Pro, and Agency.",
      });
      return;
    }
    setExportBusy(true);
    try {
      await action(definition);
      toast({ title: label + " downloaded" });
    } catch (error) {
      toast({ title: label + " failed", description: error.message, variant: "destructive" });
    } finally {
      setExportBusy(false);
    }
  }

  if (loading || !definition || !selectedPage) {
    return (
      <div className="iabt-loading">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span>Opening IABT project…</span>
      </div>
    );
  }

  return (
    <div className="iabt-builder">
      <header className="iabt-topbar">
        <div className="iabt-brand-row">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/"><ArrowLeft className="h-4 w-4 mr-1" /> Projects</Link>
          </Button>
          <div className="iabt-mark">IA</div>
          <div>
            <p className="iabt-eyebrow">Intelligent App Building Technology</p>
            <h1>{definition.app.name}</h1>
          </div>
        </div>
        <div className="iabt-top-actions">
          <div className="iabt-history-actions">
            <button type="button" onClick={undo} disabled={!history.length} title="Undo"><Undo2 /></button>
            <button type="button" onClick={redo} disabled={!future.length} title="Redo"><Redo2 /></button>
          </div>
          <span className={"iabt-save-state " + (dirty ? "is-dirty" : "")}>
            {dirty ? "Local draft" : <><Check className="h-3.5 w-3.5" /> Cloud saved</>}
          </span>
          <Button variant="outline" onClick={() => setBillingOpen(true)}>
            <CreditCard className="h-4 w-4 mr-1" /> {entitlement?.plan || "free"}
          </Button>
          <Button onClick={saveCloud} disabled={saving || !dirty}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>
      </header>

      <section className="iabt-ai-bar">
        <div className="iabt-ai-icon"><Sparkles className="h-5 w-5" /></div>
        <div className="iabt-ai-copy">
          <strong>Build with AI</strong>
          <span>Describe a SaaS flow, pages, actions, or scanner workflow.</span>
        </div>
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Example: Build a three-page inventory intake app with a scanner, product details, and confirmation page."
          rows={2}
        />
        <select value={aiMode} onChange={(event) => setAiMode(event.target.value)} aria-label="AI generation mode">
          <option value="replace">Replace flow</option>
          <option value="append">Add pages</option>
        </select>
        <Button onClick={generateApp} disabled={aiBusy}>
          {aiBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Generate
        </Button>
        {aiProvider && (
          <small>
            Provider: {aiProvider}
            {aiUsage && ` · ${aiUsage.plan} plan · ${aiUsage.monthly_remaining} included generations left this month · ${aiUsage.bonus_remaining} bonus`}
          </small>
        )}
      </section>

      <div className="iabt-workspace">
        <aside className="iabt-sidebar iabt-leftbar">
          <section>
            <div className="iabt-section-title">
              <span>Pages</span>
              <button type="button" onClick={() => setPageDialog({ mode: "create" })} title="Add page"><Plus className="h-4 w-4" /></button>
            </div>
            <div className="iabt-page-list">
              {definition.pages.map((page, index) => (
                <div key={page.id} className={"iabt-page-row " + (page.id === selectedPage.id ? "is-active" : "")}>
                  <button type="button" className="iabt-page-select" onClick={() => selectPage(page)}>
                    <span>{index + 1}</span>
                    <span><strong>{page.name}</strong><small>{page.route}</small></span>
                  </button>
                  <div className="iabt-row-actions">
                    <button type="button" onClick={() => reorderPage(page, -1)} disabled={index === 0} title="Move up"><ChevronUp /></button>
                    <button type="button" onClick={() => reorderPage(page, 1)} disabled={index === definition.pages.length - 1} title="Move down"><ChevronDown /></button>
                    <button type="button" onClick={() => setPageDialog({ mode: "rename", page })} title="Rename">✎</button>
                    <button type="button" onClick={() => duplicatePage(page)} title="Duplicate"><Copy /></button>
                    <button type="button" onClick={() => {
                      if (definition.pages.length === 1) {
                        toast({ title: "Keep at least one page", variant: "destructive" });
                        return;
                      }
                      setPageDeleteTarget(page);
                    }} title="Delete"><Trash2 /></button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="iabt-section-title"><span>Components</span></div>
            <div className="iabt-palette">
              <button type="button" onClick={() => addComponent("Text")}><Type /><span>Text</span></button>
              <button type="button" onClick={() => addComponent("Input")}><span className="iabt-input-icon">I</span><span>Input</span></button>
              <button type="button" onClick={() => addComponent("Button")}><MousePointerClick /><span>Button</span></button>
              <button type="button" onClick={() => addComponent("ScannerInput")}><ScanLine /><span>Scanner</span></button>
            </div>
          </section>

          <section>
            <div className="iabt-section-title"><span>Import / Export</span></div>
            <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={importJson} />
            <div className="iabt-export-list">
              <button type="button" onClick={() => importRef.current?.click()}><Upload /> Import JSON</button>
              <button type="button" onClick={() => runExport("AppDefinition", downloadDefinitionJson)}><FileJson /> JSON</button>
              <button type="button" onClick={() => runExport("Standalone HTML", downloadStandaloneHtml)}><Download /> HTML</button>
              <button type="button" onClick={() => runExport("Static HTML ZIP", downloadStaticZip, "static_zip_export_enabled")}><Package /> HTML ZIP</button>
              <button type="button" onClick={() => runExport("React source", downloadReactSource, "react_export_enabled")}><Code2 /> React</button>
              <button type="button" onClick={() => runExport("React project ZIP", downloadReactZip, "react_export_enabled")}><Package /> React ZIP</button>
            </div>
            {exportBusy && <p className="iabt-inline-status"><Loader2 className="animate-spin" /> Preparing download…</p>}
          </section>
        </aside>

        <main className="iabt-canvas">
          <div className="iabt-canvas-toolbar">
            <div>
              <span className="iabt-live-dot" />
              Live preview
              <small>{previewPage?.route}</small>
            </div>
            <div className="iabt-device-buttons">
              <button type="button" className={device === "phone" ? "is-active" : ""} onClick={() => setDevice("phone")} title="Phone"><Smartphone /></button>
              <button type="button" className={device === "tablet" ? "is-active" : ""} onClick={() => setDevice("tablet")} title="Tablet"><Monitor /></button>
            </div>
          </div>
          <div className={"iabt-device-wrap is-" + device}>
            <div
              className="iabt-device"
              style={{
                "--preview-primary": definition.theme.primary,
                "--preview-bg": definition.theme.background,
                "--preview-surface": definition.theme.surface,
                "--preview-text": definition.theme.text,
                "--preview-radius": definition.theme.radius + "px",
              }}
            >
              <div className="iabt-device-status"><span>9:41</span><span>● ● ●</span></div>
              <nav className="iabt-preview-nav">
                {definition.pages.map((page) => (
                  <button key={page.id} type="button" className={previewPage?.id === page.id ? "is-active" : ""} onClick={() => setPreviewRoute(page.route)}>
                    {page.name}
                  </button>
                ))}
              </nav>
              <div className="iabt-preview-body">
                <p className="iabt-preview-kicker">{definition.app.name}</p>
                <h2>{previewPage?.name}</h2>
                <div className="iabt-preview-stack">
                  {previewPage?.components.map((component, componentIndex) => (
                    <PreviewComponent
                      key={component.id}
                      component={component}
                      pageId={previewPage.id}
                      componentIndex={componentIndex}
                      selected={selectedPage.id === previewPage.id && selectedComponentId === component.id}
                      onSelect={() => {
                        setSelectedPageId(previewPage.id);
                        setSelectedComponentId(component.id);
                      }}
                      onNavigate={setPreviewRoute}
                      onScan={setLastScan}
                    />
                  ))}
                  {!previewPage?.components.length && (
                    <button type="button" className="iabt-empty-preview" onClick={() => selectPage(previewPage)}>
                      Add a component from the palette
                    </button>
                  )}
                </div>
                <p className="iabt-scan-result">{lastScan ? "Last scan: " + lastScan : "Scanner ready"}</p>
              </div>
            </div>
          </div>
        </main>

        <aside className="iabt-sidebar iabt-inspector">
          <section>
            <div className="iabt-section-title"><span>App settings</span><Cloud className="h-4 w-4" /></div>
            <label>
              <span>App name</span>
              <Input value={definition.app.name} maxLength={100} onChange={(event) => mutate((next) => { next.app.name = event.target.value; })} />
            </label>
            <label>
              <span>Description</span>
              <Textarea value={definition.app.description} rows={3} maxLength={500} onChange={(event) => mutate((next) => { next.app.description = event.target.value; })} />
            </label>
            <div className="iabt-theme-grid">
              {[
                ["primary", "Brand"],
                ["background", "Background"],
                ["surface", "Surface"],
                ["text", "Text"],
              ].map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input type="color" value={definition.theme[key]} onChange={(event) => mutate((next) => { next.theme[key] = event.target.value; })} />
                </label>
              ))}
            </div>
          </section>

          <section>
            <div className="iabt-section-title">
              <span>{selectedComponent ? "Component inspector" : "Page inspector"}</span>
              {selectedComponent && <small>{selectedComponent.type}</small>}
            </div>

            {!selectedComponent ? (
              <>
                <label>
                  <span>Page name</span>
                  <Input value={selectedPage.name} maxLength={80} onChange={(event) => updatePage({ name: event.target.value })} />
                </label>
                <label>
                  <span>Route</span>
                  <Input
                    value={selectedPage.route}
                    onChange={(event) => {
                      const previous = selectedPage.route;
                      const route = normalizeRoute(event.target.value, selectedPage.name);
                      mutate((next) => {
                        const page = next.pages.find((item) => item.id === selectedPage.id);
                        page.route = route;
                        for (const item of next.pages) {
                          for (const component of item.components) {
                            if (component.type === "Button" && component.props?.to === previous) component.props.to = route;
                          }
                        }
                      });
                      setPreviewRoute(route);
                    }}
                  />
                </label>
                <p className="iabt-help">Select a preview component to edit its content and behavior.</p>
              </>
            ) : (
              <>
                <div className="iabt-selected-summary">
                  <strong>{componentName(selectedComponent)}</strong>
                  <span>{selectedComponent.type}</span>
                </div>
                {selectedComponent.type === "Text" && (
                  <label><span>Text</span><Textarea rows={5} value={selectedComponent.props.value || ""} onChange={(event) => updateComponent({ value: event.target.value })} /></label>
                )}
                {selectedComponent.type === "Input" && (
                  <label><span>Placeholder</span><Input value={selectedComponent.props.placeholder || ""} onChange={(event) => updateComponent({ placeholder: event.target.value })} /></label>
                )}
                {selectedComponent.type === "ScannerInput" && (
                  <label><span>Scanner label</span><Input value={selectedComponent.props.label || ""} onChange={(event) => updateComponent({ label: event.target.value })} /></label>
                )}
                {selectedComponent.type === "Button" && (
                  <>
                    <label><span>Button label</span><Input value={selectedComponent.props.label || ""} onChange={(event) => updateComponent({ label: event.target.value })} /></label>
                    <label>
                      <span>Navigate to</span>
                      <select value={selectedComponent.props.to || ""} onChange={(event) => updateComponent({ to: event.target.value || undefined })}>
                        <option value="">No navigation</option>
                        {definition.pages.map((page) => <option key={page.id} value={page.route}>{page.name} ({page.route})</option>)}
                      </select>
                    </label>
                  </>
                )}
                <div className="iabt-inspector-actions">
                  <Button variant="outline" size="sm" onClick={() => reorderComponent(-1)} disabled={selectedPage.components[0]?.id === selectedComponent.id}><ChevronUp className="h-4 w-4 mr-1" /> Up</Button>
                  <Button variant="outline" size="sm" onClick={() => reorderComponent(1)} disabled={selectedPage.components[selectedPage.components.length - 1]?.id === selectedComponent.id}><ChevronDown className="h-4 w-4 mr-1" /> Down</Button>
                  <Button variant="destructive" size="sm" onClick={deleteComponent}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
                </div>
              </>
            )}
          </section>
        </aside>
      </div>

      <BillingDialog
        open={billingOpen}
        onOpenChange={setBillingOpen}
        entitlement={entitlement}
      />

      <NameDialog
        open={Boolean(pageDialog)}
        onOpenChange={(open) => { if (!open) setPageDialog(null); }}
        title={pageDialog?.mode === "rename" ? "Rename page" : "Add a page"}
        description={pageDialog?.mode === "rename"
          ? "Use a concise label that will be easy to recognize in navigation."
          : "Add another screen to this app flow. IABT will create a unique route automatically."}
        label="Page name"
        initialValue={pageDialog?.mode === "rename" ? pageDialog.page?.name || "" : "New Page"}
        placeholder="Inventory, Checkout, Customer details…"
        submitLabel={pageDialog?.mode === "rename" ? "Save name" : "Add page"}
        maxLength={80}
        onSubmit={(value) => {
          if (pageDialog?.mode === "rename") renamePage(pageDialog.page, value);
          else addPage(value);
          setPageDialog(null);
        }}
      />

      <ConfirmActionDialog
        open={Boolean(pageDeleteTarget)}
        onOpenChange={(open) => { if (!open) setPageDeleteTarget(null); }}
        title="Delete this page?"
        description={pageDeleteTarget ? `“${pageDeleteTarget.name}” will be removed. Buttons that point to its route will be disconnected. You can still use Undo immediately afterward.` : ""}
        confirmLabel="Delete page"
        onConfirm={() => {
          if (pageDeleteTarget) deletePage(pageDeleteTarget);
          setPageDeleteTarget(null);
        }}
      />
    </div>
  );
}
