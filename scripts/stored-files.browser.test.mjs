// Opt-in real Chromium acceptance; no application account or external service.
// Install Playwright normally, or set IABT_PLAYWRIGHT_MODULE to its index.mjs.
// IABT_BROWSER_EXECUTABLE may select an installed Chromium/Chrome/Edge binary.
// Run: node --test scripts/stored-files.browser.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

test("delayed private links download exact bytes without popups, CORS or forwarded credentials", { timeout: 45000 }, async (t) => {
  const { chromium } = await import(process.env.IABT_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.IABT_PLAYWRIGHT_MODULE).href : "playwright");
  const helper = await readFile(new URL("../src/lib/stored-files.js", import.meta.url), "utf8");
  const content = Buffer.from("IABT private browser download regression\nVerified exact attachment bytes.\n");
  const requests = [];
  const signedLinks = new Set();
  let accessCount = 0;
  let denyAccess = false;
  let staleRequests = 0;
  const storage = createServer((req, res) => {
    const parsed = new URL(req.url, "http://localhost");
    if (parsed.pathname !== "/private-file" || !signedLinks.has(parsed.searchParams.get("signature"))) {
      res.writeHead(403).end(); return;
    }
    requests.push({ signature: parsed.searchParams.get("signature"), authorization: req.headers.authorization, referer: req.headers.referer });
    // No Access-Control-Allow-Origin: ordinary attachment navigation needs no CORS.
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Content-Length": content.length,
      "Content-Disposition": "attachment; filename*=UTF-8''private-report.txt",
      "Cache-Control": "no-store",
    }).end(content);
  });
  await new Promise((resolve) => storage.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => storage.close(resolve)));
  const storageOrigin = `http://127.0.0.1:${storage.address().port}`;
  const app = createServer(async (req, res) => {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><title>Download acceptance</title><iframe title="Studio fixture" sandbox="allow-scripts allow-same-origin allow-downloads" src="/fixture"></iframe>');
    } else if (req.url === "/stored-files.js") {
      res.setHeader("Content-Type", "text/javascript"); res.end(helper);
    } else if (req.url === "/fixture") {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><title>Studio fixture</title>
        <button id="previous">Previous new-context handoff</button><button id="download">Download</button><p id="status">Ready</p>
        <script type="module">
          import { resolveFileDownload, openFileDownload } from '/stored-files.js';
          const client = { files: { access: async () => {
            const response = await fetch('/access', { headers: { Authorization: 'Bearer local-fixture-only' } });
            if (!response.ok) throw new Error('File access denied');
            return response.json();
          } } };
          const asset = { file_id: 'owned-file', file_url: '/expired-stored-link', name: 'untrusted-client-name.txt' };
          for (const id of ['previous', 'download']) document.getElementById(id).onclick = async () => {
            document.getElementById('status').textContent = 'Preparing';
            try {
              const url = await resolveFileDownload(client, asset, true);
              openFileDownload(url, asset.name, id === 'download');
              document.getElementById('status').textContent = 'Handed to browser';
            } catch (error) { document.getElementById('status').textContent = error.message; }
          };
        </script>`);
    } else if (req.url === "/access") {
      accessCount += 1;
      if (req.headers.authorization !== "Bearer local-fixture-only" || denyAccess) {
        res.writeHead(403).end(); return;
      }
      // Longer than Chromium's transient user activation window.
      await new Promise((resolve) => setTimeout(resolve, 5500));
      const signature = String(accessCount);
      signedLinks.add(signature);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ file_url: `${storageOrigin}/private-file?signature=${signature}` }));
    } else {
      staleRequests += Number(req.url === "/expired-stored-link");
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const appOrigin = `http://127.0.0.1:${app.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.IABT_BROWSER_EXECUTABLE ? { executablePath: process.env.IABT_BROWSER_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ acceptDownloads: true });
  await context.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return [appOrigin, storageOrigin].includes(origin) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const downloads = [];
  const popupBlocks = [];
  page.on("download", (download) => downloads.push(download));
  page.on("console", (message) => { if (/Blocked opening.*sandboxed/i.test(message.text())) popupBlocks.push(message.text()); });
  await page.goto(appOrigin);
  const frame = page.frameLocator("iframe");

  // Reproduce the former helper behavior in a browser that disallows new contexts.
  await frame.locator("#previous").click();
  await frame.locator("#status").filter({ hasText: "Handed to browser" }).waitFor({ timeout: 10000 });
  assert.equal(popupBlocks.length, 1, "the previous handoff must hit the real browser popup restriction");
  assert.equal(requests.length, 0);
  assert.equal(downloads.length, 0);

  for (let i = 0; i < 2; i += 1) {
    const received = page.waitForEvent("download", { timeout: 10000 });
    await frame.locator("#download").click();
    const download = await received;
    assert.equal(await download.failure(), null);
    assert.equal(download.suggestedFilename(), "private-report.txt", "the server attachment name is authoritative across origins");
    const downloadedPath = await download.path();
    assert.ok(downloadedPath, "the browser must save a file, not just dispatch a DOM click");
    assert.deepEqual(await readFile(downloadedPath), content);
    assert.equal(page.url(), `${appOrigin}/`);
    assert.equal(page.frames()[1].url(), `${appOrigin}/fixture`);
    assert.equal(context.pages().length, 1, "no new tab or browsing context is needed");
    assert.equal(requests[i].authorization, undefined, "the app bearer token must not be forwarded to private storage");
    assert.equal(requests[i].referer, undefined, "download requests must not expose the Studio URL");
  }
  assert.deepEqual(requests.map((request) => request.signature), ["2", "3"], "each click must renew its private link");
  assert.equal(downloads.length, 2);
  denyAccess = true;
  await frame.locator("#download").click();
  await frame.locator("#status").filter({ hasText: "File access denied" }).waitFor();
  assert.equal(requests.length, 2, "authorization failure must not issue a storage GET");
  assert.equal(downloads.length, 2);
  assert.equal(accessCount, 4);
  assert.equal(staleRequests, 0, "never fall back to an expired stored link");
});
