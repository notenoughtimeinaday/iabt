import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import FileUploader from "@/components/FileUploader";
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
  Paperclip,
  PlugZap,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Trash2,
  Video,
  Workflow,
  X,
} from "lucide-react";

const CREATOR_AGENT = "iabt_creator";
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "waiting_provider"]);
const ATTACHED_ASSET_LIMIT = 12;
const MODE_OPTIONS = [
  { id: "app", label: "App", icon: AppWindow, description: "Product flows, data and working screens" },
  { id: "website", label: "Website", icon: Globe2, description: "Marketable sites with a clear purpose" },
  { id: "image", label: "Image", icon: ImageIcon, description: "Original visual concepts and assets" },
  { id: "video", label: "Video", icon: Video, description: "MP4 rendering when active · preproduction otherwise" },
  { id: "audio", label: "Audio", icon: Music2, description: "Playable MP3 when active · preproduction otherwise" },
  { id: "document", label: "Document", icon: FileText, description: "Detailed, useful written deliverables" },
  { id: "code", label: "Code", icon: Code2, description: "Implementation-ready source and technical plans" },
  { id: "design", label: "Design", icon: Palette, description: "Professional visual systems and specifications" },
  { id: "gcode", label: "G-code", icon: Box, description: "Machine-ready planning with safety checks" },
  { id: "automation", label: "Automation", icon: Workflow, description: "Repeatable workflows and integrations" },
];

