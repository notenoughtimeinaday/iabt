export const PERSONAL_WORKSPACE_EMAIL = "derik@insuredspending.org";
export const isPersonalWorkspaceOwner = (user) => user?.email_verified === true && String(user.email || "").trim().toLowerCase() === PERSONAL_WORKSPACE_EMAIL;

export function repositoryUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) return "";
    const match = url.pathname.match(/^\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?\/?$/);
    if (!match || [match[1], match[2]].some((part) => part === "." || part === "..")) return "";
    return `https://github.com/${match[1]}/${match[2]}`;
  } catch { return ""; }
}

export function sourceReviewPrompt(source) {
  return `I am working on ${source.title}. ${source.kind === "repository" ? `Repository reference: ${source.repository_url}. ` : ""}I will attach the relevant source files. Review those attached files, preserve existing behavior, and identify the next useful improvement. A repository link or catalog entry alone is not source access; do not claim to have fetched, run or changed it.`;
}

export const suggestedRepositories = [
  { kind: "repository", title: "IABT · Jericho", repository_url: "https://github.com/notenoughtimeinaday/iabt", notes: "Standalone app-building workspace. Preserve the reviewed branch and history." },
  { kind: "repository", title: "TreEbay · original account", repository_url: "https://github.com/notenoughtimeinaday/TreEbay", notes: "Accessible repository snapshot. Compare against other TreEbay sources before selecting a baseline." },
  { kind: "repository", title: "TreEbay · business account", repository_url: "https://github.com/insuredspending-LLC/treebay", notes: "Business-account repository. Preserve separately and compare history before combining changes." }
];
