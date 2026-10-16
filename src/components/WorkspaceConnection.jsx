import React from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import "@/workspace-connection.css";

export default function WorkspaceConnection({ loading = false, onRetry }) {
  return <main className="workspace-connection">
    <section aria-labelledby="workspace-connection-title" aria-busy={loading}>
      <img src="/iabt-mark.svg" alt="" width="56" height="56" />
      <span className="workspace-connection-brand">JERICHO <span>by IABT</span></span>
      <div role={loading ? "status" : "alert"}>
        <h1 id="workspace-connection-title">{loading ? "Opening your workspace" : "Let’s get you reconnected."}</h1>
        <p>{loading ? "Loading your account and saved work. This may take a moment." : "Jericho is having trouble connecting. Try again in a moment or contact support if this continues."}</p>
      </div>
      {loading ? <Loader2 className="workspace-connection-spinner" aria-hidden="true" /> : <button onClick={onRetry} type="button"><RefreshCw size={18} /> Try again</button>}
      <Link to="/support">Get help</Link>
    </section>
  </main>;
}
