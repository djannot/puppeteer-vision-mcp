import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { visitWebPage } from '../scrapers/webpage-scraper.js';
import { ScrapeResult } from '../types/index.js';

/**
 * Registers MCP tools with the server
 * @param server The MCP server instance
 */
export function registerTools(server: McpServer): void {
  server.tool(
    "scrape-webpage",
    "Scrapes a webpage and converts it to markdown format",
    {
      url: z.string().url().describe("The URL of the webpage to scrape"),
      autoInteract: z.boolean().optional().default(true).describe("Whether to automatically handle interactive elements like cookies, captchas, etc."),
      maxInteractionAttempts: z.number().int().min(0).max(10).optional().default(3).describe("Maximum number of interaction attempts"),
      waitForNetworkIdle: z.boolean().optional().default(true).describe("Whether to wait for network to be idle before processing"),
      includeSameDomainLinks: z.boolean().optional().default(false).describe("Whether to append a list of same-domain links to the markdown output")
    },
    async ({
      url,
      autoInteract,
      maxInteractionAttempts,
      waitForNetworkIdle,
      includeSameDomainLinks,
    }, _extra) => {
      console.log(`Received scrape request for URL: ${url}, autoInteract: ${autoInteract}, maxAttempts: ${maxInteractionAttempts}`);

      try {
        const result = await visitWebPage({ 
          url, 
          autoInteract, 
          maxInteractionAttempts,
          waitForNetworkIdle,
          includeSameDomainLinks
        });

        if (result.error) {
          return createErrorResponse(result.error.message);
        }

        // Limit the size of returned content if too large
        const maxLength = 100000; // Set a reasonable limit
        let markdownContent = result.data || "";
        let message = "Scraping successful";
        
        if (markdownContent.length > maxLength) {
          markdownContent = markdownContent.substring(0, maxLength);
          message = `Content truncated due to size (total size: ${markdownContent.length} characters)`;
        }
        
        console.log(`Scraping successful. Payload size: ${markdownContent.length} chars.`);

        return createSuccessResponse(markdownContent, message);
      } catch (error: any) {
        console.error("Error processing 'scrape-webpage' tool:", error);
        return createErrorResponse(`Error scraping webpage: ${error.message}`);
      }
    }
  );
}

/**
 * Creates a success response for the MCP tool
 * @param text The markdown text content
 * @param message An optional message to include
 * @returns The formatted tool response
 */
function createSuccessResponse(text: string, message: string = "Scraping successful") {
  return {
    content: [{ type: "text" as const, text }],
    _meta: {
      message,
      success: true,
      contentSize: text.length
    },
    isError: false
  };
}

/**
 * Creates an error response for the MCP tool
 * @param message The error message
 * @returns The formatted tool response
 */
function createErrorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: "" }],
    _meta: {
      message: message,
      success: false
    },
    isError: true
  };
}
