import puppeteerExtraImport from 'puppeteer-extra';
import StealthPluginImport from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

import { handlePageInteractions } from '../ai/page-interactions.js';
import { processHtmlContent } from './content-processor.js';
import { ScrapeResult, WebpageScrapeOptions } from '../types/index.js';
import { config } from '../config.js';

// Work around TypeScript issues with puppeteer-extra
const puppeteerExtra = puppeteerExtraImport as any;
const StealthPlugin = StealthPluginImport as any;

// Apply stealth plugin
puppeteerExtra.use(StealthPlugin());

/**
 * Visits a webpage, handles interactions, and extracts content
 * @param options Configuration options for the scraping operation
 * @returns Markdown content or error message
 */
export async function visitWebPage({
  url,
  autoInteract = true,
  maxInteractionAttempts = 3,
  waitForNetworkIdle = true,
  includeSameDomainLinks = false,
}: WebpageScrapeOptions): Promise<ScrapeResult> {
  // Launch puppeteer with stealth plugin and respect headless configuration
  const browser = await puppeteerExtra.launch({
    headless: config.headless ? "new" : false, // Use config.headless setting
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  
  try {
    console.log(`Visiting webpage: ${url}`);
    const page = await browser.newPage();
    
    // Set viewport to a standard desktop size
    await page.setViewport({ width: 1280, height: 800 });
    
    // Navigate to the URL
    await page.goto(url, { 
      waitUntil: waitForNetworkIdle ? 'networkidle2' : 'domcontentloaded' 
    });
    
    // Allow initial page load to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Handle page interactions if enabled
    if (autoInteract) {
      console.log("Checking for interactive elements that need handling...");
      await handlePageInteractions(page, maxInteractionAttempts);
    }
    
    // Extract content after handling interactions
    const { htmlContent, sameDomainLinks } = await page.evaluate((shouldCollectLinks: boolean) => {
      const pageUrl = window.location.href;
      const pageHost = window.location.hostname;
      let sameDomainLinks: string[] = [];
      if (shouldCollectLinks) {
        const links = Array.from(document.querySelectorAll('a[href]'))
          .map(anchor => anchor.getAttribute('href')?.trim())
          .filter((href): href is string => Boolean(href));

        sameDomainLinks = links
          .filter(href => {
            const lowerHref = href.toLowerCase();
            return !(
              lowerHref.startsWith('#') ||
              lowerHref.startsWith('mailto:') ||
              lowerHref.startsWith('tel:') ||
              lowerHref.startsWith('javascript:')
            );
          })
          .map(href => {
            try {
              const url = new URL(href, pageUrl);
              if (url.protocol.startsWith('http') && url.hostname === pageHost) {
                return url.toString();
              }
              return null;
            } catch {
              return null;
            }
          })
          .filter((href): href is string => Boolean(href));
      }

      const main = document.querySelector('main') ||
        document.querySelector('article') ||
        document.querySelector('.content') ||
        document.querySelector('#content') ||
        document.body;

      return {
        htmlContent: main.innerHTML,
        sameDomainLinks,
      };
    }, includeSameDomainLinks);

    // Process the HTML content
    const markdown = await processHtmlContent(
      htmlContent,
      url,
      includeSameDomainLinks ? sameDomainLinks : undefined
    );
    
    await browser.close();
    console.log(`Successfully scraped and converted to markdown: ${url}`);
    
    return { data: markdown };
  }
  catch(error) {
    await browser.close();
    if (error instanceof Error) {
      console.error(`Error scraping ${url}:`, error.message);
      return {
        error: {
          message: error.message,
        },
      };
    } else {
      console.error(`Unknown error scraping ${url}`);
      return {
        error: {
          message: "An unknown error occurred",
        },
      };
    }
  }
}
