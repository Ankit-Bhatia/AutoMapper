import fs from 'node:fs/promises';
import path from 'node:path';

interface TocNode {
  text?: string;
  id?: string;
  a_attr?: { href?: string };
  children?: TocNode[];
}

interface GetDocumentResponse {
  deliverable: string;
  language: { locale: string };
  version: { doc_version: string; version_text: string; version_url: string };
  toc: TocNode[];
}

interface GetDocumentContentResponse {
  id: string;
  title: string;
  content: string;
}

interface CrawledField {
  name: string;
  type?: string;
  properties?: string[];
  description?: string;
  relationshipName?: string;
  relationshipType?: string;
  refersTo?: string[];
}

interface CrawledObject {
  name: string;
  href: string;
  title: string;
  fieldCount: number;
  fields: CrawledField[];
}

interface CrawlOutput {
  source: string;
  fetchedAt: string;
  docId: string;
  deliverable: string;
  locale: string;
  docVersion: string;
  versionText: string;
  objectCount: number;
  objects: CrawledObject[];
}

const BASE_URL = 'https://developer.salesforce.com';
const DOC_ID = 'atlas.en-us.object_reference.meta';
function resolveOutputPath(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'backend') {
    return path.resolve(cwd, 'data/salesforce-object-reference.json');
  }
  return path.resolve(cwd, 'backend/data/salesforce-object-reference.json');
}

const OUTPUT_PATH = resolveOutputPath();
const CONCURRENCY = Math.max(2, Number(process.env.SF_DOCS_CRAWL_CONCURRENCY || 8));

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json() as Promise<T>;
}

function flattenToc(nodes: TocNode[]): TocNode[] {
  const out: TocNode[] = [];
  const walk = (items: TocNode[]) => {
    for (const item of items) {
      out.push(item);
      if (item.children?.length) walk(item.children);
    }
  };
  walk(nodes);
  return out;
}

function extractStandardObjectNodes(toc: TocNode[]): Array<{ name: string; href: string }> {
  const all = flattenToc(toc);
  const standardObjectsNode = all.find((n) => n.id === 'sforce_api_objects_list');
  if (!standardObjectsNode?.children?.length) {
    throw new Error('Could not locate Standard Objects node in Salesforce object reference TOC');
  }

  const objectNodes = flattenToc(standardObjectsNode.children)
    .map((n) => ({ name: n.text?.trim() ?? '', href: n.a_attr?.href?.trim() ?? '' }))
    .filter((n) => n.name && n.href)
    .filter((n) => /^sforce_api_objects_[a-z0-9_]+\.htm$/i.test(n.href))
    .filter((n) => !n.href.endsWith('_list.htm'))
    .filter((n) => !n.href.includes('custom_object__c') && !n.href.includes('custommetadatatype__mdt'));

  const seen = new Set<string>();
  return objectNodes.filter((n) => {
    if (seen.has(n.href)) return false;
    seen.add(n.href);
    return true;
  });
}

function stripTags(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

function parseFieldRows(contentHtml: string): CrawledField[] {
  const fieldsSectionMatch = contentHtml.match(/<h2[^>]*>\s*Fields\s*<\/h2>[\s\S]*?<table[\s\S]*?<\/table>/i);
  if (!fieldsSectionMatch) return [];

  const tableHtml = fieldsSectionMatch[0];
  const tbodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const rowsHtml = tbodyMatch ? tbodyMatch[1] : tableHtml;
  const rows = rowsHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];

  const parsed: CrawledField[] = [];
  for (const row of rows) {
    const tdMatches = row.match(/<td[\s\S]*?<\/td>/gi) ?? [];
    if (tdMatches.length < 2) continue;

    const fieldName = stripTags(tdMatches[0]);
    if (!fieldName) continue;

    const detailsHtml = tdMatches[1];
    const field: CrawledField = { name: fieldName };

    const dtddPairs = [...detailsHtml.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)];
    for (const match of dtddPairs) {
      const label = stripTags(match[1]).toLowerCase();
      const value = stripTags(match[2]);
      if (!label || !value) continue;

      if (label === 'type') field.type = value;
      else if (label === 'properties') field.properties = value.split(',').map((v) => v.trim()).filter(Boolean);
      else if (label === 'description') field.description = value;
      else if (label === 'relationship name') field.relationshipName = value;
      else if (label === 'relationship type') field.relationshipType = value;
      else if (label === 'refers to') field.refersTo = value.split(',').map((v) => v.trim()).filter(Boolean);
    }

    parsed.push(field);
  }

  return parsed;
}

async function crawlObject(
  href: string,
  nameHint: string,
  locale: string,
  docVersion: string,
  deliverable: string,
): Promise<CrawledObject | null> {
  const url = `${BASE_URL}/docs/get_document_content/${deliverable}/${href}/${locale}/${docVersion}`;
  const doc = await fetchJson<GetDocumentContentResponse>(url);
  const fields = parseFieldRows(doc.content);
  if (fields.length === 0) return null;

  return {
    name: nameHint,
    href,
    title: doc.title,
    fieldCount: fields.length,
    fields,
  };
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
  return results;
}

async function main(): Promise<void> {
  const meta = await fetchJson<GetDocumentResponse>(`${BASE_URL}/docs/get_document/${DOC_ID}`);
  const objectNodes = extractStandardObjectNodes(meta.toc);

  console.log(`Discovered ${objectNodes.length} standard object pages in TOC (${meta.version.version_text})`);

  let completed = 0;
  const crawled = await runPool(
    objectNodes,
    CONCURRENCY,
    async (node) => {
      try {
        const result = await crawlObject(
          node.href,
          node.name,
          meta.language.locale,
          meta.version.doc_version,
          meta.deliverable,
        );
        completed += 1;
        if (completed % 50 === 0 || completed === objectNodes.length) {
          console.log(`Crawled ${completed}/${objectNodes.length}`);
        }
        return result;
      } catch (error) {
        completed += 1;
        console.warn(`Failed ${node.href}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
  );

  const objects = crawled.filter((o): o is CrawledObject => Boolean(o));
  const output: CrawlOutput = {
    source: 'Salesforce Developer Object Reference',
    fetchedAt: new Date().toISOString(),
    docId: DOC_ID,
    deliverable: meta.deliverable,
    locale: meta.language.locale,
    docVersion: meta.version.doc_version,
    versionText: meta.version.version_text,
    objectCount: objects.length,
    objects,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output), 'utf8');

  const totalFields = objects.reduce((sum, obj) => sum + obj.fieldCount, 0);
  console.log(`Wrote ${output.objectCount} objects / ${totalFields} fields to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
