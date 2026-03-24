import 'dotenv/config';
import { SnaService } from './src/modules/sna/sna.service';

async function test() {
  const service = new SnaService();
  const keyword = "cholil nafis haram";
  console.log(`Testing SNA for: ${keyword}`);
  
  try {
    const items = await (service as any).collector.collect(keyword, 1);
    const item = items[0];
    console.log("ITEM KEYS:", Object.keys(item));
    console.log("IN_REPLY_TO_USER:", item.inReplyToUserName || item.inReplyToUserId);
    console.log("RETWEETED_STATUS_AUTHOR:", item.retweetedStatus?.author?.userName);
    console.log("QUOTED_STATUS_AUTHOR:", item.quotedStatus?.author?.userName);
    console.log("MENTIONS:", item.entities?.user_mentions?.map((m: any) => m.screen_name));
    
    // const result = await service.runAnalysis(keyword, 5);
  } catch (error: any) {
    console.error("FAILURE:", error.message);
    if (error.stack) console.error(error.stack);
  } finally {
    process.exit();
  }
}

test();
