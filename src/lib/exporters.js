const encoder = new TextEncoder();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function zipBlob(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const [path, content] of entries) {
    const name = encoder.encode(path.replace(/\\/g, "/"));
    const data = content instanceof Uint8Array ? content : encoder.encode(String(content));
    const checksum = crc32(data);

    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);

    localParts.push(localHeader, name, data);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + data.length;
  }

  const central = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, localOffset, true);

  return new Blob([...localParts, central, end], { type: "application/zip" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeName(value) {
  return String(value || "iabt-app")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "iabt-app";
}

function pageFilename(page) {
  if (page.route === "/") return "index.html";
  return page.route.replace(/^\/+/, "").replace(/[^a-z0-9/_-]/gi, "-").replace(/\//g, "-") + ".html";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function componentMarkup(component, routeToFile = null) {
  const props = component.props || {};
  if (component.type === "Text") {
    return '<p class="iabt-text">' + escapeHtml(props.value || "") + "</p>";
  }
  if (component.type === "Input") {
    return '<input class="iabt-input" type="text" placeholder="' + escapeHtml(props.placeholder || "") + '" />';
  }
  if (component.type === "ScannerInput") {
    return (
      '<label class="iabt-scanner"><span>' + escapeHtml(props.label || "Scan code") +
      '</span><input class="iabt-input" type="text" autocomplete="off" data-scanner ' +
      'placeholder="Scan or type a code, then press Enter" /></label>'
    );
  }
  if (component.type === "Button") {
    const label = escapeHtml(props.label || "Continue");
    if (props.to && routeToFile) {
      const href = routeToFile.get(props.to) || "#";
      return '<a class="iabt-button" href="' + escapeHtml(href) + '">' + label + "</a>";
    }
    if (props.to) {
      return '<button class="iabt-button" type="button" data-to="' + escapeHtml(props.to) + '">' + label + "</button>";
    }
    return '<button class="iabt-button" type="button">' + label + "</button>";
  }
  return "";
}

function sharedCss(theme) {
  return [
    ":root{--primary:" + theme.primary + ";--background:" + theme.background + ";--surface:" + theme.surface + ";--text:" + theme.text + ";--radius:" + theme.radius + "px}",
    "*{box-sizing:border-box}",
    "body{margin:0;background:var(--background);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;min-height:100vh}",
    ".iabt-shell{max-width:760px;margin:0 auto;padding:48px 20px}",
    ".iabt-nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}",
    ".iabt-nav a{color:var(--text);text-decoration:none;padding:9px 13px;border-radius:999px;background:color-mix(in srgb,var(--surface) 88%,var(--primary));border:1px solid color-mix(in srgb,var(--primary) 20%,transparent)}",
    ".iabt-card{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 10%,transparent);border-radius:var(--radius);padding:28px;box-shadow:0 24px 70px rgba(15,23,42,.08)}",
    ".iabt-card h1{font-size:clamp(1.8rem,6vw,3rem);margin:0 0 22px}",
    ".iabt-stack{display:flex;flex-direction:column;gap:16px}",
    ".iabt-text{font-size:1.05rem;line-height:1.65;margin:0}",
    ".iabt-input{width:100%;padding:13px 14px;border-radius:12px;border:1px solid color-mix(in srgb,var(--text) 18%,transparent);background:var(--background);color:var(--text);font:inherit}",
    ".iabt-scanner{display:flex;flex-direction:column;gap:8px;font-weight:700;font-size:.85rem}",
    ".iabt-button{display:inline-flex;justify-content:center;align-items:center;min-height:46px;padding:12px 18px;border:0;border-radius:12px;background:var(--primary);color:#fff;text-decoration:none;font:700 1rem inherit;cursor:pointer}",
    ".iabt-scan-status{font-size:.8rem;min-height:1.2em;color:color-mix(in srgb,var(--text) 68%,transparent)}",
    "@media(max-width:520px){.iabt-shell{padding:20px 12px}.iabt-card{padding:20px}}",
  ].join("\n");
}

function scannerScript() {
  return [
    "document.addEventListener('keydown',function(event){",
    "var input=event.target;",
    "if(event.key==='Enter'&&input&&input.matches('[data-scanner]')){",
    "event.preventDefault();",
    "var code=input.value.trim();",
    "if(!code)return;",
    "window.dispatchEvent(new CustomEvent('iabt:scan',{detail:{code:code,source:'ScannerInput'}}));",
    "var status=document.querySelector('[data-scan-status]');",
    "if(status)status.textContent='Last scan: '+code;",
    "input.select();",
    "}",
    "});",
  ].join("");
}

function renderStaticPage(definition, page, routeToFile) {
  const nav = definition.pages
    .map((item) => '<a href="' + escapeHtml(routeToFile.get(item.route) || "#") + '">' + escapeHtml(item.name) + "</a>")
    .join("");
  const components = page.components.map((component) => componentMarkup(component, routeToFile)).join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width,initial-scale=1" />',
    "<title>" + escapeHtml(page.name) + " · " + escapeHtml(definition.app.name) + "</title>",
    "<style>" + sharedCss(definition.theme) + "</style>",
    "</head>",
    "<body>",
    '<main class="iabt-shell">',
    '<nav class="iabt-nav" aria-label="App pages">' + nav + "</nav>",
    '<section class="iabt-card"><h1>' + escapeHtml(page.name) + '</h1><div class="iabt-stack">' + components + '<p class="iabt-scan-status" data-scan-status></p></div></section>',
    "</main>",
    "<script>" + scannerScript() + "</script>",
    "</body>",
    "</html>",
  ].join("\n");
}

function buildStaticFiles(definition) {
  const routeToFile = new Map(definition.pages.map((page) => [page.route, pageFilename(page)]));
  const files = {};
  for (const page of definition.pages) {
    files[pageFilename(page)] = renderStaticPage(definition, page, routeToFile);
  }
  files["README.md"] = [
    "# " + definition.app.name,
    "",
    "Static multi-page export generated by IABT.",
    "",
    "Open index.html to begin. ScannerInput dispatches an iabt:scan CustomEvent when Enter completes a scan.",
  ].join("\n");
  return files;
}

function renderSingleHtml(definition) {
  const nav = definition.pages
    .map((page) => '<button type="button" data-to="' + escapeHtml(page.route) + '">' + escapeHtml(page.name) + "</button>")
    .join("");
  const sections = definition.pages
    .map((page, index) => {
      const body = page.components.map((component) => componentMarkup(component)).join("\n");
      return '<section class="iabt-card" data-page="' + escapeHtml(page.route) + '"' + (index ? ' hidden' : '') + '><h1>' + escapeHtml(page.name) + '</h1><div class="iabt-stack">' + body + '<p class="iabt-scan-status" data-scan-status></p></div></section>';
    })
    .join("\n");
  const router = [
    "(function(){",
    "var pages=Array.from(document.querySelectorAll('[data-page]'));",
    "function show(route){var found=false;pages.forEach(function(page){var match=page.dataset.page===route;page.hidden=!match;if(match)found=true;});if(!found&&pages[0])pages[0].hidden=false;}",
    "document.addEventListener('click',function(event){var button=event.target.closest('[data-to]');if(!button)return;var route=button.dataset.to;if(!route)return;location.hash=route;show(route);});",
    "window.addEventListener('hashchange',function(){show(location.hash.slice(1)||'/');});",
    "show(location.hash.slice(1)||'/');",
    "})();",
  ].join("");
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />',
    "<title>" + escapeHtml(definition.app.name) + "</title><style>" + sharedCss(definition.theme) + ".iabt-nav button{border:0;cursor:pointer}" + "</style></head>",
    '<body><main class="iabt-shell"><nav class="iabt-nav">' + nav + "</nav>" + sections + "</main>",
    "<script>" + scannerScript() + router + "</script></body></html>",
  ].join("\n");
}

function reactSource(definition) {
  const serialized = JSON.stringify(definition, null, 2);
  return [
    "import React, { useEffect, useState } from 'react';",
    "import './styles.css';",
    "",
    "const definition = " + serialized + ";",
    "",
    "function Element({ component, navigate }) {",
    "  const props = component.props || {};",
    "  if (component.type === 'Text') return <p className=\"iabt-text\">{props.value}</p>;",
    "  if (component.type === 'Input') return <input className=\"iabt-input\" placeholder={props.placeholder} />;",
    "  if (component.type === 'ScannerInput') return <label className=\"iabt-scanner\"><span>{props.label}</span><input className=\"iabt-input\" placeholder=\"Scan or type a code, then press Enter\" onKeyDown={(event) => { if (event.key === 'Enter' && event.currentTarget.value.trim()) { const code = event.currentTarget.value.trim(); window.dispatchEvent(new CustomEvent('iabt:scan', { detail: { code, source: 'ScannerInput' } })); event.currentTarget.select(); } }} /></label>;",
    "  if (component.type === 'Button') return <button className=\"iabt-button\" onClick={() => props.to && navigate(props.to)}>{props.label}</button>;",
    "  return null;",
    "}",
    "",
    "export default function App() {",
    "  const [route, setRoute] = useState(window.location.hash.slice(1) || '/');",
    "  const page = definition.pages.find((item) => item.route === route) || definition.pages[0];",
    "  const navigate = (next) => { window.location.hash = next; setRoute(next); };",
    "  useEffect(() => { const onHash = () => setRoute(window.location.hash.slice(1) || '/'); window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash); }, []);",
    "  return <main className=\"iabt-shell\"><nav className=\"iabt-nav\">{definition.pages.map((item) => <button key={item.id} onClick={() => navigate(item.route)}>{item.name}</button>)}</nav><section className=\"iabt-card\"><h1>{page.name}</h1><div className=\"iabt-stack\">{page.components.map((component) => <Element key={component.id} component={component} navigate={navigate} />)}</div></section></main>;",
    "}",
  ].join("\n");
}

export function downloadDefinitionJson(definition) {
  const blob = new Blob([JSON.stringify(definition, null, 2)], { type: "application/json" });
  downloadBlob(blob, safeName(definition.app.name) + ".iabt.json");
}

export function downloadStandaloneHtml(definition) {
  const blob = new Blob([renderSingleHtml(definition)], { type: "text/html;charset=utf-8" });
  downloadBlob(blob, safeName(definition.app.name) + ".html");
}

export async function downloadStaticZip(definition) {
  const folder = safeName(definition.app.name) + "-html/";
  const files = buildStaticFiles(definition);
  const entries = Object.entries(files).map(([name, value]) => [folder + name, value]);
  downloadBlob(zipBlob(entries), safeName(definition.app.name) + "-html.zip");
}

export function downloadReactSource(definition) {
  const blob = new Blob([reactSource(definition)], { type: "text/jsx;charset=utf-8" });
  downloadBlob(blob, safeName(definition.app.name) + "-App.jsx");
}

export async function downloadReactZip(definition) {
  const name = safeName(definition.app.name);
  const folder = name + "-react/";
  const packageJson = {
    name,
    private: true,
    version: "1.0.0",
    type: "module",
    scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
    dependencies: { "@vitejs/plugin-react": "^4.3.4", vite: "^6.1.0", react: "^18.3.1", "react-dom": "^18.3.1" },
    devDependencies: {},
  };
  const entries = [
    [folder + "package.json", JSON.stringify(packageJson, null, 2)],
    [folder + "index.html", '<!doctype html><html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>' + escapeHtml(definition.app.name) + '</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>'],
    [folder + "vite.config.js", "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n"],
    [folder + "src/main.jsx", "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App.jsx';\nReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);\n"],
    [folder + "src/App.jsx", reactSource(definition)],
    [folder + "src/styles.css", sharedCss(definition.theme) + "\n.iabt-nav button{border:0;cursor:pointer}\n"],
    [folder + "README.md", "# " + definition.app.name + "\n\nGenerated by IABT.\n\nRun npm install, then npm run dev.\n"],
  ];
  downloadBlob(zipBlob(entries), name + "-react.zip");
}
