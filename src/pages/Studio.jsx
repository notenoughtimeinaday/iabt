import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { base44, platformRuntime } from "@/api/iabtClient";
import { storedFileId, resolveFileDownload, openFileDownload } from "@/lib/stored-files";
import { createAttachmentTracker } from "@/lib/upload-batch";
import { createStudioSubmissionGate, refreshAcceptedSubmission, studioErrorMessage as errorMessage } from "@/lib/studio-state";
import "@/studio-simple.css";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import FileUploader from "@/components/FileUploader";
import JerichoLearningPanel from "@/components/JerichoLearningPanel";
import JerichoMaintenancePanel from "@/components/JerichoMaintenancePanel";
import {
  ArrowLeft,
  ArrowUpRight,
  AppWindow,
  Bot,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
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
  Paperclip,
  Play,
  RefreshCw,
  Rocket,
  Sparkles,
  Trash2,
  Video,
  X,
} from "lucide-react";

const CREATOR_AGENT = "iabt_creator";
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "waiting_provider"]);
const ATTACHED_ASSET_LIMIT = 12;
const MODE_OPTIONS = [
  { id: "app", label: "App", icon: AppWindow },
  { id: "website", label: "Website", icon: Globe2 },
  { id: "document", label: "Document", icon: FileText },
  { id: "code", label: "Code", icon: Code2 },
];

const AUTO_STARTERS = [
  { label: "Try a task-list app", prompt: "Create a task-list starter with add, complete, delete, search and filter controls." },
  { label: "Create a website", prompt: "Create a website for my local business with services, opening hours and contact details. Use clear placeholders for details I have not provided." },
  { label: "Review my code", prompt: "Review the source files I attach and create a report of the requirements, gaps and next steps. Distinguish code inspection from tests actually run." },
];

const REVISION_STARTERS = [
  { label: "Improve this app", prompt: "Review this app and suggest the most useful next improvement. Explain any missing source files or access before making changes." },
  { label: "Simplify the screens", prompt: "Simplify this app's screens while preserving its main features and saved work." },
];

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
  return "Untitled work";
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
    file_id: storedFileId(asset),
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

function ArtifactPreview({ artifact, previewLoading, previewError, onPreview }) {
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
  if (mime.split(";")[0] === "text/html") {
    if (!artifact.content) return <div className="creator-preview-state" role={previewError ? "alert" : "status"}>
      {previewLoading ? <><Loader2 className="animate-spin" /><span>Opening your app preview…</span></> : <>
        <p>{previewError || "Open this version of your app."}</p>
        <button type="button" onClick={onPreview}><RefreshCw /> {previewError ? "Retry preview" : "Preview app"}</button>
      </>}
    </div>;
    return (
      <iframe
        className="creator-artifact-app-preview"
        title={artifact.name || "Interactive application preview"}
        srcDoc={artifact.content}
        // Local form handlers need allow-forms; the preview CSP blocks form
        // navigation, and omitting allow-same-origin keeps its origin isolated.
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
      />
    );
  }
  if (artifact.content) {
    return <details className="creator-file-preview"><summary>Read file</summary><pre className="creator-artifact-content">{artifact.content}</pre></details>;
  }
  return null;
}

