import { ApifyClient } from "apify-client";
import { TwitterTweetItem } from "./sna.types";

const apifyClient = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

export class SnaCollector {
  /**
   * Scrape tweets based on keyword or direct URL
   */
  async collect(query: string, limit = 100): Promise<TwitterTweetItem[]> {
    console.log(`[SNA] Starting collection for query: ${query}, limit: ${limit}`);
    
    const isUrl = query.startsWith('http');
    let input: any = {};

    if (isUrl) {
      input = {
        startUrls: [{ url: query }],
        maxItems: 1 // If searching for a single tweet's context, though usually we want surrounding discourse
      };
    } else {
      // Calculate 7 days ago and today
      const now = new Date();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(now.getDate() - 7);

      const formatDate = (date: Date) => date.toISOString().split('T')[0];
      
      const startDate = formatDate(sevenDaysAgo);
      const endDate = formatDate(now);

      input = {
        searchTerms: [query],
        maxItems: limit,
        sort: "Latest",
        tweetLanguage: "id",
        start: startDate, // User requested key
        end: endDate,     // User requested key
        since: startDate, // Common Apify key
        until: endDate    // Common Apify key
      };
    }

    try {
      // Using apidojo/tweet-scraper which is robust for SNA
      const run = await apifyClient.actor("apidojo/tweet-scraper").call(input);
      const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
      
      console.log(`[SNA] Collected ${items.length} items from Apify`);
      return items as unknown as TwitterTweetItem[];
    } catch (error) {
      console.error("[SNA] Apify Collection Error:", error);
      throw new Error("Gagal mengambil data dari X/Twitter via Apify");
    }
  }
}
