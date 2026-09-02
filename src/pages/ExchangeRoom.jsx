import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  ArrowLeft,
  Ban,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import "@/exchange.css";

function payload(response) {
  return response?.data || response;
}

function errorMessage(error) {
  return error?.response?.data?.error || error?.data?.error || error?.message || "The collaboration room request failed.";
}

export default function ExchangeRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const bottomRef = useRef(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await base44.functions.invoke("get-collaboration-room", { room_id: roomId });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Collaboration room is unavailable.");
      setData(next);
    } catch (error) {
      if (!quiet) toast({ title: "Room could not load", description: errorMessage(error), variant: "destructive" });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [roomId, toast]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages?.length]);

  async function sendMessage(event) {
    event.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      const response = await base44.functions.invoke("send-collaboration-message", {
        room_id: roomId,
        message,
        attachment_ids: [],
      });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Message was not sent.");
      setMessage("");
      setData((current) => current ? { ...current, messages: [...(current.messages || []), next.message] } : current);
    } catch (error) {
      toast({ title: "Message not sent", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  async function blockMember() {
    if (!data?.room?.other_user_id) return;
    if (!window.confirm("Block this member? This room will be suspended and new introductions will be prevented.")) return;
    try {
      const response = await base44.functions.invoke("block-exchange-user", {
        target_user_id: data.room.other_user_id,
        action: "block",
        reason: "Blocked from collaboration room",
      });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Member was not blocked.");
      toast({ title: "Member blocked", description: "The room has been suspended." });
      navigate("/exchange");
    } catch (error) {
      toast({ title: "Block failed", description: errorMessage(error), variant: "destructive" });
    }
  }

  async function reportMember() {
    if (!data?.room?.other_user_id) return;
    const description = window.prompt("Describe the safety or conduct concern:");
    if (!description) return;
    try {
      const response = await base44.functions.invoke("report-exchange-user", {
        reported_user_id: data.room.other_user_id,
        room_id: roomId,
        reason: "other",
        description,
      });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Report was not submitted.");
      toast({ title: "Safety report submitted", description: next.next_action });
    } catch (error) {
      toast({ title: "Report not submitted", description: errorMessage(error), variant: "destructive" });
    }
  }

  if (loading && !data) {
    return <div className="exchange-loading"><Loader2 className="animate-spin" /><h1>Opening private room…</h1></div>;
  }

  if (!data) {
    return <div className="exchange-loading"><ShieldCheck /><h1>Room unavailable</h1><Button onClick={() => navigate("/exchange")}>Return to Exchange</Button></div>;
  }

  const contact = data.other_contact || {};
  return (
    <div className="exchange-page exchange-room-page">
      <header className="exchange-header">
        <Link to="/exchange" className="exchange-brand"><img src="/iabt-mark.svg" alt="" /><span><strong>IABT Exchange room</strong><small>{data.room.other_alias}</small></span></Link>
        <nav><Button variant="outline" onClick={() => void load()}><RefreshCw /> Refresh</Button><Button variant="ghost" onClick={() => navigate("/exchange")}><ArrowLeft /> Exchange</Button></nav>
      </header>

      <main className="exchange-room-main">
        <aside className="exchange-room-sidebar">
          <section className="exchange-panel">
            <p className="exchange-eyebrow"><UsersRound /> Accepted introduction</p>
            <h2>{data.room.other_alias}</h2>
            <p>{data.project_need?.title || "Collaboration"}</p>
            {data.project_need?.public_summary && <small>{data.project_need.public_summary}</small>}
          </section>

          <section className="exchange-panel">
            <h3>Shared contact details</h3>
            {Object.keys(contact).length ? <div className="exchange-contact-list">
              {contact.full_name && <span><UsersRound /> <b>{contact.full_name}</b></span>}
              {contact.organization && <span><UsersRound /> {contact.organization}</span>}
              {contact.email && <a href={`mailto:${contact.email}`}><Mail /> {contact.email}</a>}
              {contact.phone && <a href={`tel:${contact.phone}`}><Phone /> {contact.phone}</a>}
              {contact.calendar_link && <a href={contact.calendar_link} target="_blank" rel="noreferrer"><ExternalLink /> Calendar</a>}
              {contact.linkedin && <a href={contact.linkedin} target="_blank" rel="noreferrer"><ExternalLink /> LinkedIn</a>}
              {contact.website && <a href={contact.website} target="_blank" rel="noreferrer"><ExternalLink /> Website</a>}
            </div> : <p className="exchange-muted">The other member did not disclose contact fields. You can still collaborate inside this room.</p>}
          </section>

          <section className="exchange-panel exchange-room-safety">
            <ShieldCheck />
            <div><strong>Safety controls</strong><p>Reporting does not automatically block the member. Blocking suspends this room.</p></div>
            <Button variant="outline" onClick={reportMember}>Report concern</Button>
            <Button variant="outline" onClick={blockMember}><Ban /> Block member</Button>
          </section>
        </aside>

        <section className="exchange-chat-panel">
          <header><div><p className="exchange-eyebrow"><MessageSquare /> Private project room</p><h1>{data.project_need?.title || "Collaboration room"}</h1></div><span className={"exchange-status is-" + data.room.status}>{data.room.status}</span></header>
          <div className="exchange-chat-messages" aria-live="polite">
            {(data.messages || []).length ? data.messages.map((item) => <article key={item.id} className={"exchange-message" + (item.mine ? " is-mine" : "")}><div><strong>{item.mine ? "You" : item.sender_alias}</strong><time>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</time></div><p>{item.message}</p></article>) : <div className="exchange-chat-empty"><MessageSquare /><h3>Start the conversation</h3><p>Agree on roles, boundaries, expectations, and next steps before sharing sensitive project material.</p></div>}
            <div ref={bottomRef} />
          </div>
          <form className="exchange-chat-compose" onSubmit={sendMessage}>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a message…" rows={3} disabled={data.room.status !== "active" || sending} />
            <Button type="submit" disabled={!message.trim() || data.room.status !== "active" || sending}>{sending ? <Loader2 className="animate-spin" /> : <Send />} Send</Button>
          </form>
        </section>
      </main>
    </div>
  );
}