export default function Studio() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedConversationId = (searchParams.get("conversation") || "").slice(0, 200);
  const startNew = searchParams.get("new") === "1";
  const incomingPrompt = (searchParams.get("prompt") || "").slice(0, 12000);
  const targetProjectId = (searchParams.get("project_id") || "").trim().slice(0, 200);
  const setupProvider = (searchParams.get("setup") || "").trim().slice(0, 80);
  const reduceMotion = useReducedMotion();
  const messageListRef = useRef(null);
  const followLatestRef = useRef(true);
  const promptRef = useRef(null);
  const submissionErrorRef = useRef(null);
  const artifactAccessRef = useRef({});
  const attachmentTracker = useRef(createAttachmentTracker());
  const switchingConversationRef = useRef(false);
  const submissionRef = useRef(createStudioSubmissionGate());
  const [prompt, setPrompt] = useState(() => incomingPrompt || (setupProvider
    ? "Help me connect " + readable(setupProvider) + " to my IABT projects. Use the safest authorization method, keep credentials out of prompts and generated code, explain who pays provider costs, and verify the connection before using it."
    : ""));
  const [revisionArtifact, setRevisionArtifact] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [plans, setPlans] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [assets, setAssets] = useState([]);
  const [attachmentStatus, setAttachmentStatus] = useState(() => attachmentTracker.current.snapshot());
  const publishAttachments = useCallback(() => {
    const snapshot = attachmentTracker.current.snapshot();
    setAssets(snapshot.rows);
    setAttachmentStatus(snapshot);
  }, []);
  const [artifactAccessUrls, setArtifactAccessUrls] = useState({});
  const [appPreviews, setAppPreviews] = useState({});
  const appPreviewsRef = useRef({});
  const [entitlement, setEntitlement] = useState(null);
  const [monthlyUsed, setMonthlyUsed] = useState(0);
  const [standaloneCredits, setStandaloneCredits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [submissionNotice, setSubmissionNotice] = useState("");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [quoteAccepted, setQuoteAccepted] = useState(false);
  const [refreshingJobs, setRefreshingJobs] = useState({});
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [systemAlert, setSystemAlert] = useState(null);
  const [softwareAdvancementEnabled, setSoftwareAdvancementEnabled] = useState(true);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const menuButtonRef = useRef(null);

  const activePlan = plans[0] || null;
  const currentIntent = targetProjectId ? "app" : activePlan?.intent || "auto";
  const currentMode = MODE_OPTIONS.find((item) => item.id === currentIntent) || {
    id: "auto",
    label: "Your work",
    icon: Sparkles,
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
  const remainingCredits = standaloneCredits ?? (Math.max(0, monthlyLimit - monthlyUsed) + bonusCredits);
  const assetScopeId = assetScopeFor(conversation?.id, targetProjectId);
  const attachedAssets = platformRuntime.backend === "standalone" ? assets : assets.slice(0, ATTACHED_ASSET_LIMIT);
  const hasResults = Boolean(activePlan || jobs.length || artifacts.length);
  const recentMessages = historyOpen ? visibleMessages : visibleMessages.slice(-2);

  const loadAppPreview = useCallback(async (artifact, retry = false) => {
    const existing = appPreviewsRef.current[artifact.id];
    if (existing?.loading || existing?.content || (existing?.error && !retry)) return;
    const publish = (value) => {
      appPreviewsRef.current = { ...appPreviewsRef.current, [artifact.id]: value };
      setAppPreviews((current) => ({ ...current, [artifact.id]: value }));
    };
    publish({ loading: true });
    try {
      const response = await base44.functions.invoke("get-app-preview", { file_id: storedFileId(artifact) || artifact.id });
      const payload = response?.data || response;
      if (!payload?.content || payload.mime_type !== "text/html") throw new Error("This app preview is not available yet.");
      publish({ content: payload.content });
    } catch (error) {
      publish({ error: errorMessage(error, "The preview could not open. Your saved file is still available to download.") });
    }
  }, []);

  useEffect(() => {
    const newestApp = artifacts.find((artifact) => String(artifact.mime_type || "").split(";")[0] === "text/html");
    if (newestApp && platformRuntime.backend === "standalone") void loadAppPreview(newestApp);
  }, [artifacts, loadAppPreview]);

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
    const scopeId = assetScopeFor(conversationId, targetProjectId);
    const token = attachmentTracker.current.beginLoad(scopeId, conversationId);
    if (!token) return;
    publishAttachments();
    try {
      const [planRows, jobRows, artifactRows, assetRows, entitlementResponse] = await Promise.all([
        base44.entities.CreationPlan.filter({ conversation_id: conversationId }, "-created_date", 25),
        base44.entities.GenerationJob.filter({ conversation_id: conversationId }, "-created_date", 50),
        base44.entities.CreationArtifact.filter({ conversation_id: conversationId }, "-created_date", 100),
        scopeId ? base44.entities.Asset.filter({ project_id: scopeId }, "-created_date", 100) : Promise.resolve([]),
        base44.functions.invoke("get-account-entitlement", {}).catch(() => null),
      ]);
      const accepted = attachmentTracker.current.finishLoad(token, assetRows || []);
      publishAttachments();
      if (!accepted) return;
      setPlans(planRows || []);
      setJobs(jobRows || []);
      setArtifacts(artifactRows || []);
      const entitlementPayload = entitlementResponse?.data || entitlementResponse;
      if (platformRuntime.backend === "standalone" && Number.isFinite(entitlementPayload?.credits_remaining)) setStandaloneCredits(entitlementPayload.credits_remaining);
      if (entitlementPayload) {
        setEntitlement(entitlementPayload.entitlement || entitlementPayload);
        setMonthlyUsed(Number(entitlementPayload?.usage?.monthly_used || 0));
      }
      void resolvePrivateArtifacts(artifactRows || []);
    } catch (error) {
      const accepted = attachmentTracker.current.finishLoad(token, [], errorMessage(error));
      publishAttachments();
      if (accepted && !quiet) {
        toast({ title: "Could not refresh this creation", description: errorMessage(error), variant: "destructive" });
      }
    }
  }, [publishAttachments, resolvePrivateArtifacts, targetProjectId, toast]);

  const canSwitchConversation = useCallback(() => {
    if (submissionRef.current.busy) return false;
    const status = attachmentTracker.current.snapshot();
    if (status.busy || status.pending) {
      toast({ title: "Finish your attachments first", description: "Wait for uploads to finish, then retry or discard any unfinished attachments before switching conversations.", variant: "destructive" });
      return false;
    }
    return !switchingConversationRef.current;
  }, [toast]);

  const openConversation = useCallback(async (conversationId, quiet = false) => {
    if (!conversationId || !canSwitchConversation()) return;
    switchingConversationRef.current = true;
    setConversationBusy(true);
    try {
      const full = await base44.agents.getConversation(conversationId);
      if (!full) throw new Error("That conversation is no longer available.");
      attachmentTracker.current.switchScope(assetScopeFor(conversationId, targetProjectId), conversationId);
      publishAttachments();
      setConversation(full);
      setRevisionArtifact(null);
      setHistoryOpen(false);
      setAttachmentsOpen(false);
      followLatestRef.current = true;
      setSubmissionError("");
      setSubmissionNotice("");
      setMessages(full.messages || []);
      setQuoteAccepted(false);
      await loadResources(conversationId, quiet);
      setMobileNavOpen(false);
    } catch (error) {
      if (!quiet) {
        toast({ title: "Could not open the conversation", description: errorMessage(error), variant: "destructive" });
      }
    } finally {
      switchingConversationRef.current = false;
      setConversationBusy(false);
    }
  }, [canSwitchConversation, loadResources, publishAttachments, targetProjectId, toast]);

  const refreshConversationList = useCallback(async () => {
    const rows = await listCreatorConversations();
    setConversations(rows);
    return rows;
  }, []);

  const createConversation = useCallback(async () => {
    if (!canSwitchConversation()) return null;
    switchingConversationRef.current = true;
    setConversationBusy(true);
    try {
      const created = await base44.agents.createConversation({
        agent_name: CREATOR_AGENT,
        metadata: {
          surface: "creator_studio",
          ...(targetProjectId ? { project_id: targetProjectId } : {}),
        },
      });
      attachmentTracker.current.switchScope(assetScopeFor(created.id, targetProjectId), created.id, targetProjectId ? null : []);
      publishAttachments();
      setConversation(created);
      setRevisionArtifact(null);
      setHistoryOpen(false);
      setAttachmentsOpen(false);
      followLatestRef.current = true;
      setSubmissionError("");
      setSubmissionNotice("");
      setMessages(created.messages || []);
      setPlans([]);
      setJobs([]);
      setArtifacts([]);
      setQuoteAccepted(false);
      setMobileNavOpen(false);
      await refreshConversationList();
      if (targetProjectId) await loadResources(created.id);
      return created;
    } catch (error) {
      toast({ title: "Could not start a new creation", description: errorMessage(error), variant: "destructive" });
      return null;
    } finally {
      switchingConversationRef.current = false;
      setConversationBusy(false);
    }
  }, [canSwitchConversation, loadResources, publishAttachments, refreshConversationList, targetProjectId, toast]);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setLoading(true);
      setLoadError("");
      try {
        const [conversationRows, entitlementResponse] = await Promise.all([
          listCreatorConversations(),
          base44.functions.invoke("get-account-entitlement", {}).catch(() => null),
        ]);
        if (!active) return;

        setConversations(conversationRows || []);
        const entitlementPayload = entitlementResponse?.data || entitlementResponse;
        if (platformRuntime.backend === "standalone" && Number.isFinite(entitlementPayload?.credits_remaining)) setStandaloneCredits(entitlementPayload.credits_remaining);
        setEntitlement(entitlementPayload?.entitlement || entitlementPayload || null);
        setMonthlyUsed(Number(entitlementPayload?.usage?.monthly_used || 0));

        if (requestedConversationId) {
          await openConversation(requestedConversationId);
        } else if (!incomingPrompt && !startNew && conversationRows?.[0]?.id) {
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
          attachmentTracker.current.switchScope(assetScopeFor(created.id, targetProjectId), created.id, targetProjectId ? null : []);
          publishAttachments();
          setConversation(created);
          setMessages(created.messages || []);
          setConversations([created]);
          if (targetProjectId) await loadResources(created.id);
        }
      } catch (error) {
        if (active) setLoadError(errorMessage(error, "Your workspace could not open."));
      } finally {
        if (active) setLoading(false);
      }
    }

    void bootstrap();
    return () => { active = false; };
  }, [loadResources, openConversation, publishAttachments, targetProjectId, user?.id]);

  useEffect(() => {
    if (!conversation?.id) return undefined;
    const unsubscribe = base44.agents.subscribeToConversation(conversation.id, (updated) => {
      if (!updated || updated.id !== attachmentTracker.current.snapshot().conversationId) return;
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
    const list = messageListRef.current;
    if (list && followLatestRef.current) {
      list.scrollTo({ top: list.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
    }
  }, [conversation?.id, visibleMessages.length, assistantWorking, reduceMotion]);

  useEffect(() => {
    if (submissionError) submissionErrorRef.current?.focus();
  }, [submissionError]);

  useEffect(() => {
    if (!incomingPrompt && !startNew) return;
    const next = new URLSearchParams(searchParams);
    next.delete("prompt");
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [incomingPrompt, startNew, searchParams, setSearchParams]);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);

  useEffect(() => {
    setQuoteAccepted(false);
  }, [activePlan?.id]);

  async function sendPrompt(event) {
    event?.preventDefault();
    const request = prompt.trim();
    if (!request || submissionRef.current.busy) return;
    const attachmentError = attachmentTracker.current.planningError();
    if (attachmentError || switchingConversationRef.current) {
      setSubmissionError(attachmentError || "Wait for the conversation to finish loading.");
      return;
    }

    if (!submissionRef.current.acquire()) return;
    setSending(true);
    setSubmissionError("");
    setSubmissionNotice("");
    followLatestRef.current = true;
    try {
      const target = conversation;
      if (!target) throw new Error("Wait for your conversation to finish loading, then try again.");

      const scopeId = assetScopeFor(target.id, targetProjectId);
      const attachmentSnapshot = attachmentTracker.current.snapshot();
      if (attachmentSnapshot.scopeId !== scopeId || attachmentSnapshot.conversationId !== target.id || attachmentTracker.current.planningError()) {
        throw new Error("Wait for this conversation and its saved attachments to finish loading.");
      }
      const scopedAssets = attachmentSnapshot.rows.filter((asset) => !scopeId || asset.project_id === scopeId);
      if (platformRuntime.backend === "standalone" && scopedAssets.length > ATTACHED_ASSET_LIMIT) {
        throw new Error(`A file report can use at most ${ATTACHED_ASSET_LIMIT} attachments. Remove the extra attachments before sending your request.`);
      }
      const uploadedAssets = scopedAssets
        .slice(0, ATTACHED_ASSET_LIMIT)
        .map(assetForContext);
      if (platformRuntime.backend === "standalone" && uploadedAssets.some((asset) => !asset.file_id)) {
        throw new Error("An older attachment has no permanent file reference. Remove it from this conversation and upload it again before requesting a file report.");
      }
      const revisionFileId = revisionArtifact ? storedFileId(revisionArtifact) || revisionArtifact.id : null;
      const submissionKey = JSON.stringify([target.id, request, uploadedAssets.map((asset) => asset.file_id), softwareAdvancementEnabled, revisionFileId]);
      const submissionId = submissionRef.current.idFor(submissionKey);

      const sent = await base44.agents.addMessage(target, {
        role: "user",
        content: request,
        ...(platformRuntime.backend === "standalone" ? {
          file_ids: uploadedAssets.map((asset) => asset.file_id),
          submission_id: submissionId,
          quote_only: !softwareAdvancementEnabled,
          ...(revisionFileId ? { revision_file_id: revisionFileId } : {}),
        } : {}),
        custom_context: [{
          type: "iabt_creation_request",
          message: "Infer the requested output and preserve its conversation, project and attached file references. The server owns execution policy, tool authorization, spending limits and approval requirements.",
          data: {
            routing_mode: "automatic",
            conversation_id: target.id,
            asset_scope_id: scopeId,
            uploaded_asset_ids: uploadedAssets.map((asset) => asset.id).filter(Boolean),
            uploaded_assets: uploadedAssets,
            ...(targetProjectId ? { project_id: targetProjectId, selected_mode: "app" } : {}),
            surface: "creator_studio",
          },
        }],
      });
      submissionRef.current.accepted();
      setMessages((current) => [...current.filter((item) => item.id !== sent.id), sent]);
      setPrompt("");
      setRevisionArtifact(null);
      setQuoteAccepted(false);
      setSubmissionNotice("Request received. Your progress and files will appear here.");
      // A list refresh failure must not turn an accepted request into a send failure.
      void refreshAcceptedSubmission(refreshConversationList, () => loadResources(target.id, true));
    } catch (error) {
      setSubmissionError(errorMessage(error));
    } finally {
      submissionRef.current.release();
      setSending(false);
    }
  }

  async function downloadStoredArtifact(artifact) {
    try {
      const url = await resolveFileDownload(base44, artifact, true);
      openFileDownload(url, artifact.name, true);
    } catch (error) {
      toast({ title: "File could not be downloaded", description: error.message, variant: "destructive" });
    }
  }

  async function removeAttachedAsset(asset) {
    if (!asset?.id) return;
    const confirmed = window.confirm(`Remove "${asset.name || "this file"}" from this JERICHO context?`);
    if (!confirmed) return;
    try {
      await base44.entities.Asset.delete(asset.id);
      attachmentTracker.current.remove(asset.project_id, conversation?.id || "", asset.id);
      publishAttachments();
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
        <strong>Opening your workspace</strong>
        <span>Loading your saved work…</span>
      </div>
    );
  }

  return (
    <div className={"creator-shell creator-simple" + (hasResults ? " has-results" : "")}>
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

      {mobileNavOpen && <aside className="creator-sidebar is-open" aria-label="Saved work">
        <div className="creator-sidebar-brand">
          <Link to="/" className="creator-brand-link" aria-label="Return to IABT home">
            <img className="creator-brand-mark" src="/iabt-mark.svg" alt="" />
            <span><strong>IABT</strong><small>Your workspace</small></span>
          </Link>
          <button type="button" className="creator-mobile-close" onClick={() => { setMobileNavOpen(false); menuButtonRef.current?.focus(); }} aria-label="Close saved work">
            <X />
          </button>
        </div>

        <Button className="creator-new-button" onClick={createConversation} disabled={sending || conversationBusy || attachmentStatus.busy || attachmentStatus.pending > 0}>
          {conversationBusy ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />}
          New creation
        </Button>

        <div className="creator-history-heading">
          <span>Recent work</span>
          <small>{conversations.length}</small>
        </div>
        <nav className="creator-history" aria-label="Creation conversations">
          {conversations.length ? conversations.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === conversation?.id ? "is-active" : ""}
              onClick={() => openConversation(item.id)}
              disabled={sending || conversationBusy}
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
              <small>{readable(entitlement?.plan || "free")} plan</small>
            </span>
          </div>
          <Link to="/deliverables"><Download /> Saved files</Link>
          <Link to="/"><ArrowLeft /> Your apps</Link>
          {platformRuntime.backend === "standalone" && <details className="creator-optional-details"><summary>Help &amp; activity</summary><JerichoLearningPanel /><JerichoMaintenancePanel /></details>}
        </div>
      </aside>}

      <main className="creator-main">
        <header className="creator-topbar">
          <button ref={menuButtonRef} type="button" className="creator-menu-button" onClick={() => setMobileNavOpen(true)} aria-label="Open saved work" aria-expanded={mobileNavOpen}>
            <Menu />
          </button>
          <div className="creator-topbar-title">
            <img className="creator-simple-mark" src="/iabt-mark.svg" alt="" />
            <div><strong>IABT · Jericho</strong></div>
          </div>
          <div className="creator-topbar-actions">
            <span className="creator-credit-chip"><Sparkles /> {remainingCredits} credits</span>
            <Link to="/deliverables" className="creator-builder-link"><Download /> Saved files</Link>
            <button type="button" className="creator-builder-link" onClick={createConversation} disabled={sending || conversationBusy || attachmentStatus.busy || attachmentStatus.pending > 0}><MessageSquarePlus /> New</button>
          </div>
        </header>

        <section className="creator-conversation">
          {systemAlert ? (
            <div className="creator-system-alert" role="status">
              <Gauge />
              <div>
                <strong>This creation needs attention</strong>
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
              <h1>Your workspace could not open</h1>
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
              <p className="creator-kicker">Your idea, taking shape</p>
              <h1>{targetProjectId ? "What would you like to change?" : "What would you like to build?"}</h1>
              <p className="creator-welcome-copy">Describe your app or website. See the result here, make changes, and keep your files.</p>
              <div className="creator-starters">
                {(targetProjectId ? REVISION_STARTERS : AUTO_STARTERS).map((starter) => (
                  <button type="button" key={starter.label} onClick={() => { setPrompt(starter.prompt); promptRef.current?.focus(); }}>
                    {starter.label}<ArrowUpRight />
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div
              className="creator-message-list"
              ref={messageListRef}
              tabIndex={0}
              role="region"
              aria-label="Conversation messages"
              onScroll={(event) => {
                const list = event.currentTarget;
                followLatestRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
              }}
            >
              <div className="creator-thread-intro">
                <span className="creator-thread-mode">{React.createElement(currentMode.icon)} {currentMode.label}</span>
                {visibleMessages.length > 2 && <button type="button" onClick={() => { followLatestRef.current = false; setHistoryOpen(!historyOpen); }}>{historyOpen ? "Show latest" : "Earlier conversation (" + (visibleMessages.length - 2) + ")"}</button>}
              </div>
              <AnimatePresence initial={false}>
                {recentMessages.map((message, index) => (
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

                      </div>
                      <p>{contentText(message.content)}</p>
                      {message.tool_calls?.length > 0 && (
                        <details className="creator-optional-details"><summary>Activity details</summary><div className="creator-tool-list">
                          {message.tool_calls.map((tool, toolIndex) => (
                            <span key={tool.id || toolIndex} className={"tool-" + tool.status}>
                              {tool.status === "running" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                              {readable(tool.name)} · {readable(tool.status)}
                            </span>
                          ))}
                        </div></details>
                      )}
                    </div>
                  </motion.article>
                ))}
              </AnimatePresence>
              {assistantWorking && (
                <div className="creator-message creator-message-assistant creator-thinking">
                  <div className="creator-message-avatar"><Sparkles /></div>
                  <div><span /><span /><span /><small>Working on your request…</small></div>
                </div>
              )}
            </div>
          )}

          <form className="creator-composer creator-composer-auto" onSubmit={sendPrompt}>


            {revisionArtifact && <div className="creator-revision-note">
              <AppWindow /><span>Changing <strong>{revisionArtifact.name}</strong></span>
              <button type="button" disabled={sending} onClick={() => setRevisionArtifact(null)} aria-label="Stop changing this app"><X /></button>
            </div>}
            <textarea
              ref={promptRef}
              aria-label={revisionArtifact ? "Changes to your app" : "What would you like to build?"}
              aria-describedby={submissionError ? "creator-submission-error" : "creator-submission-status"}
              value={prompt}
              readOnly={sending}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void sendPrompt(event);
              }}
              placeholder={revisionArtifact || targetProjectId ? "Describe the change you want…" : "Describe your idea…"}
              rows={4}
              maxLength={12000}
            />
            {submissionError && (
              <div id="creator-submission-error" className="creator-submission-error" role="alert" tabIndex={-1} ref={submissionErrorRef}>
                <strong>Your request needs attention</strong>
                <p>{submissionError}</p>
                <small>Your draft is kept here. Review the conversation before retrying if the connection was interrupted.</small>
              </div>
            )}
            <p id="creator-submission-status" className="creator-submission-status" role="status">
              {sending ? "Sending your request and checking the next step…" : submissionNotice ||
                (conversationBusy ? "Loading your conversation…" : attachmentTracker.current.planningError())}
            </p>
            <div className="creator-composer-tools">
              <button type="button" className="creator-attach-toggle" onClick={() => setAttachmentsOpen(!attachmentsOpen)} aria-expanded={attachmentsOpen}>
                <Paperclip /> {assets.length ? assets.length + " attached" : "Attach files"}
              </button>
              <label className="creator-quote-first"><input type="checkbox" disabled={sending} checked={!softwareAdvancementEnabled}
                onChange={(event) => setSoftwareAdvancementEnabled(!event.target.checked)} /> Show a quote first</label>
            </div>
            {assetScopeId && (
              <div className="creator-upload-dock" hidden={!attachmentsOpen && !attachmentStatus.pending && !attachmentStatus.error}>
                <div className="creator-upload-head">
                  <span><Paperclip /> Reference files</span>
                  <small>{assets.length ? assets.length + " attached" : "Attach files before planning"}</small>
                </div>
                <FileUploader
                  key={`${assetScopeId}:${conversation?.id || ""}`}
                  projectId={assetScopeId}
                  conversationId={conversation?.id || ""}
                  assetScope={targetProjectId ? "project" : "conversation"}
                  compact
                  description={platformRuntime.backend === "standalone"
                    ? "For source review: text, Markdown, CSV, JSON or code. Up to 12 files, 128 KB each, 256 KB total. Other formats are saved only."
                    : undefined}
                  disabled={sending || conversationBusy || !attachmentStatus.ready || Boolean(attachmentStatus.error)}
                  onStatusChange={(status) => {
                    if (attachmentTracker.current.setUploadStatus(assetScopeId, conversation?.id || "", status)) publishAttachments();
                  }}
                  onUploaded={(uploaded) => {
                    if (attachmentTracker.current.mergeUploaded(assetScopeId, conversation?.id || "", uploaded)) publishAttachments();
                  }}
                />

                {!attachmentStatus.ready && attachmentStatus.loading && !attachmentStatus.error && (
                  <p role="status">Loading your saved attachments before creating…</p>
                )}
                {attachmentStatus.error && (
                  <p role="alert">Saved attachments could not be checked. <button type="button" onClick={() => loadResources(conversation?.id)}>Retry loading attachments</button></p>
                )}
                {attachmentStatus.pending > 0 && !attachmentStatus.busy && <p role="alert">Retry or discard unfinished attachments before sending your request.</p>}
                {assets.length > 0 && (
                  <div className="creator-upload-list" aria-label="Attached files for JERICHO">
                    {attachedAssets.map((asset) => {
                      const Icon = assetIconFor(asset);
                      return (
                        <div key={asset.id} className="creator-upload-item">
                          <Icon />
                          <span><strong title={asset.name}>{asset.name}</strong><small>{readable(asset.kind || "file")} · {formatFileSize(asset.size_bytes)}</small></span>
                          <button type="button" disabled={sending} onClick={() => removeAttachedAsset(asset)} aria-label={"Remove " + asset.name}>
                            <Trash2 />
                          </button>
                        </div>
                      );
                    })}
                    {assets.length > attachedAssets.length && <em>+{assets.length - attachedAssets.length} more files available to this conversation</em>}
                  </div>
                )}
              </div>
            )}

            <div className="creator-composer-foot">
              <span>Uses IABT credits. Extra charges need your approval.</span>
              <Button type="submit" disabled={!prompt.trim() || sending || conversationBusy || Boolean(attachmentTracker.current.planningError())}>
                {sending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {sending ? "Sending…" : !softwareAdvancementEnabled ? "Get quote" : revisionArtifact ? "Make changes" : "Create"}
              </Button>
            </div>
          </form>
        </section>
      </main>

      {hasResults && <aside className="creator-deliverables" aria-label="Your results">
        <div className="creator-panel-heading">
          <div><span>Your results</span><small>Saved in your workspace</small></div>
          <button type="button" onClick={() => conversation?.id && loadResources(conversation.id)} aria-label="Refresh your results">
            <RefreshCw />
          </button>
        </div>

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
                content: platformRuntime.backend === "standalone" && String(artifact.mime_type || "").split(";")[0] === "text/html"
                  ? appPreviews[artifact.id]?.content : artifact.content,
                file_url: deliveryUrl,
              };
              const isApp = String(artifact.mime_type || "").split(";")[0] === "text/html";
              return (
                <article key={artifact.id} className={isApp ? "creator-app-result" : ""}>
                  <div className="creator-artifact-info">
                    <strong>{artifact.name}</strong>
                    {artifact.metadata?.rendered === false && (
                      <p className="creator-artifact-limitation">
                        This is a {artifact.metadata?.requested_kind || "media"} preproduction document. No playable media file was rendered.
                      </p>
                    )}
                    <div>
                      {platformRuntime.backend === "standalone" && storedFileId(artifact) && (
                        <button type="button" onClick={() => downloadStoredArtifact(artifact)}>
                          <Download /> Download
                        </button>
                      )}
                      {deliveryUrl && platformRuntime.backend !== "standalone" && (
                        <a href={deliveryUrl} target="_blank" rel="noreferrer">
                          <ArrowUpRight /> Open
                        </a>
                      )}
                      {deliveryUrl && platformRuntime.backend !== "standalone" && (
                        <a href={deliveryUrl} download>
                          <Download /> Download
                        </a>
                      )}
                      {!deliveryUrl && artifact.content && (
                        <button type="button" onClick={() => downloadInlineArtifact(artifact)}>
                          <Download /> Download file
                        </button>
                      )}
                      {isApp && platformRuntime.backend === "standalone" && <button type="button" disabled={sending || conversationBusy} onClick={() => { setRevisionArtifact(artifact); setPrompt(""); promptRef.current?.focus(); promptRef.current?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" }); }}><Sparkles /> Make a change</button>}
                      {artifact.project_id && (
                        <Link to={"/projects/" + artifact.project_id}><AppWindow /> Open app project</Link>
                      )}
                    </div>
                  </div>
                  <ArtifactPreview artifact={previewArtifact} previewLoading={appPreviews[artifact.id]?.loading}
                    previewError={appPreviews[artifact.id]?.error} onPreview={() => loadAppPreview(artifact, true)} />
                  {isApp && <p className="creator-preview-note">Preview — review and test your app before publishing.</p>}
                </article>
              );
            })}
          </section>
        )}
        {activePlan && <details className="creator-result-plan" open={activePlan.status === "quoted"}><summary>{activePlan.status === "quoted" ? "Review before creating" : "Creation details"}</summary>
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

            {(!activePlan.provider_ready || !activePlan.render_ready) && <div className="creator-honesty-note"><FileText /><p><strong>Preparation only.</strong> This creates the documents listed below, not a finished {activePlan.intent}.</p></div>}

            {activePlan.clarification_questions?.length > 0 && (
              <div className="creator-question-note">
                <strong>JERICHO needs one decision</strong>
                {activePlan.clarification_questions.map((question, index) => <span key={index}>{question}</span>)}
                <small>Answer in the conversation before approving.</small>
              </div>
            )}

            <div className="creator-quote creator-quote-compact">
              <dl><div className="is-total"><dt>Cost</dt><dd>{Number(activePlan.credit_cost || 0)} credits</dd></div></dl>
              <p>{activePlan.consent_summary || "No billing action occurs until you explicitly approve."}</p>
              {activePlan.status === "quoted" && <small className={quoteExpired ? "is-expired" : ""}>
                {quoteExpired ? "This quote has expired. Ask JERICHO to refresh it." : "Valid until " + formatDate(activePlan.quote_expires_at)}
              </small>}
            </div>

            <details className="creator-plan-details">
              <summary>
                <span>Details &amp; limitations</span>
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
                  <span>I approve this work for {Number(activePlan.credit_cost || 0)} IABT credits.</span>
                </label>
                <Button
                  onClick={approvePlan}
                  disabled={!quoteAccepted || approvalBusy || quoteExpired || activePlan.clarification_questions?.length > 0}
                >
                  {approvalBusy ? <Loader2 className="animate-spin" /> : executionMode === "render" ? <Play /> : <FileText />}
                  {executionMode === "render"
                    ? "Approve & create"
                    : activePlan.intent === "video"
                      ? "Approve video brief only"
                      : activePlan.intent === "audio"
                        ? "Approve audio brief only"
                        : "Approve documents only"}
                </Button>
                <small>{activePlan.intent === "video" && !activePlan.render_ready ? "This approval cannot generate an MP4 while the renderer is offline." : "Approval is recorded. IABT will not silently start a paid tool."}</small>
              </div>
            )}
          </motion.section>
        </details>}

        {jobs.length > 0 && (
          <section className="creator-jobs">
            <div className="creator-section-title"><span>Progress</span></div>
            {jobs.map((job) => (
              <article key={job.id}>
                <div className="creator-job-head">
                  <span className="creator-job-kind">{job.intent === "video" ? <Video /> : job.mode === "prepare" ? <FileText /> : <Rocket />}</span>
                  <div><strong>{job.status === "succeeded" ? "Files saved" : job.status === "failed" ? "Could not finish" : job.status === "queued" ? "Waiting to start" : "Creating your result"}</strong></div>
                  <StatusPill status={job.status} />
                </div>
                {ACTIVE_JOB_STATUSES.has(job.status) && <div className="creator-progress-track"><span style={{ width: Math.min(100, Math.max(3, Number(job.progress || 0))) + "%" }} /></div>}
                <div className="creator-job-foot">
                  <span>{ACTIVE_JOB_STATUSES.has(job.status) ? Number(job.progress || 0) + "% complete" : ""}</span>
                  {job.intent === "video" && ACTIVE_JOB_STATUSES.has(job.status) && (
                    <button type="button" onClick={() => refreshJob(job)} disabled={refreshingJobs[job.id]}>
                      <RefreshCw className={refreshingJobs[job.id] ? "animate-spin" : ""} /> Refresh render
                    </button>
                  )}
                </div>
                {job.error_message && <p className="creator-job-error">{job.error_message}</p>}
                <details className="creator-optional-details"><summary>Activity details</summary><p>{job.stage || readable(job.intent)}</p></details>
              </article>
            ))}
          </section>
        )}


      </aside>}
    </div>
  );
}
