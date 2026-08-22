import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import {
  ArrowLeft,
  ArrowUpRight,
  AppWindow,
  Bot,
  Box,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Code2,
  Download,
  FileText,
  Gauge,
  Globe2,
  Image as ImageIcon,
  Loader2,
  Menu,
  MessageSquarePlus,
  Music2,
  Network,
  Palette,
  Play,
  RefreshCw,
  Rocket,
  Sparkles,
  Video,
  WandSparkles,
  Workflow,
  X,
} from "lucide-react";

const CREATOR_AGENT = "iabt_creator";
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "waiting_provider"]);
const MODE_OPTIONS = [
  { id: "app", label: "App", icon: AppWindow, description: "Product flows, data and working screens" },
  { id: "website", label: "Website", icon: Globe2, description: "Marketable sites with a clear purpose" },
  { id: "image", label: "Image", icon: ImageIcon, description: "Original visual concepts and assets" },
  { id: "video", label: "Video", icon: Video, description: "Rendered video or a complete production package" },
  { id: "audio", label: "Audio", icon: Music2, description: "Audio direction, scripts and production assets" },
  { id: "document", label: "Document", icon: FileText, description: "Detailed, useful written deliverables" },
  { id: "code", label: "Code", icon: Code2, description: "Implementation-ready source and technical plans" },
  { id: "design", label: "Design", icon: Palette, description: "Professional visual systems and specifications" },
  { id: "gcode", label: "G-code", icon: Box, description: "Machine-ready planning with safety checks" },
  { id: "automation", label: "Automation", icon: Workflow, description: "Repeatable workflows and integrations" },
];

const STARTERS = {
  app: [
    "Create a complete customer portal for a home-services company.",
    "Build an inventory and checkout app that works with a barcode scanner.",
  ],
  website: [
    "Create a premium launch website for a new financial wellness service.",
    "Design a conversion-focused website for a local professional business.",
  ],
  image: [
    "Create a polished campaign image for a modern technology brand.",
    "Design an original hero image with a premium editorial feel.",
  ],
  video: [
    "Create a 20-second cinematic product launch video from nothing.",
    "Produce a short social video with a clear story, shots, sound and captions.",
  ],
  audio: [
    "Create a warm 30-second audio ad with a full script and production direction.",
    "Develop an original podcast intro package and voice direction.",
  ],
  document: [
    "Create a detailed business plan that is ready to present.",
    "Write a polished operating guide with checklists and examples.",
  ],
  code: [
    "Create a production-ready implementation for my software idea.",
    "Design and build a reliable integration with tests and documentation.",
  ],
  design: [
    "Create a complete visual identity direction for a premium new brand.",
    "Design a professional dashboard system with responsive states.",
  ],
  gcode: [
    "Plan a safe CNC sign project and produce reviewable G-code deliverables.",
    "Create a 3D-print preparation package from my product description.",
  ],
  automation: [
    "Create an automation that turns new customer requests into tracked work.",
    "Design a reliable content workflow with approvals and delivery checks.",
  ],
};

function errorMessage(error, fallback = "Something went wrong.") {
  return error?.response?.data?.error || error?.data?.error || error?.message || fallback;
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "";
  return content.text || content.message || content.summary || JSON.stringify(content, null, 2);
}

function titleFromConversation(conversation) {
  if (conversation?.metadata?.title) return conversation.metadata.title;
  const first = conversation?.messages?.find((message) => message.role === "user");
  const text = contentText(first?.content).trim();
  if (text) return text.length > 46 ? text.slice(0, 46) + "…" : text;
  return "New project conversation";
}

