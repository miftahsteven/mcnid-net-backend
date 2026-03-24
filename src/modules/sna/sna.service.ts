import { prisma } from "../../lib/prisma";
import { SnaCollector } from "./sna.collector";
import { SnaGraphBuilder } from "./sna.graph";
import { TwitterTweetItem } from "./sna.types";

export class SnaService {
  private collector: SnaCollector;
  
  constructor() {
    this.collector = new SnaCollector();
  }

  /**
   * Run full SNA pipeline: Scrape -> Graph -> Save
   */
  async runAnalysis(keyword: string, limit = 500) {
    console.log(`[SNA Service] Running analysis for keyword: ${keyword}`);
    
    // 1. Initial Broad Search
    // We take a smaller batch initially to identify influencers
    const initialBatch = await this.collector.collect(keyword, Math.min(limit, 200));
    
    if (!initialBatch || initialBatch.length === 0) {
      throw new Error(`Tidak ditemukan tweet untuk keyword "${keyword}". Silakan coba keyword lain.`);
    }

    // 2. Identify Top Viral Tweets for Deep Scrape (Spread Detection)
    // Sort by engagement to find the most "sharable" content
    const topViralTweets = [...initialBatch]
      .sort((a, b) => ((b as any).retweetCount || 0) + ((b as any).replyCount || 0) - (((a as any).retweetCount || 0) + ((a as any).replyCount || 0)))
      .slice(0, 5); // Take top 5 conversations

    console.log(`[SNA] Identified ${topViralTweets.length} viral tweets for spread analysis.`);

    // 3. Deep Scrape: Fetch Conversations for Top Tweets
    const conversationBatches = await Promise.all(
      topViralTweets.map(tweet => {
        // Search by conversation_id to get all replies
        if ((tweet as any).conversationId) {
          return this.collector.collect(`conversation_id:${(tweet as any).conversationId}`, 100);
        }
        return Promise.resolve([]);
      })
    );

    // Merge all items
    const allItems = [...initialBatch];
    conversationBatches.forEach(batch => allItems.push(...batch));

    // Remove duplicates by ID
    const uniqueItems = Array.from(new Map(allItems.map(item => [item.id, item])).values());
    
    console.log(`[SNA] Total unique items after deep scrape: ${uniqueItems.length}`);
    
    // 4. Build and Analyze Graph
    const graphBuilder = new SnaGraphBuilder();
    graphBuilder.build(uniqueItems);
    const analytics = graphBuilder.analyze();
    const graphData = graphBuilder.getGraphData();

    // 3. Save to Database (Main Result)
    const result = await prisma.snaResult.create({
      data: {
        keyword,
        totalNodes: graphData.nodes.length,
        totalEdges: graphData.edges.length,
        graphData: graphData as any,
        analytics: analytics as any,
      }
    });

    // 4. Batch insert users, tweets, and interactions (Async)
    this.saveDetailedData(result.id, uniqueItems).catch(err => {
      console.error("[SNA] Background Data Saving Error:", err);
    });

    return {
      id: result.id,
      keyword: result.keyword,
      nodes: graphData.nodes.length,
      edges: graphData.edges.length,
      topInfluencers: analytics.topInfluencers,
      mainClusters: analytics.mainClusters,
    };
  }

  private async saveDetailedData(resultId: string, items: TwitterTweetItem[]) {
    const usersMap = new Map();
    
    // Helper to add user to map
    const addUser = (user: any) => {
      if (user?.userName || user?.id) {
        const id = user.id || user.userName;
        if (!usersMap.has(id)) {
          usersMap.set(id, {
            id,
            username: user.userName || user.id,
            followers: user.followersCount || 0
          });
        }
      }
    };

    items.forEach(item => {
      // Source
      addUser(item.author);

      // Interactions
      if (item.retweetedStatus?.author) addUser(item.retweetedStatus.author);
      if (item.quotedStatus?.author) addUser(item.quotedStatus.author);
      if (item.entities?.user_mentions) {
        item.entities.user_mentions.forEach(m => {
          if (m.screen_name) {
             if (!usersMap.has(m.screen_name)) {
               usersMap.set(m.screen_name, { id: m.screen_name, username: m.screen_name, followers: 0 });
             }
          }
        });
      }
      if (item.inReplyToUserName) {
        if (!usersMap.has(item.inReplyToUserName)) {
           usersMap.set(item.inReplyToUserName, { id: item.inReplyToUserName, username: item.inReplyToUserName, followers: 0 });
        }
      }
    });

    // Upsert all users
    const userPromises = Array.from(usersMap.values()).map(user => 
      prisma.snaUserNode.upsert({
        where: { id: user.id },
        update: { followers: user.followers, username: user.username },
        create: user
      })
    );
    await Promise.all(userPromises);

    // Save tweets
    const tweetData = items
      .filter(item => item.id && item.author?.userName)
      .map(item => ({
        id: item.id,
        text: item.text || "",
        createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
        userId: item.author.userName,
        snaResultId: resultId
      }));
      
    if (tweetData.length > 0) {
      await prisma.snaTweet.createMany({ data: tweetData, skipDuplicates: true });
    }

    // Save interactions
    const interactions: any[] = [];
    items.forEach(item => {
      const sourceId = item.author?.userName;
      if (!sourceId) return;

      const addInt = (targetId: string, type: string) => {
        if (targetId && targetId !== sourceId) {
          interactions.push({
            sourceUserId: sourceId,
            targetUserId: targetId,
            type,
            tweetId: item.id,
            snaResultId: resultId
          });
        }
      };

      if (item.retweetedStatus?.author?.userName) addInt(item.retweetedStatus.author.userName, "retweet");
      if (item.quotedStatus?.author?.userName) addInt(item.quotedStatus.author.userName, "quote");
      if (item.inReplyToUserName) addInt(item.inReplyToUserName, "reply");
      if (item.entities?.user_mentions) {
        item.entities.user_mentions.forEach(m => addInt(m.screen_name, "mention"));
      }
    });

    if (interactions.length > 0) {
      await prisma.snaInteraction.createMany({ data: interactions });
    }
  }

  async getResult(id: string) {
    return prisma.snaResult.findUnique({
      where: { id },
      include: {
        tweets: { take: 10 },
        interactions: { take: 10 }
      }
    });
  }

  async listResults() {
    return prisma.snaResult.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        keyword: true,
        totalNodes: true,
        totalEdges: true,
        createdAt: true,
        analytics: true
      }
    });
  }
}
