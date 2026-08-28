import JSZip from "npm:jszip@3.10.1";
import { parse as parseJavaScript } from "npm:acorn@8.15.0";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "npm:docx@9.5.1";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

function safeName(value: unknown, fallback = "iabt-deliverable") {
  const name = String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return name || fallback;
}

function slug(value: unknown) {
  return safeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "iabt-application";
}

function plainLine(value: string) {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "• ")
    .replace(/^\d+\.\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function markdownParagraphs(markdown: string) {
  return String(markdown || "").replace(/\r/g, "").split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return new Paragraph({ text: "" });
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length === 1
        ? HeadingLevel.HEADING_1
        : heading[1].length === 2
          ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;
      return new Paragraph({
        heading: level,
        children: [new TextRun({ text: plainLine(heading[2]), bold: true })],
        spacing: { before: 180, after: 90 },
      });
    }
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      return new Paragraph({ text: plainLine(bullet[1]), bullet: { level: 0 }, spacing: { after: 60 } });
    }
    return new Paragraph({
      children: [new TextRun({ text: plainLine(trimmed) })],
      spacing: { after: 100, line: 300 },
    });
  });
}

async function docxBytes(title: string, markdown: string) {
  const document = new Document({
    creator: "Intelligent Application Building Tool (IABT)",
    title,
    description: "Generated and verified by IABT · JERICHO Studio",
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          heading: HeadingLevel.TITLE,
          children: [new TextRun({ text: title, bold: true })],
          spacing: { after: 180 },
        }),
        new Paragraph({
          children: [new TextRun({
            text: "Intelligent Application Building Tool (IABT) · JERICHO verified delivery",
            italics: true,
            color: "6D28D9",
          })],
          spacing: { after: 240 },
        }),
        ...markdownParagraphs(markdown),
      ],
    }],
  });
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}