const AUTO_STARTERS = [
  "Build a playable piano app that maps computer keyboard keys to piano notes and verifies the sound controls.",
  "Create an advertising website for IABT with a merchandise store and customer-owned Stripe checkout.",
  "Create the finished deliverable described in my prompt, choose the correct format, and verify it before delivery.",
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

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function readable(value = "") {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function assetScopeFor(conversationId, projectId) {
  return projectId || (conversationId ? "conversation:" + conversationId : "");
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return "Unknown size";
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}

function assetForContext(asset) {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind || "other",
    mime_type: asset.mime_type || "application/octet-stream",
    file_type: asset.file_type || "",
    size_bytes: Number(asset.size_bytes || 0),
    notes: asset.notes || "",
  };
}

function assetIconFor(asset) {
  const kind = String(asset?.kind || "").toLowerCase();
  if (kind === "image") return ImageIcon;
  if (kind === "audio") return Music2;
  if (kind === "video") return Video;
  if (kind === "code") return Code2;
  if (kind === "archive") return Box;
  return FileText;
}

function downloadInlineArtifact(artifact) {
  if (!artifact?.content) return;
  const blob = new Blob([artifact.content], { type: artifact.mime_type || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.name || "iabt-deliverable.txt";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function listCreatorConversations() {
  try {
    const filtered = await base44.agents.listConversations({
      q: { agent_name: CREATOR_AGENT },
      sort: "-updated_date",
      limit: 30,
      skip: 0,
    });
    if (Array.isArray(filtered) && filtered.length) return filtered;
  } catch {
    // Fall through to the unfiltered endpoint for recovery.
  }

  const all = await base44.agents.getConversations();
  return (Array.isArray(all) ? all : [])
    .filter((item) => item?.agent_name === CREATOR_AGENT)
    .sort((left, right) => new Date(right.updated_date || right.created_date || 0) - new Date(left.updated_date || left.created_date || 0))
    .slice(0, 30);
}

function stepText(step, index) {
  if (typeof step === "string") return step;
  return step?.title || step?.name || step?.description || "Production step " + (index + 1);
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
  if (mime === "text/html" && artifact.content) {
    return (
      <iframe
        className="creator-artifact-app-preview"
        title={artifact.name || "Interactive application preview"}
        srcDoc={artifact.content}
        sandbox="allow-scripts"
      />
    );
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
  const [searchParams] = useSearchParams();
  const targetProjectId = (searchParams.get("project_id") || "").trim().slice(0, 200);
  const setupProvider = (searchParams.get("setup") || "").trim().slice(0, 80);
  const reduceMotion = useReducedMotion();
  const messageEndRef = useRef(null);
  const artifactAccessRef = useRef({});
  const [prompt, setPrompt] = useState(() => setupProvider
    ? "Help me connect " + readable(setupProvider) + " to my IABT projects. Use the safest authorization method, keep credentials out of prompts and generated code, explain who pays provider costs, and verify the connection before using it."
    : "");
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [plans, setPlans] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [assets, setAssets] = useState([]);
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
  const [systemAlert, setSystemAlert] = useState(null);
  const [softwareAdvancementEnabled, setSoftwareAdvancementEnabled] = useState(true);

  const activePlan = plans[0] || null;
  const currentIntent = targetProjectId ? "app" : activePlan?.intent || "auto";
  const currentMode = MODE_OPTIONS.find((item) => item.id === currentIntent) || {
    id: "auto",
    label: "Automatic routing",
    icon: Sparkles,
    description: "JERICHO infers the correct output and tools from your objective.",
  };
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
  const assetScopeId = assetScopeFor(conversation?.id, targetProjectId);
  const attachedAssets = assets.slice(0, ATTACHED_ASSET_LIMIT);

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
      const scopeId = assetScopeFor(conversationId, targetProjectId);
      const [planRows, jobRows, artifactRows, assetRows, entitlementResponse] = await Promise.all([
        base44.entities.CreationPlan.filter({ conversation_id: conversationId }, "-created_date", 25),
        base44.entities.GenerationJob.filter({ conversation_id: conversationId }, "-created_date", 50),
        base44.entities.CreationArtifact.filter({ conversation_id: conversationId }, "-created_date", 100),
        scopeId ? base44.entities.Asset.filter({ project_id: scopeId }, "-created_date", 100).catch(() => []) : Promise.resolve([]),
        base44.functions.invoke("get-account-entitlement", {}).catch(() => null),
      ]);
      setPlans(planRows || []);
      setJobs(jobRows || []);
      setArtifacts(artifactRows || []);
      setAssets(assetRows || []);
      const entitlementPayload = entitlementResponse?.data || entitlementResponse;
      if (entitlementPayload?.entitlement) {
        setEntitlement(entitlementPayload.entitlement);
        setMonthlyUsed(Number(entitlementPayload?.usage?.monthly_used || 0));
      }
      void resolvePrivateArtifacts(artifactRows || []);
    } catch (error) {
      if (!quiet) {
        toast({ title: "Could not refresh this creation", description: errorMessage(error), variant: "destructive" });
      }
    }
  }, [resolvePrivateArtifacts, targetProjectId, toast]);

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
    const rows = await listCreatorConversations();
    setConversations(rows);
    return rows;
  }, []);

  const createConversation = useCallback(async () => {
    setConversationBusy(true);
    try {
      const created = await base44.agents.createConversation({
        agent_name: CREATOR_AGENT,
        metadata: {
          surface: "creator_studio",
          ...(targetProjectId ? { project_id: targetProjectId } : {}),
        },
      });
      setConversation(created);
      setMessages(created.messages || []);
      setPlans([]);
      setJobs([]);
      setArtifacts([]);
      setAssets([]);
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
  }, [refreshConversationList, targetProjectId, toast]);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setLoading(true);
      setLoadError("");
      try {
        const [conversationRows, capabilityResponse, fabricResponse, autonomyResponse, entitlementResponse] = await Promise.all([
          listCreatorConversations(),
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
        setMonthlyUsed(Number(entitlementPayload?.usage?.monthly_used || 0));

        if (conversationRows?.[0]?.id) {
          await openConversation(conversationRows[0].id, true);
        } else {
          const created = await base44.agents.createConversation({
            agent_name: CREATOR_AGENT,
            metadata: {
              surface: "creator_studio",
              ...(targetProjectId ? { project_id: targetProjectId } : {}),
            },
          });
          if (!active) return;
          setConversation(created);
          setMessages(created.messages || []);
          setConversations([created]);
          setAssets([]);
        }
      } catch (error) {
        if (active) setLoadError(errorMessage(error, "The AI project operator could not start."));
      } finally {
        if (active) setLoading(false);
      }
    }

    void bootstrap();
    return () => { active = false; };
  }, [openConversation, targetProjectId, user?.id]);

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

      const scopeId = assetScopeFor(target.id, targetProjectId);
      const uploadedAssets = assets
        .filter((asset) => !scopeId || asset.project_id === scopeId)
        .slice(0, ATTACHED_ASSET_LIMIT)
        .map(assetForContext);
      const autonomyPolicy = autonomyProfile?.policy || {};
      const advancementContext = {
        enabled: softwareAdvancementEnabled,
        mode: autonomyPolicy.mode || "bounded_autonomous",
        scope: targetProjectId ? "existing_project_revision" : "current_creation",
        allowed_action_classes: autonomyPolicy.allowed_action_classes || ["read", "plan", "internal_reversible_write", "test", "create_artifact"],
        always_confirm_action_classes: autonomyPolicy.always_confirm_action_classes || ["external_representation", "financial", "destructive", "access_change", "sensitive_transmission", "machine_control"],
        max_runtime_minutes: Number(autonomyPolicy.max_runtime_minutes || 30),
        approval_boundary: "JERICHO may advance safe internal software work, but external, financial, destructive, access-changing, sensitive-data, and machine-control actions still require explicit approval.",
      };

      const sent = await base44.agents.addMessage(target, {
        role: "user",
        content: request,
        custom_context: [{
          type: "iabt_creation_request",
          message: "Infer the correct output type and required integrations from the user's objective. Use this exact conversation_id when calling plan-creation: " + target.id + "." + (targetProjectId ? " This is an existing app revision: pass this exact top-level project_id to inspect-project and plan-creation: " + targetProjectId + ", and keep selected_mode as app for the revision." : " Do not invent or pass selected_mode; let the server infer intent from the full request.") + (uploadedAssets.length ? " Include the uploaded file IDs and asset_scope_id in plan-creation context so JERICHO can use those files as references." : "") + " Plan and quote first. Never execute without explicit approval.",
          data: {
            routing_mode: "automatic",
            conversation_id: target.id,
            asset_scope_id: scopeId,
            uploaded_asset_ids: uploadedAssets.map((asset) => asset.id).filter(Boolean),
            uploaded_assets: uploadedAssets,
            software_advancement: advancementContext,
            ...(targetProjectId ? { project_id: targetProjectId, selected_mode: "app" } : {}),
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

  async function removeAttachedAsset(asset) {
    if (!asset?.id) return;
    const confirmed = window.confirm(`Remove "${asset.name || "this file"}" from this JERICHO context?`);
    if (!confirmed) return;
    try {
      await base44.entities.Asset.delete(asset.id);
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      toast({ title: "File removed from JERICHO context" });
    } catch (error) {
      toast({ title: "File was not removed", description: errorMessage(error), variant: "destructive" });
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
      const failure = error?.response?.data || error?.data || {};
      if (failure?.self_diagnosis) {
        setSystemAlert({
          message: failure.self_diagnosis.safe_message || errorMessage(error),
          category: failure.self_diagnosis.category || "unknown",
          recovery: failure.self_diagnosis.recovery_action || "manual_review",
          incidentId: failure.incident_id || "",
          creditsRestored: failure.credits_restored === true,
        });
      }
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
            <img className="creator-brand-mark" src="/iabt-mark.svg" alt="" />
            <span><strong>Intelligent Application Building Tool</strong><small>IABT · JERICHO Studio</small></span>
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
              <strong>{remainingCredits} credits available</strong>
              <small>{readable(entitlement?.plan || "free")} plan · usage shown before approval</small>
            </span>
          </div>
          <Link to="/deliverables"><Download /> Deliverable library</Link>
          <Link to="/integrations"><PlugZap /> Integrations</Link>
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
            <div><strong>JERICHO Studio</strong><small>{targetProjectId ? "Revision mode · updates stay with this app project." : "One objective from idea through verified delivery."}</small></div>
          </div>
          <div className="creator-topbar-actions">
            <span className="creator-credit-chip"><Sparkles /> {remainingCredits} credits</span>
            <Link to="/deliverables" className="creator-builder-link"><Download /> Deliverables</Link>
            <Link to="/integrations" className="creator-builder-link"><PlugZap /> Integrations</Link>
            <Link to="/" className="creator-builder-link"><AppWindow /> App projects</Link>
            <span className="creator-user">{user?.full_name || user?.email || "Creator"}</span>
          </div>
        </header>

        <section className="creator-conversation">
          {systemAlert ? (
            <div className="creator-system-alert" role="status">
              <Gauge />
              <div>
                <strong>IABT diagnosed this failure</strong>
                <p>{systemAlert.message}</p>
                <small>
                  {readable(systemAlert.category)} · Recovery: {readable(systemAlert.recovery)}
                  {systemAlert.creditsRestored ? " · Reserved credits restored" : ""}
                  {systemAlert.incidentId ? " · Incident " + systemAlert.incidentId.slice(-8) : ""}
                </small>
              </div>
              <button type="button" onClick={() => setSystemAlert(null)} aria-label="Dismiss diagnostic"><X /></button>
            </div>
          ) : null}
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
              <div className="creator-welcome-orb"><img src="/iabt-mark.svg" alt="" /></div>
              <p className="creator-kicker">Intelligent Application Building Tool · JERICHO Studio</p>
              <h1>Tell JERICHO the objective. It figures out how to get there.</h1>
              <p className="creator-welcome-copy">
                Describe the result—not the file type. JERICHO infers the output, identifies only the integrations
                it needs, shows the cost and missing authorization, then verifies the finished deliverable.
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

              <div className="creator-auto-route">
                <span><Sparkles /></span>
                <div>
                  <strong>Automatic output and tool selection</strong>
                  <p>Describe the outcome in plain language. JERICHO identifies whether it needs an app, website, document, media file, code, automation, or a combination.</p>
                  <small>{capabilities.length || "Multiple"} verified output paths · integrations requested only when the objective needs them</small>
                </div>
                <Link to="/integrations"><PlugZap /> Integrations</Link>
              </div>

              <div className="creator-starters">
                <span>Or start with an example</span>
                {(targetProjectId ? STARTERS.app : AUTO_STARTERS).map((starter) => (
                  <button type="button" key={starter} onClick={() => setPrompt(starter)}>
                    {starter}<ArrowUpRight />
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="creator-message-list">
              <div className="creator-thread-intro">
                <span className="creator-thread-mode">{React.createElement(currentMode.icon)} {activePlan ? readable(activePlan.intent) : "Automatic routing"}</span>
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
                        <strong>{message.role === "user" ? "You" : "JERICHO"}</strong>
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
                  <div><span /><span /><span /><small>JERICHO is planning the work and checking connected capabilities…</small></div>
                </div>
              )}
              <div ref={messageEndRef} />
            </div>
          )}

          <form className="creator-composer creator-composer-auto" onSubmit={sendPrompt}>
            <div className="creator-composer-mode">
              <span><Sparkles /> {targetProjectId ? "Revision mode" : "Automatic routing"}</span>
              <Link to="/integrations"><PlugZap /> Connections</Link>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void sendPrompt(event);
              }}
              placeholder={targetProjectId
                ? "Describe what should change. JERICHO will inspect this project before planning the revision…"
                : "What do you want to accomplish? Describe the outcome; JERICHO will choose the correct format and tools…"}
              rows={4}
              maxLength={12000}
            />
            <div className="creator-composer-foot">
              <span><Check /> Output, integrations, cost, and verification are decided from your objective.</span>
              <Button type="submit" disabled={!prompt.trim() || sending || conversationBusy}>
                {sending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Plan objective
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
            <p>JERICHO will show production readiness, IABT credits, and the exact customer total before asking for approval.</p>
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
                <p><strong>{activePlan.provider_ready ? (activePlan.render_ready ? "IABT production route configured" : "IABT preproduction configured") : "Production setup required"}</strong><small>IABT managed production</small></p>
              </div>
              <div>
                <span className={activePlan.render_ready ? "is-ready" : "is-prepare"}>{activePlan.render_ready ? <Play /> : <FileText />}</span>
                <p><strong>{activePlan.render_ready ? "Final renderer configured" : "Preparation package available"}</strong><small>{activePlan.render_ready ? "Balance and provider capacity are confirmed when the approved job is submitted" : "Produces detailed, usable production assets"}</small></p>
              </div>
            </div>

            {(!activePlan.provider_ready || !activePlan.render_ready) && (
              <div className="creator-honesty-note">
                {activePlan.intent === "video" ? <Video /> : <FileText />}
                <p>
                  <strong>{activePlan.intent === "video" ? "VIDEO RENDERER OFFLINE — no MP4 will be created." : "No pretend output."}</strong>
                  {activePlan.intent === "video"
                    ? " JERICHO will create the complete renderer-ready production package only. IABT's managed renderer and paid-media gates must be active before final video rendering becomes available."
                    : <> Approval creates the complete preproduction package described below. It will not label a script, storyboard or plan as a finished {activePlan.intent}.</>}
                </p>
              </div>
            )}

            {activePlan.clarification_questions?.length > 0 && (
              <div className="creator-question-note">
                <strong>JERICHO needs one decision</strong>
                {activePlan.clarification_questions.map((question, index) => <span key={index}>{question}</span>)}
                <small>Answer in the conversation before approving.</small>
              </div>
            )}

            <div className="creator-quote creator-quote-compact">
              <div className="creator-quote-title">
                <span><CircleDollarSign /> Approval summary</span>
              </div>
              <dl>
                <div className="is-total"><dt>IABT cost</dt><dd>{Number(activePlan.credit_cost || 0)} credits</dd></div>
                <div><dt>Provider route</dt><dd>{activePlan.provider_ready ? "Configured" : "Setup required"}</dd></div>
                <div><dt>Charge rule</dt><dd>Capture after verified delivery</dd></div>
              </dl>
              <p>{activePlan.consent_summary || "No billing action occurs until you explicitly approve."}</p>
              <small className={quoteExpired ? "is-expired" : ""}>
                {quoteExpired ? "This quote has expired. Ask JERICHO to refresh it." : "Valid until " + formatDate(activePlan.quote_expires_at)}
              </small>
            </div>

            <details className="creator-plan-details">
              <summary>
                <span>Plan details</span>
                <small>{activePlan.steps?.length || 0} steps · {activePlan.deliverables?.length || 0} deliverables</small>
              </summary>
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
              {activePlan.warnings?.length > 0 && (
                <div className="creator-warning-list">
                  {activePlan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
                </div>
              )}
              <div className="creator-plan-technical">
                <span>Quote version</span>
                <code>{activePlan.pricing_version}</code>
                <span>Funding</span>
                <strong>{activePlan.commercial_summary?.purchased_credits_required ? "Purchased credits required" : "Paid-plan credits eligible"}</strong>
              </div>
            </details>

            {activePlan.status === "quoted" && (
              <div className="creator-approval">
                <label>
                  <input type="checkbox" checked={quoteAccepted} onChange={(event) => setQuoteAccepted(event.target.checked)} />
                  <span>I approve this plan and the exact IABT credit quote shown above.</span>
                </label>
                <Button
                  onClick={approvePlan}
                  disabled={!quoteAccepted || approvalBusy || quoteExpired || activePlan.clarification_questions?.length > 0}
                >
                  {approvalBusy ? <Loader2 className="animate-spin" /> : executionMode === "render" ? <Play /> : <FileText />}
                  {executionMode === "render"
                    ? "Approve & produce"
                    : activePlan.intent === "video"
                      ? "Approve video brief only"
                      : activePlan.intent === "audio"
                        ? "Approve audio brief only"
                        : "Approve preparation package"}
                </Button>
                <small>{activePlan.intent === "video" && !activePlan.render_ready ? "This approval cannot generate an MP4 while the renderer is offline." : "Approval is recorded. IABT will not silently start a paid tool."}</small>
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
                  <div><strong>{job.stage || readable(job.intent) + " production"}</strong><small>IABT managed production · {readable(job.mode)}</small></div>
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
                    <small>{artifact.mime_type || "IABT deliverable"} · IABT verified delivery</small>
                    {artifact.metadata?.rendered === false && (
                      <p className="creator-artifact-limitation">
                        This is a {artifact.metadata?.requested_kind || "media"} preproduction document. No playable media file was rendered.
                      </p>
                    )}
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
                      {!deliveryUrl && artifact.content && (
                        <button type="button" onClick={() => downloadInlineArtifact(artifact)}>
                          <Download /> Download file
                        </button>
                      )}
                      {artifact.project_id && (
                        <Link to={"/projects/" + artifact.project_id}><AppWindow /> Open app project</Link>
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
