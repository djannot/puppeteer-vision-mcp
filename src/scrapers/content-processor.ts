import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import sanitizeHtml from 'sanitize-html';
import { configureTurndownService } from '../utils/markdown-formatters.js';
import { markCodeParents } from '../utils/html-helpers.js';

/**
 * Processes HTML content to extract the main content and convert it to Markdown
 * @param htmlContent The raw HTML content to process
 * @returns Markdown formatted content
 */
export async function processHtmlContent(
  htmlContent: string,
  baseUrl?: string,
  sameDomainLinks?: string[]
): Promise<string> {
  const dom = new JSDOM(htmlContent);
  const document = dom.window.document;

  const mainContentElement =
    document.querySelector('.docs-content') ||
    document.querySelector('.doc-content') ||
    document.querySelector('.markdown-body') ||
    document.querySelector('article') ||
    document.querySelector('div[role="main"].document') ||
    document.querySelector('main') ||
    document.body;

  if (mainContentElement && mainContentElement !== document.body) {
    document.body.innerHTML = mainContentElement.innerHTML;
  }

  const h1Elements = document.querySelectorAll('h1');
  const extractedH1s: string[] = [];
  h1Elements.forEach(h1 => {
    const h1Text = h1.textContent?.trim() || '';
    if (h1Text && h1Text.length > 3 && !h1Text.match(/^(link|#|menu|close)$/i)) {
      extractedH1s.push(h1Text);
    }
    h1.classList.add('original-h1');
  });

  const preElements = document.querySelectorAll('pre');
  preElements.forEach(pre => {
    pre.classList.add('article-content');
    pre.setAttribute('data-readable-content-score', '100');
    if (pre.parentElement) {
      pre.parentElement.classList.add('article-content');
    }
  });

  document.querySelectorAll('pre, code').forEach(pre => {
    markCodeParents(pre.parentElement);
  });

  const readerOptions = {
    charThreshold: 20,
    classesToPreserve: ['article-content', 'original-h1'],
  };

  const reader = new Readability(document, readerOptions);
  const article = reader.parse();

  if (!article) {
    throw new Error('Failed to parse the article content.');
  }

  const articleDom = new JSDOM(article.content);
  const articleDoc = articleDom.window.document;
  const originalH1Elements = articleDoc.querySelectorAll('.original-h1');
  originalH1Elements.forEach(heading => {
    const h1 = articleDoc.createElement('h1');
    h1.innerHTML = heading.innerHTML;
    Array.from(heading.attributes).forEach(attr => {
      if (attr.name !== 'class') {
        h1.setAttribute(attr.name, attr.value);
      }
    });
    heading.replaceWith(h1);
  });

  const restoredContent = articleDoc.body.innerHTML;
  const cleanHtml = sanitizeHtml(restoredContent, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol',
      'li', 'b', 'i', 'strong', 'em', 'code', 'pre',
      'div', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'blockquote', 'br'
    ],
    allowedAttributes: {
      'a': ['href'],
      'pre': ['class', 'data-language'],
      'code': ['class', 'data-language'],
      'div': ['class'],
      'span': ['class']
    }
  });

  const turndownService = configureTurndownService();
  let markdown = turndownService.turndown(cleanHtml);

  const pageTitle = extractedH1s[0] || article.title?.trim() || '';
  if (pageTitle) {
    const normalizedTitle = pageTitle.replace(/\s+/g, ' ');
    const markdownFirstLine = markdown.trimStart().split('\n')[0] || '';
    const existingH1Match = markdownFirstLine.match(/^#\s+(.+)$/);
  const existingH1Text = existingH1Match?.[1]
    ? existingH1Match[1].replace(/\s+/g, ' ').trim()
    : '';

    if (!existingH1Match || existingH1Text !== normalizedTitle) {
      markdown = `# ${pageTitle}\n\n${markdown}`;
    }
  }

  const linkSection = sameDomainLinks?.length
    ? buildSameDomainLinksSectionFromList(sameDomainLinks, baseUrl)
    : buildSameDomainLinksSection(document, baseUrl);
  if (linkSection) {
    markdown = `${markdown}\n\n${linkSection}`;
  }

  return markdown;
}

function buildSameDomainLinksSection(document: Document, baseUrl?: string): string {
  const links = collectSameDomainLinks(document, baseUrl);
  if (links.length === 0) {
    return '';
  }

  const lines = links.map(link => `- ${link}`);
  return `## Links\n\n${lines.join('\n')}`;
}

function buildSameDomainLinksSectionFromList(
  links: string[],
  baseUrl?: string
): string {
  const normalized = normalizeSameDomainLinks(links, baseUrl);
  if (normalized.length === 0) {
    return '';
  }

  const lines = normalized.map(link => `- ${link}`);
  return `## Links\n\n${lines.join('\n')}`;
}

function normalizeSameDomainLinks(links: string[], baseUrl?: string): string[] {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, undefined);
  const baseHost = normalizedBaseUrl ? safeHostname(normalizedBaseUrl) : '';
  const targetHost = baseHost || mostCommonHost(links.map(link => safeHostname(link)));
  if (!targetHost) {
    return [];
  }

  const baseCanonical = normalizedBaseUrl
    ? stripHashAndTrailingSlash(normalizedBaseUrl)
    : '';
  const seen = new Set<string>();
  const results: string[] = [];

  for (const link of links) {
    if (!isAbsoluteHttpUrl(link)) {
      continue;
    }

    const host = safeHostname(link);
    if (host !== targetHost) {
      continue;
    }

    const canonical = stripHashAndTrailingSlash(link);
    if (canonical === baseCanonical) {
      continue;
    }

    if (seen.has(canonical)) {
      continue;
    }

    seen.add(canonical);
    results.push(link);
  }

  return results;
}

