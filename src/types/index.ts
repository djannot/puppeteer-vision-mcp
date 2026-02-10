import { Page, ElementHandle } from 'puppeteer';

// AI action recommendation types
export interface AIAction {
  action: 'click' | 'scroll' | 'type' | 'wait' | 'none';
  targetText?: string;
  targetSelector?: string;
  inputText?: string;
  scrollAmount?: number;
  waitTime?: number;
  reason?: string;
}

// Scraper options
export interface WebpageScrapeOptions {
  url: string;
  autoInteract?: boolean;
  maxInteractionAttempts?: number;
  waitForNetworkIdle?: boolean;
  includeSameDomainLinks?: boolean;
}

// Scraper result
export interface ScrapeResult {
  data?: string;
  error?: { message: string };
}

// MCP tool response - updated to match MCP SDK expectations
export interface ToolResponse {
  content: { 
    type: "text"; 
    text: string;
  }[];
  metadata?: {
    message: string;
    success: boolean;
    contentSize?: number;
  };
  isError?: boolean;
}
