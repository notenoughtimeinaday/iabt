import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { UploadCloud, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { base44 } from "@/api/base44Client";

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

export default function FileUploader({ projectId, onUploaded }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const { toast } = useToast();

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        await base44.entities.Asset.create({
          name: file.name,
          project_id: projectId,
          file_url,
          file_type: file.name.split(".").pop()?.toLowerCase() || "",
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          kind: classifyKind(file.type, file.name),
        });
      }
      toast({ title: `${files.length} file${files.length > 1 ? "s" : ""} uploaded` });
      onUploaded?.();
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
      className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(Array.from(e.target.files))}
      />
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          {uploading ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <UploadCloud className="h-6 w-6 text-primary" />}
        </div>
        <div>
          <p className="text-sm font-medium">
            {uploading ? "Uploading..." : "Drag & drop files or browse"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Any file type — documents, images, code, audio, video</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
          Browse Files
        </Button>
      </div>
    </div>
  );
}