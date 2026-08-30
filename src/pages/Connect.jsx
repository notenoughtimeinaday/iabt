import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "@/connect.css";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  MessageSquare,
  MousePointer2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";

const CLIENTS = [
  {
    id: "claude",
    name: "Claude",
    icon: Bot,
    steps: [
      "Open Claude and go to your profile menu.",
      "Choose Settings → Connectors → “Add custom connector”.",
      "Name the connector (for example, “IABT JERICHO”) and paste the server URL below.",
      "Click Add.",
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    icon: MessageSquare,
    steps: [
      "In ChatGPT, go to Apps and enable Developer mode (acknowledge the prompt ChatGPT shows).",
      "Click “Create app”, name it, and paste the server URL below.",
      "Click Create, then enable the app from the chat composer before prompting it.",
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    icon: MousePointer2,
    steps: [
      "In Cursor, open Settings → Tools & Integrations → “New MCP Server”.",
      "This opens mcp.json — add an entry whose url is the server URL below, then save.",
      "Toggle the new server on.",
    ],
  },
  {
    id: "custom",
    name: "Custom",
    icon: Terminal,
    steps: [
      "Copy the server URL below.",
      "Add it as a streamable HTTP MCP server in your client.",
      "Most clients need only a name and the URL. Reload the client afterward.",
    ],
  },
];

export default function Connect() {
  const { toast } = useToast();
  const [active, setActive] = useState("claude");
  const [copied, setCopied] = useState(false);
  const serverUrl = useMemo(
    () => new URL("/api/mcp", window.location.origin).toString(),
    [],
  );

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true);
      toast({ title: "Server URL copied" });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the URL field and copy manually.",
        variant: "destructive",
      });
    }
  }

  const current = CLIENTS.find((c) => c.id === active) || CLIENTS[0];
  const CurrentIcon = current.icon;

  return (
    <div className="integration-page">
      <header className="integration-header">
        <Link to="/" className="integration-brand">
          <img src="/iabt-mark.svg" alt="" />
          <span>
            <strong>IABT · Connect an AI assistant</strong>
            <small>Point Claude, ChatGPT, Cursor, or any MCP client at this app</small>
          </span>
        </Link>
        <nav>
          <Link to="/studio"><Sparkles /> JERICHO Studio</Link>
          <Link to="/"><ArrowLeft /> Projects</Link>
        </nav>
      </header>

      <main className="integration-main">
        <section className="integration-hero">
          <div>
            <p><Bot /> Model Context Protocol</p>
            <h1>Let your AI assistant use this app.</h1>
            <span>
              Connect any MCP-compatible AI client to IABT. After a one-time sign-in, the assistant can read and act on your data using the same permissions your account already has.
            </span>
          </div>
          <article>
            <ShieldCheck />
            <div>
              <strong>You sign in — the assistant acts as you</strong>
              <p>Access is OAuth-based. The assistant never receives a shared key; it works only with the permissions of the account that approved it.</p>
            </div>
          </article>
        </section>

        <section className="connect-url-card">
          <div className="connect-url-label">
            <Terminal />
            <div>
              <strong>MCP server URL</strong>
              <small>Copy this into your AI client. The URL is the same for every client.</small>
            </div>
          </div>
          <div className="connect-url-row">
            <input
              readOnly
              value={serverUrl}
              className="connect-url-input"
              onFocus={(e) => e.target.select()}
              aria-label="MCP server URL"
            />
            <Button onClick={copyUrl} className="connect-copy-button">
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </section>

        <section className="connect-clients" aria-label="AI client setup guides">
          <div className="connect-tabs" role="tablist">
            {CLIENTS.map((client) => {
              const Icon = client.icon;
              return (
                <button
                  key={client.id}
                  type="button"
                  role="tab"
                  aria-selected={active === client.id}
                  className={"connect-tab" + (active === client.id ? " is-active" : "")}
                  onClick={() => setActive(client.id)}
                >
                  <Icon /> {client.name}
                </button>
              );
            })}
          </div>

          <article className="connect-steps">
            <div className="connect-steps-head">
              <span className="connect-steps-icon"><CurrentIcon /></span>
              <div>
                <small>Connecting {current.name}</small>
                <h2>Step-by-step for {current.name}</h2>
              </div>
            </div>
            <ol>
              {current.steps.map((step, index) => (
                <li key={index}>
                  <span>{index + 1}</span>
                  <p>{step}</p>
                </li>
              ))}
              <li>
                <span>{current.steps.length + 1}</span>
                <p>
                  <strong>Sign in and approve. </strong>
                  {current.name} will open this app’s consent page. Sign in with your IABT account and approve access — the assistant only ever acts as you.
                </p>
              </li>
            </ol>
          </article>
        </section>

        <section className="integration-boundary">
          <RefreshCw />
          <div>
            <strong>Refresh after we ship changes</strong>
            <p>Assistants cache the tool list. If we add or change tools, reconnect or refresh the connector in your client so it picks up the latest capabilities.</p>
          </div>
        </section>
      </main>
    </div>
  );
}