function collectSameDomainLinks(document: Document, baseUrl?: string): string[] {
  const rawLinks = Array.from(document.querySelectorAll('a[href]'))
    .map(anchor => anchor.getAttribute('href')?.trim())
    .filter((href): href is string => Boolean(href));

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, document.baseURI);
  const baseHost = normalizedBaseUrl ? safeHostname(normalizedBaseUrl) : '';
  const resolved: Array<{ href: string; canonical: string; host: string }> = [];
  for (const href of rawLinks) {
    if (isSkippableHref(href)) {
      continue;
    }

    const resolvedUrl = resolveHref(href, normalizedBaseUrl);
    if (!resolvedUrl) {
      continue;
    }

    resolved.push({
      href: resolvedUrl.href,
      canonical: resolvedUrl.canonical,
      host: resolvedUrl.host,
    });
  }

  const targetHost = baseHost || mostCommonHost(resolved.map(item => item.host));
  if (!targetHost) {
    return [];
  }

  const baseCanonical = normalizedBaseUrl
    ? stripHashAndTrailingSlash(normalizedBaseUrl)
    : '';
  const seen = new Set<string>();
  const results: string[] = [];

  for (const item of resolved) {
    if (item.host !== targetHost) {
      continue;
    }

    if (item.canonical === baseCanonical) {
      continue;
    }

    if (seen.has(item.canonical)) {
      continue;
    }

    seen.add(item.canonical);
    results.push(item.href);
  }

  return results;
}

function normalizeBaseUrl(baseUrl?: string, documentBaseUri?: string): string | undefined {
  if (baseUrl) {
    return baseUrl;
  }

  if (documentBaseUri && documentBaseUri !== 'about:blank') {
    return documentBaseUri;
  }

  return undefined;
}

function resolveHref(
  href: string,
  baseUrl: string | undefined
): { href: string; canonical: string; host: string } | undefined {
  try {
    const shouldResolve = Boolean(baseUrl) || isAbsoluteHttpUrl(href);
    if (!shouldResolve) {
      return undefined;
    }

    const url = new URL(href, baseUrl);

    if (!url.protocol.startsWith('http')) {
      return undefined;
    }

    const canonical = stripHashAndTrailingSlash(url.toString());
    return { href: url.toString(), canonical, host: url.hostname };
  } catch {
    return undefined;
  }
}

function isSkippableHref(href: string): boolean {
  const lowerHref = href.toLowerCase();
  return (
    lowerHref.startsWith('#') ||
    lowerHref.startsWith('mailto:') ||
    lowerHref.startsWith('tel:') ||
    lowerHref.startsWith('javascript:')
  );
}

function isAbsoluteHttpUrl(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://');
}

function safeHostname(urlString: string): string {
  try {
    return new URL(urlString).hostname;
  } catch {
    return '';
  }
}

function stripHashAndTrailingSlash(urlString: string): string {
  try {
    const url = new URL(urlString);
    url.hash = '';
    const normalized = url.toString();
    return normalized.endsWith('/')
      ? normalized.slice(0, -1)
      : normalized;
  } catch {
    return urlString;
  }
}

function mostCommonHost(hosts: string[]): string {
  const counts = new Map<string, number>();
  for (const host of hosts) {
    if (!host) {
      continue;
    }
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }

  let topHost = '';
  let topCount = 0;
  for (const [host, count] of counts.entries()) {
    if (count > topCount) {
      topHost = host;
      topCount = count;
    }
  }

  return topHost;
}
