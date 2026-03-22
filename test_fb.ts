import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
dotenv.config();

const apifyClient = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

async function testFb() {
  const actorId = "apify/facebook-comments-scraper";
  const url = "https://web.facebook.com/wartadidesa/posts/pengumuman-lebaran-di-luar-pemerintah-haram-cholil-nafis-klarifikasi-dan-minta-m/1528343539301955/?_rdc=1&_rdr#";
  const dateFromStr = "2026-03-15"; // 1 week ago

  let fbUrl = url.replace("web.facebook.com", "www.facebook.com");
  const urlObj = new URL(fbUrl);
  urlObj.searchParams.delete("_rdc");
  urlObj.searchParams.delete("_rdr");
  fbUrl = urlObj.toString();

  const input = { 
    includeNestedComments: true,
    onlyCommentsNewerThan: dateFromStr,
    resultsLimit: 50,
    startUrls: [{ url: fbUrl }],
    viewOption: "RECENT_ACTIVITY"
  };

  console.log(`[Apify] Calling ${actorId} with input:`, JSON.stringify(input, null, 2));
  
  try {
    const run = await apifyClient.actor(actorId).call(input);
    console.log(`[Apify] ${actorId} finished. runId: ${run.id}. defaultDatasetId: ${run.defaultDatasetId}`);
    
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    console.log(`[Apify] ${actorId} fetched ${items.length} items from dataset.`);
    
    if (items.length > 0) {
      console.log('Sample item:', JSON.stringify(items[0], null, 2).substring(0, 500));
    }

    const comments = (items as any[]).map(item => item.text || item.comment || item.full_text || "").filter(Boolean).slice(0, 20);
    console.log(`[Apify] Extracted ${comments.length} comments.`);
    if (comments.length > 0) {
      console.log('Sample comment text:', comments[0]);
    }
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

testFb();
