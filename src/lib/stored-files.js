// Signed URLs are temporary. Persist and resolve the private file identity.
export function storedFileId(asset) {
  if (typeof asset?.file_id === "string" && asset.file_id) return asset.file_id;
  if (typeof asset?.metadata?.file_id === "string" && asset.metadata.file_id) return asset.metadata.file_id;
  if (typeof asset?.file_uri === "string" && asset.file_uri.startsWith("iabt-file:")) return asset.file_uri.slice(10);
  return "";
}

export async function resolveFileDownload(client, asset, standalone) {
  const id = storedFileId(asset);
  if (standalone) {
    if (!id) throw new Error("This older attachment has no permanent file reference. Please upload it again.");
    const access = await client.files.access(id);
    if (!access?.file_url) throw new Error("A fresh private download link could not be created. Please try again.");
    return access.file_url;
  }
  if (!asset?.file_url) throw new Error("The file has no download link.");
  return asset.file_url;
}

export function openFileDownload(url, name) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name || "download";
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
