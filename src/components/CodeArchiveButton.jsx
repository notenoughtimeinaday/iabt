import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Download, FileArchive, Loader2, AlertCircle } from "lucide-react";

// Snapshot of the app source, stored privately in this app's storage.
const SOURCE_ARCHIVE_URI = "mp/private/6a849bcd3e04d068553b4af7/app-users/6a849bcd3e04d068553b4af8/e0239a439_iabt-jericho-source.zip";

export default function CodeArchiveButton() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (user?.role !== "admin") return null;

  async function download() {
    setBusy(true);
    setError("");
    try {
      const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({
        file_uri: SOURCE_ARCHIVE_URI,
        expires_in: 3600,
      });
      const link = document.createElement("a");
      link.href = signed_url;
      link.download = "iabt-jericho-source.zip";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError(err?.message || "The archive could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <FileArchive className="h-5 w-5" />
          </span>
          <div>
            <strong className="block text-sm">Source code archive</strong>
            <p className="mt-1 text-xs text-muted-foreground">
              Full snapshot of this app's code, without dependencies or environment files. Downloads straight to your
              device — no link to save. Ask for a refreshed copy after major changes.
            </p>
          </div>
        </div>
        <Button onClick={download} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          {busy ? "Preparing…" : "Download .zip"}
        </Button>
      </div>
      {error && (
        <p className="mt-3 flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </p>
      )}
    </section>
  );
}