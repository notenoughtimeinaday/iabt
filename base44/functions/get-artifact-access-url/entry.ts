import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";

const EXPIRES_IN_SECONDS = 300;

function clean(value: unknown, max = 500) {
  return String(value || "").trim().slice(0, max);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const service = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const artifactId = clean(body?.artifact_id, 200);
    if (!artifactId) return Response.json({ error: "artifact_id is required." }, { status: 400 });

    let artifact;
    try {
      artifact = await service.entities.CreationArtifact.get(artifactId);
    } catch {
      artifact = null;
    }
    if (!artifact || String(artifact.user_id) !== String(user.id)) {
      return Response.json({ error: "Artifact not found." }, { status: 404 });
    }

    const fileUri = clean(artifact.file_uri, 2000);
    if (!fileUri) {
      return Response.json({
        error: "This artifact does not contain a private stored file.",
        code: "no_private_file",
      }, { status: 409 });
    }

    const result = await service.integrations.Core.CreateFileSignedUrl({
      file_uri: fileUri,
      expires_in: EXPIRES_IN_SECONDS,
    });
    const signedUrl = clean(result?.signed_url, 8000);
    if (!/^https:\/\//i.test(signedUrl)) {
      throw new Error("Private storage did not return a secure access URL.");
    }

    return Response.json({
      ok: true,
      artifact_id: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      mime_type: artifact.mime_type,
      url: signedUrl,
      signed_url: signedUrl,
      expires_in: EXPIRES_IN_SECONDS,
      expires_at: new Date(Date.now() + EXPIRES_IN_SECONDS * 1000).toISOString(),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? clean(error.message, 1000) : "Could not create an artifact access URL.";
    return Response.json({ error: message }, { status: 500 });
  }
});
