import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
dotenv.config();

const apifyClient = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

async function testGoogleFb() {
  const query = "cholil nafis";
  const platform = { key: "facebook", name: "Facebook", querySuffix: " site:facebook.com" };
  const dateFromStr = "2026-03-15";
  const dateToStr = "2026-03-22";

  console.log('Running Google Search for:', `${query}${platform.querySuffix}`);
  const run = await apifyClient
    .actor("apify/google-search-scraper")
    .call({
      afterDate: dateFromStr,
      beforeDate: dateToStr,
      chatGptSearch: { enableChatGpt: false },
      countryCode: "id",
      disableGoogleSearchResults: false,
      focusOnPaidAds: false,
      forceExactMatch: false,
      includeIcons: false,
      includeUnfilteredResults: false,
      maxPagesPerQuery: 1,
      resultsPerPage: 20,
      queries: `${query}${platform.querySuffix}`,
      saveHtml: false,
      saveHtmlToKeyValueStore: false,
      searchLanguage: "id"
    });

  const { items } = await apifyClient
    .dataset(run.defaultDatasetId)
    .listItems();

  const searchItems = items as any[];
  let rawResults: any[] = [];
  if (searchItems.length > 0) {
    rawResults = searchItems[0].organicResults || [];
  }

  const topResults = rawResults.slice(0, 5).map((res: any) => ({
    title: res.title,
    link: res.url,
  }));

  console.log('Top 5 Google Search Results:');
  console.log(JSON.stringify(topResults, null, 2));
}

testGoogleFb();