function formatMoney(cents = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function readable(value = "") {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stepText(step, index) {
  if (typeof step === "string") return step;
  return step?.title || step?.name || step?.description || "Production step " + (index + 1);
}

function capabilityForMode(capabilities, mode) {
  return capabilities.find((item) =>
    item?.intent === mode ||
    item?.id === mode ||
    item?.capability_id === mode ||
    item?.type === mode
  );
}

function StatusPill({ status }) {
  return <span className={"creator-status status-" + String(status || "draft")}>{readable(status || "draft")}</span>;
}

function ArtifactPreview({ artifact }) {
  const url = artifact.file_url;
  const kind = String(artifact.kind || "").toLowerCase();
  const mime = String(artifact.mime_type || "").toLowerCase();

  if (url && (kind === "image" || mime.startsWith("image/"))) {
    return <img className="creator-artifact-media" src={url} alt={artifact.name || "Generated image"} />;
  }
  if (url && (kind === "video" || mime.startsWith("video/"))) {
    return <video className="creator-artifact-media" src={url} controls preload="metadata" />;
  }
  if (url && (kind === "audio" || mime.startsWith("audio/"))) {
    return <audio className="creator-artifact-audio" src={url} controls preload="metadata" />;
  }
  if (artifact.content) {
    return <pre className="creator-artifact-content">{artifact.content}</pre>;
  }
  return (
    <div className="creator-artifact-placeholder">
      <FileText />
      <span>The deliverable is ready in its original format.</span>
    </div>
  );
}

export default function Studio() {
  const { toast } = useToast();
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();
  const messageEndRef = useRef(null);
  const artifactAccessRef = useRef({});
  const [mode, setMode] = useState("app");
  const [prompt, setPrompt] = useState("");
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [plans, setPlans] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [artifactAccessUrls, setArtifactAccessUrls] = useState({});
  const [capabilities, setCapabilities] = useState([]);
  const [connectionFabric, setConnectionFabric] = useState(null);
  const [autonomyProfile, setAutonomyProfile] = useState(null);
  const [entitlement, setEntitlement] = useState(null);
  const [monthlyUsed, setMonthlyUsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [quoteAccepted, setQuoteAccepted] = useState(false);
  const [refreshingJobs, setRefreshingJobs] = useState({});
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loadError, setLoadError] = useState("");

  const currentMode = MODE_OPTIONS.find((item) => item.id === mode) || MODE_OPTIONS[0];
  const activePlan = plans[0] || null;
  const visibleMessages = messages.filter((message) => !message.hidden && message.role !== "system");
  const latestMessage = visibleMessages.at(-1);
  const assistantWorking = sending || latestMessage?.role === "user" ||
    visibleMessages.some((message) => message.tool_calls?.some((tool) => tool.status === "running"));
  const activeVideoJobs = jobs.filter((job) =>
    job.intent === "video" &&
    ACTIVE_JOB_STATUSES.has(job.status) &&
    job.provider_job_id
  );
  const quoteExpired = Boolean(activePlan?.quote_expires_at && new Date(activePlan.quote_expires_at).getTime() <= Date.now());
  const executionMode = activePlan?.provider_ready && activePlan?.render_ready ? "render" : "prepare";
  const monthlyLimit = Number(entitlement?.ai_monthly_limit || 0);
  const bonusCredits = Number(entitlement?.bonus_ai_credits || 0);
  const remainingCredits = Math.max(0, monthlyLimit - monthlyUsed) + bonusCredits;

  const resolvePrivateArtifacts = useCallback(async (rows = []) => {
    const refreshBefore = Date.now() + 45_000;
    const pending = rows.filter((artifact) => {
      if (!artifact?.id || !artifact.file_uri || artifact.file_url) return false;
      const cached = artifactAccessRef.current[artifact.id];
      const expiresAt = cached?.expires_at ? new Date(cached.expires_at).getTime() : 0;
      return !cached?.url || !expiresAt || expiresAt <= refreshBefore;
    });
    if (!pending.length) return;

    const results = await Promise.allSettled(pending.map(async (artifact) => {
      const response = await base44.functions.invoke("get-artifact-access-url", {
        artifact_id: artifact.id,
      });
      const payload = response?.data || response;
      if (!payload?.ok || !payload.url) throw new Error("Private artifact access is not ready.");
      return {
        artifactId: artifact.id,
        access: {
          url: payload.url,
          expires_at: payload.expires_at,
        },
      };
    }));

    const next = {};
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        next[result.value.artifactId] = result.value.access;
      }
    });
    if (!Object.keys(next).length) return;
    artifactAccessRef.current = { ...artifactAccessRef.current, ...next };
    setArtifactAccessUrls((current) => ({ ...current, ...next }));
  }, []);

  const loadResources = useCallback(async (conversationId, quiet = false) => {
    if (!conversationId) return;
    try {
      const [planRows, jobRows, artifactRows] = await Promise.all([
        base44.entities.CreationPlan.filter({ conversation_id: conversationId }, "-created_date", 25),
        base44.entities.GenerationJob.filter({ conversation_id: conversationId }, "-created_date", 50),
        base44.entities.CreationArtifact.filter({ conversation_id: conversationId }, "-created_date", 100),
      ]);
      setPlans(planRows || []);
      setJobs(jobRows || []);
      setArtifacts(artifactRows || []);
      void resolvePrivateArtifacts(artifactRows || []);
    } catch (error) {
      if (!quiet) {
        toast({ title: "Could not refresh this creation", description: errorMessage(error), variant: "destructive" });
      }
    }
  }, [resolvePrivateArtifacts, toast]);

  const openConversation = useCallback(async (conversationId, quiet = false) => {
    if (!conversationId) return;
    try {
      const full = await base44.agents.getConversation(conversationId);
      if (!full) throw new Error("That conversation is no longer available.");
      setConversation(full);
      setMessages(full.messages || []);
      setQuoteAccepted(false);
      await loadResources(conversationId, quiet);
      setMobileNavOpen(false);
    } catch (error) {
      if (!quiet) {
        toast({ title: "Could not open the conversation", description: errorMessage(error), variant: "destructive" });
      }
    }
  }, [loadResources, toast]);

  const refreshConversationList = useCallback(async () => {
    const rows = await base44.agents.listConversations({
      q: { agent_name: CREATOR_AGENT },
      sort: "-updated_date",
      limit: 30,
      skip: 0,
    });
    setConversations(rows || []);
    return rows || [];
  }, []);

  const createConversation = useCallback(async () => {
    setConversationBusy(true);
    try {
      const created = await base44.agents.createConversation({
        agent_name: CREATOR_AGENT,
        metadata: { surface: "creator_studio" },
      });
      setConversation(created);
      setMessages(created.messages || []);
      setPlans([]);
      setJobs([]);
      setArtifacts([]);
      setQuoteAccepted(false);
      setMobileNavOpen(false);
      await refreshConversationList();
      return created;
    } catch (error) {
      toast({ title: "Could not start a new creation", description: errorMessage(error), variant: "destructive" });
      return null;
    } finally {
      setConversationBusy(false);
    }
  }, [refreshConversationList, toast]);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setLoading(true);
      setLoadError("");
      try {
        const [conversationRows, capabilityResponse, fabricResponse, autonomyResponse, entitlementResponse] = await Promise.all([
          base44.agents.listConversations({
            q: { agent_name: CREATOR_AGENT },
            sort: "-updated_date",
            limit: 30,
            skip: 0,
          }),
          base44.functions.invoke("get-creation-capabilities", {}).catch(() => null),
          base44.functions.invoke("get-connection-fabric", {}).catch(() => null),
          base44.functions.invoke("get-autonomy-profile", {}).catch(() => null),
          base44.functions.invoke("get-account-entitlement", {}).catch(() => null),
        ]);
        if (!active) return;

        setConversations(conversationRows || []);
        const capabilityPayload = capabilityResponse?.data || capabilityResponse;
        setCapabilities(Array.isArray(capabilityPayload?.capabilities) ? capabilityPayload.capabilities : []);

        const fabricPayload = fabricResponse?.data || fabricResponse;
        setConnectionFabric(fabricPayload?.fabric || null);

        const autonomyPayload = autonomyResponse?.data || autonomyResponse;
        setAutonomyProfile(autonomyPayload || null);

        const entitlementPayload = entitlementResponse?.data || entitlementResponse;
        setEntitlement(entitlementPayload?.entitlement || null);

        if (user?.id) {
          const monthlyKey = "month:" + new Date().toISOString().slice(0, 7);
          const usageRows = await base44.entities.AiUsage.filter(
            { user_id: user.id, window_key: monthlyKey },
            "-updated_date",
            1,
          ).catch(() => []);
          if (active) setMonthlyUsed(Number(usageRows?.[0]?.request_count || 0));
        }

        if (conversationRows?.[0]?.id) {
          await openConversation(conversationRows[0].id, true);
        } else {
          const created = await base44.agents.createConversation({
            agent_name: CREATOR_AGENT,
            metadata: { surface: "creator_studio" },
          });
          if (!active) return;
          setConversation(created);
          setMessages(created.messages || []);
          setConversations([created]);
        }
      } catch (error) {
        if (active) setLoadError(errorMessage(error, "The AI project operator could not start."));
      } finally {
        if (active) setLoading(false);
      }
    }

    void bootstrap();
    return () => { active = false; };
  }, [openConversation, user?.id]);

  useEffect(() => {
    if (!conversation?.id) return undefined;
    const unsubscribe = base44.agents.subscribeToConversation(conversation.id, (updated) => {
      if (!updated) return;
      setConversation(updated);
      setMessages(updated.messages || []);
      void loadResources(updated.id, true);
      void refreshConversationList();
    });
    return unsubscribe;
  }, [conversation?.id, loadResources, refreshConversationList]);

  useEffect(() => {
    if (!conversation?.id) return undefined;
    const timer = window.setInterval(() => {
      void loadResources(conversation.id, true);
    }, 6500);
    return () => window.clearInterval(timer);
  }, [conversation?.id, loadResources]);

  const refreshJob = useCallback(async (job, quiet = false) => {
    if (!job?.id) return;
    if (!quiet) setRefreshingJobs((current) => ({ ...current, [job.id]: true }));
    try {
      await base44.functions.invoke("refresh-generation-job", { job_id: job.id });
      await loadResources(job.conversation_id || conversation?.id, true);
    } catch (error) {
      if (!quiet) {
        toast({ title: "Could not refresh the render", description: errorMessage(error), variant: "destructive" });
      }
    } finally {
      if (!quiet) setRefreshingJobs((current) => ({ ...current, [job.id]: false }));
    }
  }, [conversation?.id, loadResources, toast]);

  const activeVideoKey = activeVideoJobs.map((job) => job.id + ":" + job.status).join("|");
  useEffect(() => {
    if (!activeVideoJobs.length) return undefined;
    const timer = window.setInterval(() => {
      activeVideoJobs.forEach((job) => { void refreshJob(job, true); });
    }, 12000);
    return () => window.clearInterval(timer);
  }, [activeVideoKey, refreshJob]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "end" });
  }, [visibleMessages.length, assistantWorking, reduceMotion]);

  useEffect(() => {
    setQuoteAccepted(false);
  }, [activePlan?.id]);

  async function sendPrompt(event) {
    event?.preventDefault();
    const request = prompt.trim();
    if (!request || sending) return;

    setSending(true);
    try {
      const target = conversation || await createConversation();
      if (!target) return;

      const sent = await base44.agents.addMessage(target, {
        role: "user",
        content: request,
        custom_context: [{
          type: "iabt_creation_request",
          message: "The user selected " + mode + " mode. Use this exact conversation_id when calling plan-creation: " + target.id + ". Plan and quote first. Never execute without explicit approval.",
          data: {
            mode,
            selected_mode: mode,
            conversation_id: target.id,
            approval_required: true,
            surface: "creator_studio",
          },
        }],
      });
      setMessages((current) => [...current.filter((item) => item.id !== sent.id), sent]);
      setPrompt("");
      setPlans([]);
      setJobs([]);
      setArtifacts([]);
      setQuoteAccepted(false);
      await refreshConversationList();
    } catch (error) {
      toast({ title: "Your request was not sent", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  async function approvePlan() {
    if (!activePlan || !quoteAccepted || approvalBusy || quoteExpired) return;

    setApprovalBusy(true);
    try {
      const response = await base44.functions.invoke("execute-creation", {
        plan_id: activePlan.id,
        approved: true,
        pricing_version: activePlan.pricing_version,
        accepted_total_cents: Number(activePlan.total_estimated_cost_cents || 0),
        idempotency_key: "studio:" + activePlan.id + ":" + activePlan.pricing_version,
      });
      const payload = response?.data || response;
      if (!payload?.ok) throw new Error(payload?.error || "The approved creation could not start.");

      toast({
        title: payload.reused ? "Creation already in progress" : "Creation started",
        description: payload?.job?.stage || (executionMode === "render"
          ? "IABT is producing the approved deliverable."
          : "IABT is preparing the complete production package."),
      });
      setQuoteAccepted(false);
      await loadResources(conversation?.id, true);
    } catch (error) {
      toast({ title: "Creation did not start", description: errorMessage(error), variant: "destructive" });
    } finally {
      setApprovalBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="creator-loading">
        <div className="creator-loading-mark"><Sparkles /></div>
        <strong>Opening your AI project operator</strong>
        <span>Loading your project context, capabilities and deliverables…</span>
      </div>
    );
  }

  return (
    <div className="creator-shell">
      <AnimatePresence>
        {mobileNavOpen && (
          <motion.button
            type="button"
            className="creator-mobile-scrim"
            aria-label="Close conversation menu"
            onClick={() => setMobileNavOpen(false)}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>

      <aside className={"creator-sidebar " + (mobileNavOpen ? "is-open" : "")}>
        <div className="creator-sidebar-brand">
          <Link to="/" className="creator-brand-link" aria-label="Return to IABT home">
            <span className="creator-brand-mark">IA</span>
            <span><strong>IABT</strong><small>AI project operator</small></span>
          </Link>
          <button type="button" className="creator-mobile-close" onClick={() => setMobileNavOpen(false)} aria-label="Close menu">
            <X />
          </button>
        </div>

        <Button className="creator-new-button" onClick={createConversation} disabled={conversationBusy}>
          {conversationBusy ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />}
          New project conversation
        </Button>

        <div className="creator-history-heading">
          <span>Project conversations</span>
          <small>{conversations.length}</small>
        </div>
        <nav className="creator-history" aria-label="Creation conversations">
          {conversations.length ? conversations.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === conversation?.id ? "is-active" : ""}
              onClick={() => openConversation(item.id)}
            >
              <Bot />
              <span>
                <strong>{titleFromConversation(item)}</strong>
                <small>{formatDate(item.updated_date || item.created_date)}</small>
              </span>
              <ChevronRight />
            </button>
          )) : (
            <div className="creator-history-empty">Your creation history will appear here.</div>
          )}
        </nav>

        <div className="creator-sidebar-foot">
          <div>
            <Gauge />
            <span>
              <strong>{remainingCredits || monthlyLimit || 0} credits available</strong>
              <small>{readable(entitlement?.plan || "free")} plan · usage shown before approval</small>
            </span>
          </div>
          <Link to="/"><ArrowLeft /> App projects</Link>
        </div>
      </aside>

      <main className="creator-main">
        <header className="creator-topbar">
          <button type="button" className="creator-menu-button" onClick={() => setMobileNavOpen(true)} aria-label="Open conversation menu">
            <Menu />
          </button>
          <div className="creator-topbar-title">
            <span className="creator-live-dot" />
            <div><strong>AI Project Operator</strong><small>One conversation from idea through verified deliverables.</small></div>
          </div>
          <div className="creator-topbar-actions">
            <span className="creator-credit-chip"><Sparkles /> {remainingCredits || monthlyLimit || 0} credits</span>
            <Link to="/" className="creator-builder-link"><AppWindow /> Visual app builder</Link>
            <span className="creator-user">{user?.full_name || user?.email || "Creator"}</span>
          </div>
        </header>

        <section className="creator-conversation">
          {loadError ? (
            <div className="creator-error-state">
              <Bot />
              <h1>Your AI project operator needs attention</h1>
              <p>{loadError}</p>
              <Button onClick={() => window.location.reload()}><RefreshCw /> Try again</Button>
            </div>
          ) : visibleMessages.length === 0 ? (
            <motion.div
              className="creator-welcome"
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            >
              <div className="creator-welcome-orb"><WandSparkles /></div>
              <p className="creator-kicker">IABT · AI project operator</p>
              <h1>One conversation. Any connected system. Verified deliverables.</h1>
              <p className="creator-welcome-copy">
                IABT preserves your objective while it discovers and routes work through the best authorized
                adapter available. New models, services, enterprise systems, and secure gateways can be added
                without changing how you work with the operator.
              </p>
              <div className="creator-fabric-strip">
                <Network />
                <div>
                  <strong>Provider-neutral connection fabric</strong>
                  <span>
                    {connectionFabric?.adapters?.length
                      ? connectionFabric.adapters.length + " registered adapter paths · readiness verified before use"
                      : "Models · media · business systems · enterprise gateways · custom tools"}
                  </span>
                  <small>
                    {readable(autonomyProfile?.autonomy?.mode || "bounded_autonomous")}
                    {" · "}
                    {autonomyProfile?.autonomy?.proven_runbook_count || 0} proven runbooks
                    {" · "}API-first, isolated computer fallback
                  </small>
                </div>
              </div>

              <div className="creator-mode-grid" role="list" aria-label="Creation modes">
                {MODE_OPTIONS.map((item) => {
                  const Icon = item.icon;
                  const capability = capabilityForMode(capabilities, item.id);
                  const ready = capability?.provider_ready ?? capability?.ready;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={mode === item.id ? "is-active" : ""}
                      onClick={() => setMode(item.id)}
                    >
                      <span className="creator-mode-icon"><Icon /></span>
                      <span><strong>{item.label}</strong><small>{item.description}</small></span>
                      {ready === true && <i className="is-ready" title="Rendering provider ready" />}
                      {ready === false && <i className="is-prepare" title="Preparation package available" />}
                    </button>
                  );
                })}
              </div>

              <div className="creator-starters">
                <span>Try a detailed starting point</span>
                {(STARTERS[mode] || STARTERS.app).map((starter) => (
                  <button type="button" key={starter} onClick={() => setPrompt(starter)}>
                    {starter}<ArrowUpRight />
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="creator-message-list">
              <div className="creator-thread-intro">
                <span className="creator-thread-mode">{React.createElement(currentMode.icon)} {currentMode.label}</span>
                <button type="button" onClick={createConversation}><MessageSquarePlus /> Start another</button>
              </div>
              <AnimatePresence initial={false}>
                {visibleMessages.map((message, index) => (
                  <motion.article
                    key={message.id || message.created_date || index}
                    className={"creator-message creator-message-" + message.role}
                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24 }}
                  >
                    <div className="creator-message-avatar">
                      {message.role === "user" ? (user?.full_name?.[0] || user?.email?.[0] || "Y").toUpperCase() : <Sparkles />}
                    </div>
                    <div className="creator-message-body">
                      <div className="creator-message-meta">
                        <strong>{message.role === "user" ? "You" : "IABT Operator"}</strong>
                        <span>{formatDate(message.created_date)}</span>
                      </div>
                      <p>{contentText(message.content)}</p>
                      {message.tool_calls?.length > 0 && (
                        <div className="creator-tool-list">
                          {message.tool_calls.map((tool, toolIndex) => (
                            <span key={tool.id || toolIndex} className={"tool-" + tool.status}>
                              {tool.status === "running" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                              {readable(tool.name)} · {readable(tool.status)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.article>
                ))}
              </AnimatePresence>
              {assistantWorking && (
                <div className="creator-message creator-message-assistant creator-thinking">
                  <div className="creator-message-avatar"><Sparkles /></div>
                  <div><span /><span /><span /><small>IABT is planning the work and checking connected capabilities…</small></div>
                </div>
              )}
              <div ref={messageEndRef} />
            </div>
          )}

          <form className="creator-composer" onSubmit={sendPrompt}>
            <div className="creator-composer-mode">
              <span>Creating</span>
              <select value={mode} onChange={(event) => setMode(event.target.value)} aria-label="Creation mode">
                {MODE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void sendPrompt(event);
              }}
              placeholder={"Describe the " + currentMode.label.toLowerCase() + " you want in as much detail as you like…"}
              rows={3}
              maxLength={12000}
            />
            <div className="creator-composer-foot">
              <span><Check /> IABT plans first. Decisions, credentials and approvals stay yours.</span>
              <Button type="submit" disabled={!prompt.trim() || sending || conversationBusy}>
                {sending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Develop plan
              </Button>
            </div>
          </form>
        </section>
      </main>

      <aside className="creator-deliverables">
        <div className="creator-panel-heading">
          <div><span>Production desk</span><small>Plan, quote and deliverables</small></div>
          <button type="button" onClick={() => conversation?.id && loadResources(conversation.id)} aria-label="Refresh production desk">
            <RefreshCw />
          </button>
        </div>

        {!activePlan ? (
          <div className="creator-plan-empty">
            <div><Braces /></div>
            <strong>Your plan will appear here</strong>
            <p>IABT will show the work, provider readiness, credits and any outside cost before asking for approval.</p>
          </div>
        ) : (
          <motion.section
            className="creator-plan-card"
            initial={reduceMotion ? false : { opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <div className="creator-plan-top">
              <span className="creator-plan-icon"><Rocket /></span>
              <div><small>{readable(activePlan.intent)} plan</small><h2>{activePlan.title}</h2></div>
              <StatusPill status={activePlan.status} />
            </div>
            {activePlan.assistant_summary && <p className="creator-plan-summary">{activePlan.assistant_summary}</p>}

            <div className="creator-readiness">
              <div>
                <span className={activePlan.provider_ready ? "is-ready" : "is-limited"}>
                  {activePlan.provider_ready ? <CheckCircle2 /> : <Clock3 />}
                </span>
                <p><strong>{activePlan.provider_ready ? "Provider ready" : "Rendering not connected"}</strong><small>{activePlan.provider || "IABT managed production"}</small></p>
              </div>
              <div>
                <span className={activePlan.render_ready ? "is-ready" : "is-prepare"}>{activePlan.render_ready ? <Play /> : <FileText />}</span>
                <p><strong>{activePlan.render_ready ? "Final rendering available" : "Preparation package available"}</strong><small>{activePlan.render_ready ? "Produces the requested media" : "Produces detailed, usable production assets"}</small></p>
              </div>
            </div>

            {(!activePlan.provider_ready || !activePlan.render_ready) && (
              <div className="creator-honesty-note">
                <FileText />
                <p>
                  <strong>No pretend output.</strong>
                  Approval creates the complete preproduction package described below. It will not label a script,
                  storyboard or plan as a finished {activePlan.intent}.
                </p>
              </div>
            )}

            {activePlan.steps?.length > 0 && (
              <div className="creator-plan-section">
                <h3>Production plan</h3>
                <ol>
                  {activePlan.steps.map((step, index) => (
                    <li key={index}><span>{index + 1}</span><p>{stepText(step, index)}</p></li>
                  ))}
                </ol>
              </div>
            )}

            {activePlan.deliverables?.length > 0 && (
              <div className="creator-plan-section">
                <h3>What you will receive</h3>
                <ul>
                  {activePlan.deliverables.map((item, index) => <li key={index}><Check /> {item}</li>)}
                </ul>
              </div>
            )}

            {activePlan.clarification_questions?.length > 0 && (
              <div className="creator-question-note">
                <strong>IABT still needs your direction</strong>
                {activePlan.clarification_questions.map((question, index) => <span key={index}>{question}</span>)}
                <small>Answer in the conversation before approving.</small>
              </div>
            )}

            {activePlan.warnings?.length > 0 && (
              <div className="creator-warning-list">
                {activePlan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
              </div>
            )}

            <div className="creator-quote">
              <div className="creator-quote-title">
                <span><CircleDollarSign /> Approval quote</span>
                <small>{activePlan.pricing_version}</small>
              </div>
              <dl>
                <div><dt>IABT credits</dt><dd>{Number(activePlan.credit_cost || 0)}</dd></div>
                <div><dt>Provider cost</dt><dd>{formatMoney(activePlan.provider_cost_cents)}</dd></div>
                <div><dt>Platform fee</dt><dd>{formatMoney(activePlan.platform_fee_cents)}</dd></div>
                <div className="is-total"><dt>Estimated total</dt><dd>{formatMoney(activePlan.total_estimated_cost_cents)}</dd></div>
              </dl>
              <p>{activePlan.consent_summary || "The quote is an estimate. No billing action occurs until you explicitly approve."}</p>
              <small className={quoteExpired ? "is-expired" : ""}>
                {quoteExpired ? "This quote has expired. Ask IABT to refresh it." : "Quote valid until " + formatDate(activePlan.quote_expires_at)}
              </small>
            </div>

            {activePlan.status === "quoted" && (
              <div className="creator-approval">
                <label>
                  <input type="checkbox" checked={quoteAccepted} onChange={(event) => setQuoteAccepted(event.target.checked)} />
                  <span>I approve this plan and the exact quote shown above.</span>
                </label>
                <Button
                  onClick={approvePlan}
                  disabled={!quoteAccepted || approvalBusy || quoteExpired || activePlan.clarification_questions?.length > 0}
                >
                  {approvalBusy ? <Loader2 className="animate-spin" /> : executionMode === "render" ? <Play /> : <FileText />}
                  {executionMode === "render" ? "Approve & produce" : "Approve preparation package"}
                </Button>
                <small>Approval is recorded. IABT will not silently start a paid tool.</small>
              </div>
            )}
          </motion.section>
        )}

        {jobs.length > 0 && (
          <section className="creator-jobs">
            <div className="creator-section-title"><span>Production progress</span><small>{jobs.length} job{jobs.length === 1 ? "" : "s"}</small></div>
            {jobs.map((job) => (
              <article key={job.id}>
                <div className="creator-job-head">
                  <span className="creator-job-kind">{job.intent === "video" ? <Video /> : job.mode === "prepare" ? <FileText /> : <Rocket />}</span>
                  <div><strong>{job.stage || readable(job.intent) + " production"}</strong><small>{readable(job.provider)} · {readable(job.mode)}</small></div>
                  <StatusPill status={job.status} />
                </div>
                <div className="creator-progress-track"><span style={{ width: Math.max(3, Number(job.progress || 0)) + "%" }} /></div>
                <div className="creator-job-foot">
                  <span>{Number(job.progress || 0)}% complete</span>
                  {job.intent === "video" && ACTIVE_JOB_STATUSES.has(job.status) && (
                    <button type="button" onClick={() => refreshJob(job)} disabled={refreshingJobs[job.id]}>
                      <RefreshCw className={refreshingJobs[job.id] ? "animate-spin" : ""} /> Refresh render
                    </button>
                  )}
                </div>
                {job.error_message && <p className="creator-job-error">{job.error_message}</p>}
              </article>
            ))}
          </section>
        )}

        {artifacts.length > 0 && (
          <section className="creator-artifacts">
            <div className="creator-section-title"><span>Deliverables</span><small>{artifacts.length} ready</small></div>
            {artifacts.map((artifact) => {
              const cachedAccess = artifactAccessUrls[artifact.id];
              const signedUrlReady = cachedAccess?.url &&
                new Date(cachedAccess.expires_at || 0).getTime() > Date.now();
              const deliveryUrl = artifact.file_url || (signedUrlReady ? cachedAccess.url : "");
              const previewArtifact = {
                name: artifact.name,
                kind: artifact.kind,
                mime_type: artifact.mime_type,
                content: artifact.content,
                file_url: deliveryUrl,
              };
              return (
                <article key={artifact.id}>
                  <ArtifactPreview artifact={previewArtifact} />
                  <div className="creator-artifact-info">
                    <span className="creator-artifact-kind">{readable(artifact.kind)}</span>
                    <strong>{artifact.name}</strong>
                    <small>{artifact.mime_type || "IABT deliverable"} · {readable(artifact.provider)}</small>
                    <div>
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
                      {artifact.project_id && (
                        <Link to={"/projects/" + artifact.project_id}><AppWindow /> Open in builder</Link>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </aside>
    </div>
  );
}
