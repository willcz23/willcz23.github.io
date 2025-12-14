import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

interface MenuItem {
  id?: string;
  text?: string;
  href?: string;
  subItems?: MenuItem[];
  items?: MenuItem[];
}

interface RoutePattern {
  file: string;
  regex: RegExp;
}

const ROOT_DIR = process.cwd();
const CONFIG_PATH = path.resolve(ROOT_DIR, "frosti.config.yaml");
const PAGES_DIR = path.resolve(ROOT_DIR, "src/pages");
const SUPPORTED_EXTENSIONS = new Set([".astro", ".md", ".mdx"]);

function readMenu(): MenuItem[] {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Cannot find configuration file at ${CONFIG_PATH}`);
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const parsed = yaml.load(raw) as { site?: { menu?: MenuItem[] } };
  return parsed?.site?.menu ?? [];
}

function collectPageFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPageFiles(fullPath));
    } else if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function escapeSegment(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

function createRoutePattern(filePath: string): RoutePattern {
  const relative = path.relative(PAGES_DIR, filePath).replace(/\\/g, "/");
  const ext = path.extname(relative);
  const withoutExt = relative.slice(0, -ext.length);
  const rawSegments = withoutExt.split("/");
  const segments =
    rawSegments[rawSegments.length - 1] === "index"
      ? rawSegments.slice(0, -1)
      : rawSegments;

  if (segments.length === 0) {
    return { file: relative, regex: /^\/$/ };
  }

  const pattern = segments
    .map((segment) => {
      if (segment.startsWith("[...") && segment.endsWith("]")) {
        return "(?:/.*)?";
      }
      if (segment.startsWith("[") && segment.endsWith("]")) {
        return "/[^/]+";
      }
      return `/${escapeSegment(segment)}`;
    })
    .join("");

  return { file: relative, regex: new RegExp(`^${pattern}$`) };
}

function buildRoutePatterns(): RoutePattern[] {
  if (!fs.existsSync(PAGES_DIR)) {
    throw new Error(`Cannot find pages directory at ${PAGES_DIR}`);
  }

  return collectPageFiles(PAGES_DIR).map(createRoutePattern);
}

function normalizeHref(href: string): string {
  if (href === "/") {
    return "/";
  }
  return href.replace(/\/$/, "");
}

function flattenMenu(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item) => {
    const children = [...(item.subItems ?? []), ...(item.items ?? [])];
    return [item, ...flattenMenu(children)];
  });
}

function isInternalLink(href: string | undefined): href is string {
  return Boolean(href && href.startsWith("/"));
}

function validateMenu(): void {
  const menuItems = flattenMenu(readMenu());
  const routes = buildRoutePatterns();

  if (routes.length === 0) {
    throw new Error("No routes found in src/pages. Did you remove all page files?");
  }

  const missing = menuItems
    .filter((item) => isInternalLink(item.href))
    .map((item) => ({ ...item, href: normalizeHref(item.href!) }))
    .filter((item) => !routes.some((route) => route.regex.test(item.href!)));

  if (missing.length > 0) {
    console.error("\nMenu validation failed. The following internal links do not map to a page:");
    for (const item of missing) {
      const label = item.text ?? item.id ?? item.href;
      console.error(` • ${label} (${item.href})`);
    }
    console.error("\nAvailable route patterns:");
    routes.forEach((route) => console.error(` - ${route.file}`));
    process.exitCode = 1;
    return;
  }

  console.log("Menu validation passed. All internal links have matching routes.");
}

validateMenu();
