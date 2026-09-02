import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  History,
  Loader2,
  MessageSquarePlus,
  Send,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import "@/exchange.css";

const EXCHANGE_AGENT = "iabt_exchange";
const STARTERS = [
  "Help me create a match-safe collaboration profile for the expertise I can offer.",
  "Analyze one of my IABT projects and identify the capabilities it is missing.",
  "Show my active project needs and explain how to improve them before matching.",
  "Review my current collaborator matches without revealing private contact information.",
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
  if (text) return text.length > 52 ? text.slice(0, 52) + "…" : text;
  return "New Exchange conversation";
}

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function errorMessage(error) {
  return error?.response?.data?.error || error?.data?.error || error?.message || "The Exchange assistant could not complete that request.";
}

async function listExchangeConversations() {
  try {
    const rows = await base44.agents.listConversations({
      q: { agent_name: EXCHANGE_AGENT },
      sort: "-updated_date",
      limit: 30,
      skip: 0,
    });
    if (Array.isArray(rows)) return rows;
  } catch {
    // Recover through the unfiltered conversation endpoint.
  }
  const all = await base44.agents.getConversations();
  return (Array.isArray(all) ? all : [])
    .filter((item) => item?.agent_name === EXCHANGE_AGENT)
    .sort((left, right) => new Date(right.updated_date || right.created_date || 0) - new Date(left.updated_date || left.created_date || 0))
    .slice(0, 30);
}

