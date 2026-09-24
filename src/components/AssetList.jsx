import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Trash2, FileText, Image as ImageIcon, Music, Video, Archive, Code, Database, File } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { base44, platformRuntime } from "@/api/iabtClient";
import { useToast } from "@/components/ui/use-toast";
import { openFileDownload, resolveFileDownload } from "@/lib/stored-files";

const KIND_ICONS = {
  document: FileText,
  image: ImageIcon,
  audio: Music,
  video: Video,
  archive: Archive,
  code: Code,
  data: Database,
  other: File,
};

function formatSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AssetList({ assets, onDelete, onUpdate }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [notes, setNotes] = useState("");
  const [downloading, setDownloading] = useState("");
  const { toast } = useToast();

  const download = async (asset) => {
    setDownloading(asset.id);
    try {
      const url = await resolveFileDownload(base44, asset, platformRuntime.backend === "standalone");
      openFileDownload(url, asset.name, platformRuntime.backend === "standalone");
    } catch (error) {
      toast({ title: "File could not be downloaded", description: error.message, variant: "destructive" });
    } finally {
      setDownloading("");
    }
  };

  const filtered = assets.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  const openEdit = (asset) => {
    setEditing(asset);
    setNotes(asset.notes || "");
  };

  const saveNotes = () => {
    onUpdate(editing.id, { notes });
    setEditing(null);
  };

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search files..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {assets.length === 0 ? "No files yet. Upload to get started." : "No matching files."}
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {filtered.map((asset) => {
            const Icon = KIND_ICONS[asset.kind] || File;
            return (
              <div key={asset.id} className="flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors group">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <button onClick={() => openEdit(asset)} className="text-sm font-medium truncate block text-left hover:underline">
                    {asset.name}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {asset.file_type?.toUpperCase() || "FILE"} · {formatSize(asset.size_bytes)}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Download ${asset.name}`} disabled={downloading === asset.id} onClick={() => download(asset)}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDelete(asset)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="truncate">{editing?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="px-2 py-1 rounded bg-muted">{editing?.file_type?.toUpperCase() || "FILE"}</span>
              <span>{formatSize(editing?.size_bytes)}</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Add notes about this file..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={downloading === editing?.id} onClick={() => download(editing)}>
              <Download className="h-4 w-4 mr-2" /> Download
            </Button>
            <Button onClick={saveNotes}>Save Notes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
