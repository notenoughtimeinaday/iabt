import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { UploadCloud, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { base44 } from "@/api/iabtClient";
import { useAuth } from "@/lib/AuthContext";

function uploadFailureMessage(error) {
  const raw = String(error?.response?.data?.message || error?.message || "Upload failed.");
  if (/limit of integrations|integration.*limit|integration credits|monthly.*integration/i.test(raw)) {
    return {
      code: "base44_integration_quota",
      title: "IABT storage temporarily unavailable",
      description: "The IABT owner workspace has exhausted its Base44 integration quota. This is an infrastructure limit, not your IABT plan or your connected integrations. Your file was not uploaded.",
    };
  }
  return { code: "upload_failed", title: "Upload failed", description: raw };
}

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
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploadIssue, setUploadIssue] = useState(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadIssue(null);
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
      setPendingFiles([]);
      toast({ title: `${files.length} file${files.length > 1 ? "s" : ""} uploaded` });
      onUploaded?.(uploaded);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      const issue = uploadFailureMessage(err);
      setUploadIssue(issue);
      setPendingFiles(Array.from(files));
      toast({ title: issue.title, description: issue.description, variant: "destructive" });
    } finally {
      setUploading(false);
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
      {uploadIssue && (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-left" role="alert">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-destructive">{uploadIssue.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{uploadIssue.description}</p>
            </div>
          </div>
          {pendingFiles.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={uploading}
              onClick={() => handleFiles(pendingFiles)}
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Retry {pendingFiles.length > 1 ? "files" : "file"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}