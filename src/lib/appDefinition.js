export const SCHEMA_VERSION = "1.0";

export const COMPONENT_TYPES = ["Text", "Input", "Button", "ScannerInput"];

const DEFAULT_THEME = {
  primary: "#7c3aed",
  background: "#f8fafc",
  surface: "#ffffff",
  text: "#111827",
  radius: "18",
};

export function createId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return prefix + "_" + globalThis.crypto.randomUUID();
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "page";
}

export function normalizeRoute(value, fallback = "page") {
  const raw = String(value || "").trim();
  const slug = slugify(raw.replace(/^\/+/, "") || fallback);
  return slug === "home" ? "/" : "/" + slug;
}

function uniqueRoute(route, used) {
  const base = route === "/" ? "/" : normalizeRoute(route);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const stem = base === "/" ? "/home" : base;
  let index = 2;
  while (used.has(stem + "-" + index)) index += 1;
  const next = stem + "-" + index;
  used.add(next);
  return next;
}

function normalizeComponent(component, index) {
  const raw = component && typeof component === "object" ? component : {};
  const type = COMPONENT_TYPES.includes(raw.type) ? raw.type : "Text";
  const props = raw.props && typeof raw.props === "object" ? raw.props : {};
  const normalized = { id: String(raw.id || createId("component")), type, props: {} };

  if (type === "Text") normalized.props.value = String(props.value ?? props.label ?? "Text block");
  if (type === "Input") normalized.props.placeholder = String(props.placeholder ?? props.label ?? "Enter a value");
  if (type === "Button") {
    normalized.props.label = String(props.label ?? props.value ?? "Continue");
    if (props.to) normalized.props.to = normalizeRoute(props.to, "page-" + (index + 1));
  }
  if (type === "ScannerInput") normalized.props.label = String(props.label ?? "Scan barcode or QR code");

  return normalized;
}

function normalizePage(page, index, usedRoutes) {
  const raw = page && typeof page === "object" ? page : {};
  const name = String(raw.name || raw.title || (index === 0 ? "Home" : "Page " + (index + 1))).slice(0, 80);
  const route = uniqueRoute(index === 0 && !raw.route ? "/" : normalizeRoute(raw.route, name), usedRoutes);
  const components = Array.isArray(raw.components)
    ? raw.components.slice(0, 60).map(normalizeComponent)
    : [];

  return {
    id: String(raw.id || createId("page")),
    name,
    route,
    layout: "column",
    components,
  };
}

export function createDefaultAppDefinition(name = "Untitled SaaS") {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: {
      name: String(name || "Untitled SaaS").slice(0, 100),
      description: "A SaaS application designed in IABT.",
    },
    theme: { ...DEFAULT_THEME },
    pages: [
      {
        id: createId("page"),
        name: "Home",
        route: "/",
        layout: "column",
        components: [
          { id: createId("component"), type: "Text", props: { value: "Welcome to your new app" } },
          { id: createId("component"), type: "Input", props: { placeholder: "Enter your email" } },
          { id: createId("component"), type: "Button", props: { label: "Get started" } },
        ],
      },
    ],
    data: [],
    workflows: [],
    integrations: [],
    permissions: [],
  };
}

export function normalizeAppDefinition(input, fallbackName = "Untitled SaaS") {
  let source = input;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      source = {};
    }
  }
  if (source?.app_definition) source = source.app_definition;
  if (!source || typeof source !== "object") source = {};

  const usedRoutes = new Set();
  const pagesSource = Array.isArray(source.pages) ? source.pages.slice(0, 30) : [];
  const pages = pagesSource.map((page, index) => normalizePage(page, index, usedRoutes));
  const fallback = createDefaultAppDefinition(fallbackName);
  const appSource = source.app && typeof source.app === "object" ? source.app : {};
  const themeSource = source.theme && typeof source.theme === "object" ? source.theme : {};

  return {
    schemaVersion: SCHEMA_VERSION,
    app: {
      name: String(appSource.name || source.appName || source.name || fallbackName || "Untitled SaaS").slice(0, 100),
      description: String(appSource.description || source.description || fallback.app.description).slice(0, 500),
    },
    theme: {
      primary: /^#[0-9a-f]{6}$/i.test(themeSource.primary || "") ? themeSource.primary : DEFAULT_THEME.primary,
      background: /^#[0-9a-f]{6}$/i.test(themeSource.background || "") ? themeSource.background : DEFAULT_THEME.background,
      surface: /^#[0-9a-f]{6}$/i.test(themeSource.surface || "") ? themeSource.surface : DEFAULT_THEME.surface,
      text: /^#[0-9a-f]{6}$/i.test(themeSource.text || "") ? themeSource.text : DEFAULT_THEME.text,
      radius: String(Math.min(32, Math.max(0, Number(themeSource.radius ?? DEFAULT_THEME.radius) || 0))),
    },
    pages: pages.length ? pages : fallback.pages,
    data: Array.isArray(source.data) ? source.data : [],
    workflows: Array.isArray(source.workflows) ? source.workflows : [],
    integrations: Array.isArray(source.integrations) ? source.integrations : [],
    permissions: Array.isArray(source.permissions) ? source.permissions : [],
  };
}

export function createComponent(type) {
  if (type === "Input") {
    return { id: createId("component"), type, props: { placeholder: "Enter a value" } };
  }
  if (type === "Button") {
    return { id: createId("component"), type, props: { label: "Continue" } };
  }
  if (type === "ScannerInput") {
    return { id: createId("component"), type, props: { label: "Scan barcode or QR code" } };
  }
  return { id: createId("component"), type: "Text", props: { value: "New text block" } };
}

export function createPage(name, existingPages = []) {
  const used = new Set(existingPages.map((page) => page.route));
  const safeName = String(name || "New Page").slice(0, 80);
  return {
    id: createId("page"),
    name: safeName,
    route: uniqueRoute(normalizeRoute(safeName), used),
    layout: "column",
    components: [],
  };
}

export function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function validateAppDefinition(definition) {
  const errors = [];
  if (!definition || typeof definition !== "object") return ["AppDefinition must be an object."];
  if (!definition.app?.name) errors.push("The app needs a name.");
  if (!Array.isArray(definition.pages) || definition.pages.length === 0) errors.push("The app needs at least one page.");

  const routes = new Set();
  for (const page of definition.pages || []) {
    if (!page.name) errors.push("Every page needs a name.");
    if (!String(page.route || "").startsWith("/")) errors.push('Route "' + (page.route || "") + '" must start with /.');
    if (routes.has(page.route)) errors.push('Route "' + page.route + '" is duplicated.');
    routes.add(page.route);
    for (const component of page.components || []) {
      if (!COMPONENT_TYPES.includes(component.type)) errors.push('Unsupported component type "' + component.type + '".');
    }
  }
  return errors;
}