export default function ExchangeAssistant() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const messageEndRef = useRef(null);
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");

  const visibleMessages = useMemo(
    () => messages.filter((message) => !message.hidden && message.role !== "system"),
    [messages],
  );
  const latestMessage = visibleMessages.at(-1);
  const assistantWorking = sending || latestMessage?.role === "user" ||
    visibleMessages.some((message) => message.tool_calls?.some((tool) => tool.status === "running"));

  const refreshConversationList = useCallback(async () => {
    const rows = await listExchangeConversations();
    setConversations(rows);
    return rows;
  }, []);

  const openConversation = useCallback(async (conversationId, quiet = false) => {
    if (!conversationId) return;
    try {
      const full = await base44.agents.getConversation(conversationId);
      if (!full) throw new Error("That Exchange conversation is no longer available.");
      setConversation(full);
      setMessages(full.messages || []);
    } catch (error) {
      if (!quiet) toast({ title: "Conversation could not open", description: errorMessage(error), variant: "destructive" });
    }
  }, [toast]);

  const createConversation = useCallback(async () => {
    setCreating(true);
    try {
      const created = await base44.agents.createConversation({
        agent_name: EXCHANGE_AGENT,
        metadata: {
          surface: "iabt_exchange_assistant",
          privacy_mode: "mutual_consent",
        },
      });
      setConversation(created);
      setMessages(created.messages || []);
      setPrompt("");
      await refreshConversationList();
      return created;
    } catch (error) {
      toast({ title: "Could not start Exchange assistant", description: errorMessage(error), variant: "destructive" });
      return null;
    } finally {
      setCreating(false);
    }
  }, [refreshConversationList, toast]);

  useEffect(() => {
    let active = true;
    async function boot() {
      setLoading(true);
      setLoadError("");
      try {
        const rows = await listExchangeConversations();
        if (!active) return;
        setConversations(rows);
        if (rows?.[0]?.id) {
          await openConversation(rows[0].id, true);
        } else {
          const created = await base44.agents.createConversation({
            agent_name: EXCHANGE_AGENT,
            metadata: { surface: "iabt_exchange_assistant", privacy_mode: "mutual_consent" },
          });
          if (!active) return;
          setConversation(created);
          setMessages(created.messages || []);
          setConversations([created]);
        }
      } catch (error) {
        if (active) setLoadError(errorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    }
    void boot();
    return () => { active = false; };
  }, [openConversation]);

  useEffect(() => {
    if (!conversation?.id) return undefined;
    const unsubscribe = base44.agents.subscribeToConversation(conversation.id, (updated) => {
      if (!updated) return;
      setConversation(updated);
      setMessages(updated.messages || []);
      void refreshConversationList();
    });
    return unsubscribe;
  }, [conversation?.id, refreshConversationList]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleMessages.length, assistantWorking]);

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
          type: "iabt_exchange_request",
          message: "Use IABT Exchange's opt-in, match-safe, deterministic matching and mutual-consent rules. Read current Exchange state before acting. Never disclose private contact information before an accepted introduction. Require action-time approval for introductions, messages, disclosure, blocks, and reports.",
          data: {
            surface: "iabt_exchange_assistant",
            conversation_id: target.id,
            public_directory: false,
            mutual_consent_required: true,
            pooled_funds_enabled: false,
            investment_solicitation_enabled: false,
          },
        }],
      });
      setMessages((current) => [...current.filter((item) => item.id !== sent.id), sent]);
      setPrompt("");
      await refreshConversationList();
    } catch (error) {
      toast({ title: "Message not sent", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <div className="exchange-loading"><Loader2 className="animate-spin" /><h1>Starting Exchange assistant…</h1><p>Loading your private collaboration conversations.</p></div>;
  }

  return (
    <div className="exchange-page exchange-assistant-page">
      <header className="exchange-header">
        <Link to="/exchange" className="exchange-brand">
          <img src="/iabt-mark.svg" alt="" />
          <span><strong>IABT Exchange Assistant</strong><small>Private, consent-controlled team formation</small></span>
        </Link>
        <nav>
          <Button variant="outline" onClick={() => void createConversation()} disabled={creating}><MessageSquarePlus /> New conversation</Button>
          <Button variant="ghost" onClick={() => navigate("/exchange")}><ArrowLeft /> Exchange</Button>
        </nav>
      </header>

      <main className="exchange-assistant-main">
        <aside className="exchange-assistant-sidebar">
          <section className="exchange-assistant-boundary">
            <ShieldCheck />
            <div><strong>Private by default</strong><p>Matches use limited profile fields. Contact details remain concealed until both members accept an introduction.</p></div>
          </section>
          <div className="exchange-assistant-history-head"><History /><strong>Conversations</strong></div>
          <div className="exchange-assistant-history">
            {conversations.length ? conversations.map((item) => (
              <button key={item.id} type="button" className={conversation?.id === item.id ? "is-active" : ""} onClick={() => void openConversation(item.id)}>
                <strong>{titleFromConversation(item)}</strong>
                <small>{formatDate(item.updated_date || item.created_date)}</small>
              </button>
            )) : <p>No Exchange conversations yet.</p>}
          </div>
        </aside>

        <section className="exchange-assistant-chat">
          <header>
            <div><p className="exchange-eyebrow"><Bot /> Collaboration concierge</p><h1>Find the capability your project is missing.</h1></div>
            <span className="exchange-status is-active">Opt-in beta</span>
          </header>

          {loadError ? (
            <div className="exchange-assistant-error"><ShieldCheck /><h2>Assistant unavailable</h2><p>{loadError}</p><Button onClick={() => window.location.reload()}>Try again</Button></div>
          ) : (
            <>
              <div className="exchange-assistant-messages" aria-live="polite">
                {!visibleMessages.length && (
                  <div className="exchange-assistant-welcome">
                    <span><Sparkles /></span>
                    <h2>What do you need to build the right team?</h2>
                    <p>Describe your project, the expertise you can offer, or the capability you are missing. The assistant can prepare profiles and needs, explain matches, and guide consent-controlled introductions.</p>
                    <div>{STARTERS.map((starter) => <button key={starter} type="button" onClick={() => setPrompt(starter)}>{starter}</button>)}</div>
                  </div>
                )}
                {visibleMessages.map((message) => (
                  <article key={message.id || `${message.role}-${message.created_date}`} className={"exchange-assistant-message is-" + message.role}>
                    <div>{message.role === "assistant" ? <Bot /> : <UsersRound />}<strong>{message.role === "assistant" ? "IABT Exchange" : "You"}</strong></div>
                    <p>{contentText(message.content)}</p>
                    {message.tool_calls?.length > 0 && (
                      <div className="exchange-assistant-tools">
                        {message.tool_calls.map((tool, index) => <span key={tool.id || index} className={"is-" + (tool.status || "pending")}><CheckCircle2 /> {String(tool.name || tool.function_name || "Exchange action").replaceAll("_", " ")}</span>)}
                      </div>
                    )}
                  </article>
                ))}
                {assistantWorking && <div className="exchange-assistant-working"><Loader2 className="animate-spin" /> Reviewing your Exchange workspace…</div>}
                <div ref={messageEndRef} />
              </div>

              <form className="exchange-assistant-compose" onSubmit={sendPrompt}>
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe a project need, ask for match guidance, or prepare an introduction…" rows={3} disabled={sending} />
                <Button type="submit" disabled={!prompt.trim() || sending}>{sending ? <Loader2 className="animate-spin" /> : <Send />} Send</Button>
                <small>Sending a message does not approve an introduction, disclose contact information, make a payment, or verify a credential.</small>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
