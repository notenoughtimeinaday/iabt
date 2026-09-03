import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { UploadCloud, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { base44 } from "@/api/iabtClient";
import { useAuth } from "@/lib/AuthContext";

function classifyKind(mimeType, name) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("audio/")) return "audio";
  if (mimeType?.startsWith("video/")) return "video";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  if (["js", "jsx", "ts", "tsx", "py", "json", "html", "css", "java", "cpp", "go", "rb"].includes(ext)) return "code";
  if (["csv", "xlsx", "xls", "sql"].includes(ext) || mimeType?.includes("csv")) return "data";
  if (mimeType?.includes("pdf") || mimeType?.includes("document") || ["doc", "docx", "txt", "md", "pdf", "rtf", "odt"].includes(ext)) return "document";
  return "other";
}

export default function FileUploader({
  projectId,
  conversationId = "",
  assetScope = "project",
  compact = false,
  onUploaded,
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        const created = await base44.entities.Asset.create({
          user_id: user?.id || "",
          user_email: user?.email || "",
          name: file.name,
          project_id: projectId,
          ...(conversationId ? { conversation_id: conversationId } : {}),
          source: assetScope === "conversation" ? "jericho_conversation_upload" : "project_upload",
          file_url,
          file_type: file.name.split(".").pop()?.toLowerCase() || "",
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          kind: classifyKind(file.type, file.name),
          notes: assetScope === "conversation" ? "Attached to a JERICHO Studio conversation." : "",
          metadata: {
            asset_scope: assetScope,
            uploaded_from: "jericho_studio",
          },
        });
        uploaded.push(created);
      }
      toast({ title: `${files.length} file${files.length > 1 ? "s" : ""} uploaded` });
      onUploaded?.(uploaded);
    } catch (err) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(Array.from(e.dataTransfer.files)); }}
      className={`${compact ? "rounded-lg border border-dashed p-3" : "rounded-xl border-2 border-dashed p-6"} text-center transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(Array.from(e.target.files))}
      />
      <div className={`flex ${compact ? "items-center justify-between gap-3" : "flex-col items-center gap-3"}`}>
        <div className={`${compact ? "w-9 h-9" : "w-12 h-12"} rounded-full bg-primary/10 flex items-center justify-center shrink-0`}>
          {uploading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <UploadCloud className="h-5 w-5 text-primary" />}
        </div>
        <div className={compact ? "min-w-0 flex-1 text-left" : ""}>
          <p className="text-sm font-medium">
            {uploading ? "Uploading..." : compact ? "Attach files for JERICHO" : "Drag & drop files or browse"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{compact ? "Docs, images, code, data, audio, or video" : "Any file type — documents, images, code, audio, video"}</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {compact ? "Attach" : "Browse Files"}
        </Button>
      </div>
    </div>
  );
}