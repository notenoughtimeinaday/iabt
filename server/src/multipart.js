const headerValue = (headers, name) => {
  const match = headers.match(new RegExp("^" + name + ":\\s*(.+)$", "im"));
  return match ? match[1].trim() : "";
};

export const readSingleFile = async (req, { maxBytes }) => {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw Object.assign(new Error("A multipart file upload is required"), {
      status: 400,
      code: "invalid_upload"
    });
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      throw Object.assign(new Error("Uploaded file exceeds the configured limit"), {
        status: 413,
        code: "upload_too_large"
      });
    }
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks);
  const delimiter = Buffer.from("--" + boundary);
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf(delimiter, cursor);
    if (start < 0) break;
    const headerStart = start + delimiter.length + 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd < 0) break;
    const headers = body.subarray(headerStart, headerEnd).toString("utf8");
    const disposition = headerValue(headers, "Content-Disposition");
    const name = disposition.match(/name="([^"]+)"/i)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1];
    const next = body.indexOf(delimiter, headerEnd + 4);
    if (name === "file" && filename !== undefined && next >= 0) {
      const dataEnd = next - 2;
      return {
        filename: filename || "upload.bin",
        contentType: headerValue(headers, "Content-Type") || "application/octet-stream",
        bytes: body.subarray(headerEnd + 4, dataEnd)
      };
    }
    cursor = headerEnd + 4;
  }
  throw Object.assign(new Error("The multipart request did not include a file field"), {
    status: 400,
    code: "file_missing"
  });
};