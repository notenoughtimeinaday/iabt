import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { UploadCloud, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { base44, platformRuntime } from "@/api/iabtClient";
import { useAuth } from "@/lib/AuthContext";
import { uploadBatch } from "@/lib/upload-batch";

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
  onStatusChange,
  disabled = false,
}) {
  const inputRef = useRef(null);
  const uploadingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploadIssue, setUploadIssue] = useState(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const handleFiles = async (files, retry = false) => {
    if (!files?.length || uploadingRef.current || disabled || (!retry && pendingFiles.length)) return;
    const entries = retry ? files : Array.from(files, (file) => ({ file }));
    uploadingRef.current = true;
    setUploading(true);
    setUploadIssue(null);
    onStatusChange?.({ busy: true, pending: entries.length });
    const result = await uploadBatch(entries, {
      upload: async (file) => {
        const uploaded = await base44.integrations.Core.UploadFile({ file });
        if (platformRuntime.backend === "standalone" && !uploaded.file_id) {
          throw new Error("The upload did not return a permanent file reference. Please retry.");
        }
        return uploaded;
      },
      createAsset: (file, { file_url, file_id, sha256 }) => base44.entities.Asset.create({
        user_id: user?.id || "",
        user_email: user?.email || "",
        name: file.name,
        project_id: projectId,
        ...(conversationId ? { conversation_id: conversationId } : {}),
        source: assetScope === "conversation" ? "jericho_conversation_upload" : "project_upload",
        file_url,
        ...(file_id ? { file_id, file_uri: "iabt-file:" + file_id, sha256 } : {}),
        file_type: file.name.split(".").pop()?.toLowerCase() || "",
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        kind: classifyKind(file.type, file.name),
        notes: assetScope === "conversation" ? "Attached to a JERICHO Studio conversation." : "",
        metadata: {
          asset_scope: assetScope,
          uploaded_from: "jericho_studio",
          ...(file_id ? { file_id, sha256 } : {}),
        },
      }),
      onUploaded,
    });
    setPendingFiles(result.pending);
    if (result.error) {
      const issue = uploadFailureMessage(result.error);
      setUploadIssue(issue);
      toast({ title: issue.title, description: issue.description, variant: "destructive" });
    } else {
      toast({ title: `${result.uploaded.length} file${result.uploaded.length > 1 ? "s" : ""} saved` });
      if (inputRef.current) inputRef.current.value = "";
    }
    uploadingRef.current = false;
    setUploading(false);
    onStatusChange?.({ busy: false, pending: result.pending.length });
  };

  const discardPending = () => {
    if (uploadingRef.current) return;
    setPendingFiles([]);
    setUploadIssue(null);
    if (inputRef.current) inputRef.current.value = "";
    onStatusChange?.({ busy: false, pending: 0 });
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
        disabled={disabled || uploading || pendingFiles.length > 0}
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
          <p className="text-xs text-muted-foreground mt-1">{platformRuntime.backend === "standalone"
            ? "Reports can read UTF-8 text, Markdown, JSON, CSV and source code: up to 12 files, 128 KiB each, 256 KiB total. Other formats are storage only."
            : compact ? "Docs, images, code, data, audio, or video" : "Any file type — documents, images, code, audio, video"}</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={disabled || uploading || pendingFiles.length > 0} onClick={() => inputRef.current?.click()}>
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
              disabled={disabled || uploading}
              onClick={() => handleFiles(pendingFiles, true)}
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Retry {pendingFiles.length} unfinished {pendingFiles.length > 1 ? "files" : "file"}
            </Button>
          )}
          {pendingFiles.length > 0 && (
            <Button type="button" variant="ghost" size="sm" className="mt-3" disabled={uploading} onClick={discardPending}>
              Discard unfinished attachments
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
