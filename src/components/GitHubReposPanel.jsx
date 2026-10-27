import React, { useEffect, useState } from "react";
import {
  Github,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Star,
  GitFork,
  ExternalLink,
  Unplug,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STORAGE_KEY = "iabt.github.connection";
const PAGE_SIZE = 30;

const LANGUAGE_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Java: "#b07219",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  PHP: "#4F5D95",
  "C#": "#178600",
  "C++": "#f34b7d",
  C: "#555555",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Vue: "#41b883",
  Svelte: "#ff3e00",
};

function readConnection() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function githubFetch(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("GitHub rejected that token. Check that it is valid and has not expired.");
    if (response.status === 404) throw new Error("No GitHub account found with that username.");
    if (response.status === 403) throw new Error("GitHub's rate limit was reached. Try again later, or connect with a personal access token.");
    throw new Error(`GitHub request failed (${response.status}).`);
  }
  return response.json();
}

function repoPath(connection, page) {
  return connection.token
    ? `/user/repos?per_page=${PAGE_SIZE}&sort=updated&page=${page}&affiliation=owner,collaborator,organization_member`
    : `/users/${encodeURIComponent(connection.login)}/repos?per_page=${PAGE_SIZE}&sort=updated&page=${page}`;
}

export default function GitHubReposPanel() {
  const [connection, setConnection] = useState(null);
  const [repos, setRepos] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", token: "" });
  const [showToken, setShowToken] = useState(false);

  async function loadRepos(conn, pageNumber = 1, append = false) {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const data = await githubFetch(repoPath(conn, pageNumber), conn.token);
      const list = Array.isArray(data) ? data : [];
      setRepos((current) => (append ? [...current, ...list] : list));
      setPage(pageNumber);
      setHasMore(list.length === PAGE_SIZE);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const saved = readConnection();
    if (saved?.login) {
      setConnection(saved);
      loadRepos(saved);
    }
  }, []);

  async function connect(event) {
    event.preventDefault();
    const username = form.username.trim().replace(/^@/, "");
    const token = form.token.trim();
    if (!token && !username) {
      setError("Enter your GitHub username, or a personal access token to include private repositories.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      let login = username;
      if (token) {
        const me = await githubFetch("/user", token);
        login = me.login;
      } else {
        await githubFetch(`/users/${encodeURIComponent(username)}`);
      }
      const next = {
        login,
        token,
        mode: token ? "token" : "public",
        connectedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setConnection(next);
      setForm({ username: "", token: "" });
      setShowToken(false);
      await loadRepos(next);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  function disconnect() {
    window.localStorage.removeItem(STORAGE_KEY);
    setConnection(null);
    setRepos([]);
    setHasMore(false);
    setPage(1);
    setError("");
  }

  if (!connection) {
    return (
      <section className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Github className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-primary">GitHub repositories</p>
            <h2 className="mt-1 text-xl font-bold text-foreground sm:text-2xl">Bring your repositories onto the dashboard</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Connect a GitHub account to see your latest repositories here. Public repositories work with just a username;
              a personal access token also includes private repositories.
            </p>
          </div>
        </div>

        <form onSubmit={connect} className="mt-5 grid gap-3 sm:max-w-xl">
          <div className="grid gap-2">
            <label htmlFor="github-username" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              GitHub username
            </label>
            <Input
              id="github-username"
              value={form.username}
              onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
              placeholder="octocat"
              autoComplete="off"
              disabled={showToken}
            />
          </div>

          <button
            type="button"
            onClick={() => setShowToken((value) => !value)}
            className="flex w-fit items-center gap-2 text-xs font-bold text-primary"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {showToken ? "Hide token field" : "Add a personal access token for private repos"}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showToken ? "rotate-180" : ""}`} />
          </button>

          {showToken && (
            <div className="grid gap-2">
              <label htmlFor="github-token" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Personal access token
              </label>
              <Input
                id="github-token"
                type="password"
                value={form.token}
                onChange={(event) => setForm((current) => ({ ...current, token: event.target.value }))}
                placeholder="ghp_…"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">Stored only in this browser. A read-only token with repo scope is enough.</p>
            </div>
          )}

          {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Github className="mr-2 h-4 w-4" />}
              {loading ? "Connecting…" : "Connect GitHub"}
            </Button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Github className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-primary">GitHub repositories</p>
            <h2 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold text-foreground sm:text-2xl">
              {connection.login}
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {connection.mode === "token" ? "Public + private" : "Public only"}
              </span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {loading ? "Syncing repositories…" : `${repos.length} repositor${repos.length === 1 ? "y" : "ies"} synced`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadRepos(connection)} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Sync
          </Button>
          <Button variant="ghost" size="sm" onClick={disconnect}>
            <Unplug className="mr-1 h-4 w-4" /> Disconnect
          </Button>
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {loading && repos.length === 0 ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading repositories…
        </div>
      ) : repos.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No repositories were returned for this account.
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {repos.map((repo) => (
              <a
                key={repo.id}
                href={repo.html_url}
                target="_blank"
                rel="noreferrer"
                className="group flex flex-col rounded-xl border border-border bg-background/40 p-4 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <strong className="truncate text-sm font-bold text-foreground group-hover:text-primary">{repo.name}</strong>
                  <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                    {repo.private && <Lock className="h-3.5 w-3.5" />}
                    <ExternalLink className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
                  {repo.description || "No description provided."}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  {repo.language && (
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: LANGUAGE_COLORS[repo.language] || "#8b95a5" }}
                      />
                      {repo.language}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Star className="h-3 w-3" /> {repo.stargazers_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <GitFork className="h-3 w-3" /> {repo.forks_count}
                  </span>
                  <span className="ml-auto">
                    {repo.updated_at ? new Date(repo.updated_at).toLocaleDateString() : ""}
                  </span>
                </div>
              </a>
            ))}
          </div>

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => loadRepos(connection, page + 1, true)} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {loadingMore ? "Loading…" : "Load more repositories"}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}