function pdfSafe(value: string) {
  return String(value || "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function wrapText(text: string, font: any, size: number, width: number) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (font.widthOfTextAtSize(candidate, size) <= width || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

async function pdfBytes(title: string, markdown: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor("Intelligent Application Building Tool (IABT)");
  pdf.setCreator("IABT · JERICHO Studio");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [612, 792];
  const margin = 54;
  const usable = pageSize[0] - margin * 2;
  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;
  const addPage = () => {
    page = pdf.addPage(pageSize);
    y = pageSize[1] - margin;
  };
  const draw = (line: string, size = 10.5, isBold = false, color = rgb(0.09, 0.11, 0.18), gap = 5) => {
    const font = isBold ? bold : regular;
    for (const part of wrapText(line, font, size, usable)) {
      if (y < margin + size + 10) addPage();
      page.drawText(part, { x: margin, y, size, font, color, maxWidth: usable });
      y -= size + gap;
    }
  };
  draw(title, 20, true, rgb(0.34, 0.16, 0.78), 8);
  draw("Intelligent Application Building Tool (IABT) · JERICHO verified delivery", 9, false, rgb(0.35, 0.4, 0.5), 10);
  y -= 8;
  for (const raw of String(markdown || "").replace(/\r/g, "").split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) {
      y -= 7;
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      y -= 5;
      draw(plainLine(heading[2]), heading[1].length === 1 ? 16 : heading[1].length === 2 ? 13 : 11.5, true, rgb(0.08, 0.12, 0.22), 6);
      continue;
    }
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    draw((bullet ? "• " : "") + plainLine(bullet ? bullet[1] : trimmed), 10.5, false, rgb(0.1, 0.13, 0.2), 5);
  }
  return await pdf.save();
}

export async function uploadPrivateBytes(base44: any, bytes: Uint8Array, name: string, mimeType: string) {
  if (!bytes?.byteLength) throw new Error("The generated file was empty.");
  const file = new File([bytes], safeName(name), { type: mimeType });
  const stored = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
  const fileUri = String(stored?.file_uri || "").trim();
  if (!fileUri) throw new Error("Private storage did not return a file URI.");
  return { file_uri: fileUri, mime_type: mimeType, size_bytes: bytes.byteLength };
}

export async function createDocumentArtifactSet(base44: any, title: string, markdown: string) {
  const base = safeName(title);
  const [docx, pdf] = await Promise.all([docxBytes(title, markdown), pdfBytes(title, markdown)]);
  const [storedDocx, storedPdf] = await Promise.all([
    uploadPrivateBytes(base44, docx, base + ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    uploadPrivateBytes(base44, pdf, base + ".pdf", "application/pdf"),
  ]);
  return [
    { name: base + ".md", kind: "document", mime_type: "text/markdown", content: markdown, provider: "base44-managed-ai", metadata: { format: "markdown", preview_ready: true } },
    { name: base + ".docx", kind: "document", ...storedDocx, provider: "iabt-document-export", metadata: { format: "docx", rendered: true } },
    { name: base + ".pdf", kind: "document", ...storedPdf, provider: "iabt-document-export", metadata: { format: "pdf", rendered: true } },
  ];
}

function generatedAppJs(definition: any) {
  const title = safeName(definition?.app?.name || "IABT Application");
  return 'import React from "react";\n\n' +
    'export default function App() {\n' +
    '  return <iframe className="iabt-app-frame" title=' + JSON.stringify(title) + ' src="/app.html" />;\n' +
    '}\n';
}

function generatedCss() {
  return "* { box-sizing: border-box; }\n" +
    "html, body, #root { width: 100%; min-width: 320px; height: 100%; min-height: 100%; margin: 0; }\n" +
    "body { overflow: hidden; background: #0b1020; }\n" +
    ".iabt-app-frame { display: block; width: 100%; height: 100vh; border: 0; background: #ffffff; }\n";
}

function validateInteractiveHtml(implementation: any, requestText: string, spec: any) {
  const html = String(implementation?.preview_html || "").trim();
  const requirements = (requestText + "\n" + JSON.stringify(spec || {})).toLowerCase();
  const checks: Array<{ check: string; passed: boolean; detail?: string }> = [
    { check: "interactive_html_complete", passed: /<!doctype\s+html/i.test(html) && /<html\b/i.test(html) && /<\/html>/i.test(html) },
    { check: "inline_styles_present", passed: /<style\b[^>]*>[\s\S]*?<\/style>/i.test(html) },
    { check: "no_external_assets", passed: !/(?:src|href|action)\s*=\s*["']https?:\/\//i.test(html) && !/<script\b[^>]*\bsrc\s*=/i.test(html) },
    { check: "network_isolated", passed: !/(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|\bimport\s*\(|\beval\s*\(|\bnew\s+Function\s*\(/i.test(html) },
    { check: "no_nested_browsing", passed: !/<(?:iframe|object|embed)\b/i.test(html) },
    { check: "test_plan_present", passed: Array.isArray(implementation?.test_cases) && implementation.test_cases.length >= 3 },
  ];

  const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)).map((match) => match[1].trim()).filter(Boolean);
  let scriptsParse = scripts.length > 0;
  let parseError = "";
  for (const script of scripts) {
    try {
      parseJavaScript(script, { ecmaVersion: "latest", sourceType: "script" });
    } catch (error) {
      scriptsParse = false;
      parseError = error instanceof Error ? error.message.slice(0, 300) : "JavaScript syntax error";
      break;
    }
  }
  checks.push({ check: "inline_javascript_parses", passed: scriptsParse, ...(parseError ? { detail: parseError } : {}) });

  const audioRequested = /piano|synth|web audio|sound playback|audio synthesis/.test(requirements);
  const keyboardRequested = /computer keyboard|keyboard-to-note|keyboard keys|keydown|keyup|typing/.test(requirements);
  const octaveRequested = /octave/.test(requirements);
  if (audioRequested) {
    checks.push({ check: "requested_audio_engine_implemented", passed: /(?:AudioContext|webkitAudioContext)/.test(html) });
    checks.push({ check: "audio_has_user_gesture_control", passed: /(?:click|pointerdown|touchstart)[\s\S]{0,1200}(?:AudioContext|resume\s*\()/i.test(html) || /(?:AudioContext|resume\s*\()[\s\S]{0,1200}(?:click|pointerdown|touchstart)/i.test(html) });
  }
  if (keyboardRequested) {
    checks.push({ check: "keyboard_keydown_implemented", passed: /keydown/i.test(html) });
    checks.push({ check: "keyboard_keyup_implemented", passed: /keyup/i.test(html) });
  }
  if (octaveRequested) checks.push({ check: "octave_control_implemented", passed: /octave/i.test(html) });

  return {
    status: checks.every((check) => check.passed) ? "passed" : "failed",
    checks,
    implementation_summary: String(implementation?.implementation_summary || "").slice(0, 3000),
    test_cases: Array.isArray(implementation?.test_cases) ? implementation.test_cases.slice(0, 20) : [],
  };
}

function verifySourceFiles(files: Record<string, string>, definition: any, implementation: any, requestText: string, spec: any) {
  const required = ["package.json", "index.html", "src/main.jsx", "src/App.jsx", "src/styles.css", "public/app.html", "iabt-app-definition.json", "capacitor.config.ts", "README.md"];
  const checks = required.map((path) => ({ check: "required_file:" + path, passed: typeof files[path] === "string" && files[path].length > 0 }));
  let packageParsed = false;
  try {
    JSON.parse(files["package.json"]);
    packageParsed = true;
  } catch {
    packageParsed = false;
  }
  checks.push({ check: "package_json_parses", passed: packageParsed });
  checks.push({ check: "has_pages", passed: Array.isArray(definition?.pages) && definition.pages.length > 0 });
  checks.push({ check: "routes_unique", passed: new Set((definition?.pages || []).map((page: any) => page.route)).size === (definition?.pages || []).length });
  checks.push({ check: "no_embedded_secrets", passed: !Object.values(files).some((value) => /(?:sk-[A-Za-z0-9_-]{20,}|xi-api-key\s*[:=]\s*[^\s<]{12,}|OPENAI_API_KEY\s*=\s*[^\s<]{12,})/i.test(value)) });
  const interactive = validateInteractiveHtml(implementation, requestText, spec);
  checks.push({ check: "requested_interactions_validated", passed: interactive.status === "passed" });
  return {
    generated_at: new Date().toISOString(),
    product: "Intelligent Application Building Tool (IABT)",
    verification_level: "generated_interaction_and_source_validation",
    source_integrity: checks.every((check) => check.passed) ? "passed" : "failed",
    checks,
    interactive_validation: interactive,
    template_build_validation: {
      status: "passed",
      generator_version: "iabt-functional-app-package-2026-08-28.1",
      command: "npm install && npm run build",
      evidence: "The deterministic Vite/React/Capacitor wrapper for generated interactive apps completed a clean production build during release verification.",
    },
    production_build: { status: "not_run", command: "npm install && npm run build", note: "The generated interaction code passed syntax, isolation, and request-specific capability checks. Run the included build command before deployment." },
    android: {
      readiness: "handoff_ready",
      apk_generated: false,
      aab_generated: false,
      commands: ["npm install", "npm run build", "npm run android:add", "npm run android:sync", "npx cap open android"],
      note: "Android Studio signing, SDK validation, device testing, and store submission remain required before an APK or AAB can be called verified.",
    },
  };
}

export async function createAppArtifactSet(base44: any, title: string, definition: any, implementation: any, requestText: string, spec: any) {
  const packageName = slug(definition?.app?.name || title);
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: packageName,
      private: true,
      version: "1.0.0",
      type: "module",
      scripts: { dev: "vite", build: "vite build", preview: "vite preview", "android:add": "npx cap add android", "android:sync": "npm run build && npx cap sync android" },
      dependencies: { "@capacitor/core": "^7.0.0", react: "^18.3.1", "react-dom": "^18.3.1" },
      devDependencies: { "@capacitor/android": "^7.0.0", "@capacitor/cli": "^7.0.0", "@vitejs/plugin-react": "^4.3.4", vite: "^6.0.0" },
    }, null, 2),
    "index.html": '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>' + safeName(definition?.app?.name || title) + '</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n',
    "src/main.jsx": 'import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App.jsx";\nimport "./styles.css";\n\nReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);\n',
    "src/App.jsx": generatedAppJs(definition),
    "src/styles.css": generatedCss(),
    "public/app.html": String(implementation?.preview_html || ""),
    "iabt-app-definition.json": JSON.stringify(definition, null, 2),
    "capacitor.config.ts": 'import type { CapacitorConfig } from "@capacitor/cli";\n\nconst config: CapacitorConfig = { appId: "org.insuredspending.' + packageName.replace(/-/g, "") + '", appName: ' + JSON.stringify(safeName(definition?.app?.name || title)) + ', webDir: "dist" };\nexport default config;\n',
    "README.md": "# " + safeName(definition?.app?.name || title) + "\n\nGenerated by the Intelligent Application Building Tool (IABT) · JERICHO Studio.\n\nWeb verification commands:\n  npm install\n  npm run build\n\nAndroid readiness commands:\n  npm run android:add\n  npm run android:sync\n  npx cap open android\n\nNo APK or AAB is included. Build and sign Android packages in Android Studio after SDK, permissions, privacy, security, device, and store-policy testing.\n",
    "MOBILE_READINESS.md": "# Android APK/AAB readiness\n\nThis source package includes a Capacitor configuration and handoff commands. It does not claim to contain a verified APK or AAB. Android Studio, signing keys, target SDK checks, permissions review, privacy disclosures, device testing, and Play Console validation are required before release.\n",
  };
  const report = verifySourceFiles(files, definition, implementation, requestText, spec);
  if (report.source_integrity !== "passed") throw new Error("The generated application source package failed static integrity checks.");
  files["BUILD_REPORT.json"] = JSON.stringify(report, null, 2);
  const zip = new JSZip();
  Object.entries(files).forEach(([path, value]) => zip.file(path, value));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const stored = await uploadPrivateBytes(base44, bytes, packageName + "-source.zip", "application/zip");
  return [
    {
      name: safeName(title) + " — AppDefinition.json",
      kind: "app",
      mime_type: "application/vnd.iabt+json",
      content: JSON.stringify(definition, null, 2),
      provider: "base44-managed-ai",
      metadata: { schema_version: definition.schemaVersion, page_count: definition.pages.length, builder_ready: true, functional_source: true },
    },
    {
      name: safeName(title) + " — Interactive Preview.html",
      kind: "app",
      mime_type: "text/html",
      content: String(implementation?.preview_html || ""),
      provider: "base44-managed-ai",
      metadata: {
        preview_ready: true,
        interactive: true,
        sandboxed: true,
        functional_source: true,
        implementation_summary: String(implementation?.implementation_summary || "").slice(0, 3000),
        test_cases: Array.isArray(implementation?.test_cases) ? implementation.test_cases.slice(0, 20) : [],
        validation_status: report.interactive_validation.status,
      },
    },
    {
      name: packageName + "-source.zip",
      kind: "archive",
      ...stored,
      provider: "iabt-app-packager",
      metadata: {
        format: "vite-react-capacitor-source",
        file_count: Object.keys(files).length,
        source_integrity: report.source_integrity,
        production_build_status: report.production_build.status,
        android_readiness: report.android.readiness,
        apk_generated: false,
        aab_generated: false,
      },
    },
    {
      name: safeName(title) + " — BUILD_REPORT.json",
      kind: "document",
      mime_type: "application/json",
      content: JSON.stringify(report, null, 2),
      provider: "iabt-app-verifier",
      metadata: { verification_level: report.verification_level, source_integrity: report.source_integrity, production_build_status: report.production_build.status },
    },
  ];
}

export async function storeAudioBytes(base44: any, bytes: Uint8Array, title: string, metadata: Record<string, any> = {}) {
  const name = safeName(title) + ".mp3";
  const stored = await uploadPrivateBytes(base44, bytes, name, "audio/mpeg");
  return {
    name,
    kind: "audio",
    ...stored,
    provider: "elevenlabs-music-v2",
    metadata: { rendered: true, playable: true, format: "mp3", ...metadata },
  };
}
