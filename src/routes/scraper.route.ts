import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ApifyClient } from "apify-client";
import OpenAI from "openai";
import { prisma } from "../lib/prisma";
import { authMiddleware, requireRole } from "../middlewares/auth.middleware";
import fs from "fs";
import path from "path";

interface ApifyNewsItem {
  title: string;
  source: string;
  sourceUrl: string;
  publishedAt: string | null;
  link: string;
  image: string | null;
  text?: string;
}

// Initialize clients
const apifyClient = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const allowedSources = [
  "kompas.com",
  "detik.com",
  "tempo.co",
  "cnnindonesia.com",
  "republika.co.id",
  "antaranews.com",
  "viva.co.id",
  "suara.com",
  "merdeka.com",
  "liputan6.com",
  "tribunnews.com",
  "mui.or.id",
  "nu.or.id",
];

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function getYoutubeCover(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/[?&]v=([^&]+)/);
  if (match) return `https://img.youtube.com/vi/${match[1]}/maxresdefault.jpg`;

  const shortMatch = url.match(/youtu\.be\/([^?]+)/);
  if (shortMatch)
    return `https://img.youtube.com/vi/${shortMatch[1]}/maxresdefault.jpg`;

  return null;
}

async function getCommentsForUrl(
  url: string,
  platformKey: string,
  dateFromStr?: string,
): Promise<{
  comments: any[];
  error?: string;
  stats?: { likes: number; retweets: number; replies: number };
  postUsername?: string;
  postIsVerified?: boolean;
  publishedAt?: string;
}> {
  try {
    let actorId = "";
    let input: any = {};

    switch (platformKey) {
      case "facebook":
        actorId = "apify/facebook-comments-scraper";
        let fbUrl = url;
        try {
          const u = new URL(url);
          if (
            u.hostname.endsWith("facebook.com") &&
            u.hostname !== "www.facebook.com"
          ) {
            u.hostname = "www.facebook.com";
          }
          fbUrl = u.toString();
        } catch (e) {}
        input = {
          startUrls: [{ url: fbUrl }],
          resultsLimit: 20,
          maxComments: 20,
        };
        break;
      case "instagram":
        actorId = "apify/instagram-comment-scraper";
        input = {
          directUrls: [url],
          includeNestedComments: true,
          isNewestComments: false,
          resultsLimit: 15,
        };
        break;
      case "x":
        actorId = "apidojo/tweet-scraper";
        input = {
          customMapFunction: "(object) => { return {...object} }",
          includeSearchTerms: false,
          maxItems: 20,
          onlyImage: false,
          onlyQuote: false,
          onlyTwitterBlue: false,
          onlyVerifiedUsers: false,
          onlyVideo: false,
          searchTerms: [],
          sort: "Latest",
          startUrls: [url],
          tweetLanguage: "id",
        };
        break;
      case "tiktok":
        actorId = "apidojo/tiktok-comments-scraper";
        input = {
          customMapFunction: "(object) => { return {...object} }",
          includeReplies: false,
          maxItems: 10,
          startUrls: [url],
        };
        break;
      case "threads":
        actorId = "apify/threads-scraper";
        input = { startUrls: [{ url }], maxItems: 20 };
        break;
      default:
        return { comments: [], error: "Scraping komentar tidak diizinkan" };
    }

    console.log(
      `[Apify] Calling ${actorId} with input:`,
      JSON.stringify(input),
    );
    const run = await apifyClient.actor(actorId).call(input);
    console.log(
      `[Apify] ${actorId} finished. runId: ${run.id}. defaultDatasetId: ${run.defaultDatasetId}`,
    );

    const { items } = await apifyClient
      .dataset(run.defaultDatasetId)
      .listItems();
    console.log(
      `[Apify] ${actorId} fetched ${items.length} items from dataset.`,
    );

    const comments = (items as any[])
      .map((item) => {
        const text =
          item.text || item.message || item.comment || item.full_text || "";
        if (!text) return null;
        let extUsername = "Unknown";
        if (typeof item.author === "string") extUsername = item.author;
        else if (item.author?.name) extUsername = item.author.name;
        else if (item.author?.userName) extUsername = item.author.userName;
        else if (item.author?.username) extUsername = item.author.username;
        else if (typeof item.ownerUsername === "string")
          extUsername = item.ownerUsername;
        else if (item.user?.screen_name) extUsername = item.user.screen_name;
        else if (item.user?.username) extUsername = item.user.username;

        let extIsVerified =
          item.isVerified ||
          item.user?.verified ||
          item.owner_is_verified ||
          item.author?.is_verified ||
          item.author?.isVerified ||
          item.author?.isBlueVerified ||
          false;

        let parsedLikes = 0;
        if (item.reaction_count !== undefined) {
          parsedLikes =
            typeof item.reaction_count === "string"
              ? parseInt(item.reaction_count, 10)
              : item.reaction_count;
        }

        return {
          text,
          username: extUsername,
          isVerified: extIsVerified,
          likes:
            parsedLikes ||
            item.likesCount ||
            item.favorite_count ||
            item.like_count ||
            0,
          profileUrl: item.author?.profile_url || item.user?.url || null,
          profileImageUrl:
            item.author?.profile_image_url ||
            item.user?.profile_image_url ||
            null,
        };
      })
      .filter(Boolean)
      .slice(0, 20);
    console.log(
      `[Apify] Extracted ${comments.length} comments for URL: ${url}`,
    );

    let stats, postUsername, postIsVerified, publishedAt;
    if (items.length > 0) {
      const mainItem = (items as any[]).find(i => 
         (i.url === url || i.twitterUrl === url || i.shortCode && url.includes(i.shortCode))
      ) || items[0];

      if (mainItem) {
        // Extract stats
        if (platformKey === "x") {
          stats = {
            likes: mainItem.likeCount || mainItem.favorite_count || 0,
            retweets: mainItem.retweetCount || mainItem.retweet_count || 0,
            replies: mainItem.replyCount || mainItem.reply_count || 0,
          };
          postIsVerified = mainItem.user?.verified || false;
          if (!postUsername && mainItem.user?.screen_name)
            postUsername = "@" + mainItem.user.screen_name;
          publishedAt = mainItem.created_at || mainItem.timestamp;
        } else if (platformKey === "instagram") {
          stats = {
             likes: mainItem.likesCount || 0,
             replies: mainItem.commentsCount || 0,
             retweets: 0
          };
          postUsername = mainItem.ownerUsername || mainItem.ownerFullName;
          publishedAt = mainItem.timestamp || mainItem.latestComments?.timestamp;
        } else if (platformKey === "facebook") {
           publishedAt = mainItem.date || mainItem.timestamp;
        } else if (platformKey === "tiktok") {
           publishedAt = mainItem.createTime;
        }
      }
    }

    return { comments: comments as any[], stats, postUsername, postIsVerified, publishedAt };
  } catch (error: any) {
    console.error(`[Apify Error on ${url}]:`, error?.message || error);
    return { comments: [], error: "Scraping komentar tidak diizinkan" };
  }
}

export async function scraperRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/run",
    {
      preHandler: [authMiddleware, requireRole("SUPER_ADMIN", "ADMIN")],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { query } = (request.body as { query?: string }) || {};
        const searchQuery = query?.trim() || "berita terkini islami";

        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - 8);
        const dateFromStr = dateFrom.toISOString().split("T")[0];

        const dateTo = new Date();
        const dateToStr = dateTo.toISOString().split("T")[0];

        // 1. Fetch from Apify using google-search-scraper
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
            maximumLeadsEnrichmentRecords: 0,
            mobileResults: false,
            perplexitySearch: {
              enablePerplexity: false,
              returnImages: false,
              returnRelatedQuestions: false,
            },
            queries: searchQuery,
            resultsPerPage: 100,
            saveHtml: false,
            saveHtmlToKeyValueStore: false,
            searchLanguage: "id",
          });

        const { items } = await apifyClient
          .dataset(run.defaultDatasetId)
          .listItems();

        const searchItems = items as any[];
        let rawNews: any[] = [];
        if (searchItems.length > 0 && searchItems[0].organicResults) {
          rawNews = searchItems[0].organicResults;
        }

        const newsItems: ApifyNewsItem[] = rawNews.map((res: any) => ({
          title: res.title,
          source:
            res.displayedUrl
              ?.split(" ")[0]
              ?.replace("https://", "")
              ?.replace("www.", "") || "Media",
          sourceUrl: res.url,
          publishedAt: res.date || null,
          link: res.url,
          image: null,
          text: res.description,
        }));

        // 2. Filter internal duplicates
        const seenTitles = new Set<string>();
        let filteredItems = newsItems.filter((item) => {
          if (!item.title || !item.sourceUrl) return false;

          // Hapus filter allowedSources agar bisa mengambil dari semua web

          // Internal Deduplicator
          if (seenTitles.has(item.title.toLowerCase())) return false;
          seenTitles.add(item.title.toLowerCase());
          return true;
        });

        // 3. Filter existing posts by title
        const titlesToScrape = filteredItems.map((item) => item.title);
        const existingPosts = await prisma.post.findMany({
          where: { title: { in: titlesToScrape } },
          select: { title: true },
        });
        const existingTitles = new Set(existingPosts.map((p) => p.title));

        filteredItems = filteredItems.filter(
          (item) => !existingTitles.has(item.title),
        );

        // Limit to 10 processing per run to save OpenAI token & time, even though Apify gave max 10
        filteredItems = filteredItems.slice(0, 10);

        if (filteredItems.length < 2) {
          return reply.status(200).send({
            message: `Hanya menemukan ${filteredItems.length} berita baru. Dibutuhkan minimal 2 berita baru per penarikan.`,
            processed: 0,
          });
        }

        const savedPosts = [];

        // 4. Process with OpenAI and Save
        for (const item of filteredItems) {
          try {
            const promptContext = item.text
              ? `\n\nIsi Berita Asli:\n${item.text.substring(0, 1500)}...`
              : "";

            const completion = await openai.chat.completions.create({
              //model: "gpt-4o-mini",
              model: "gpt-4o",
              //model: "gpt-5.2",
              messages: [
                {
                  role: "system",
                  content:
                    "Anda adalah seorang penulis dan editor berita profesional Islami. Tugas Anda adalah mengembangkan informasi singkat menjadi artikel utuh format HTML (menggunakan tag <p>, <h2>, <ul>, dsb tanpa ```html wrapper) dan memberikan excerpt (ringkasan 2 kalimat) dalam format JSON.",
                },
                {
                  role: "user",
                  content: `Buatkan artikel berita/konten utuh berdasarkan keyword pencarian "${searchQuery}" dari metadata berikut:\n\nJudul: ${item.title}\nSumber: ${item.source}\nLink Referensi: ${item.link}${promptContext}\n\nBerikan response HANYA DALAM BENTUK JSON yang valid persis dengan struktur berikut:\n{\n  "content": "string html artikel lengkap (minimal 3 paragraf)",\n  "excerpt": "string ringkasan singkat maksimal 250 karakter"\n}`,
                },
              ],
              response_format: { type: "json_object" },
            });

            const aiResponse = JSON.parse(
              completion.choices[0].message.content || "{}",
            );

            if (aiResponse.content && aiResponse.excerpt) {
              const slug =
                generateSlug(item.title) +
                "-" +
                Date.now().toString().slice(-4);

              const newPost = await prisma.post.create({
                data: {
                  title: item.title,
                  slug: slug,
                  content:
                    aiResponse.content +
                    `\n<p><br><em>Sumber: <a href="${item.link}" target="_blank">${item.source}</a></em></p>`,
                  excerpt: aiResponse.excerpt,
                  coverImage: item.image || null,
                  status: "DRAFT",
                  type: "NEWS",
                  authorId: (request as any).user.sub,
                  publishedAt: item.publishedAt
                    ? new Date(item.publishedAt)
                    : new Date(),
                  seoTitle: item.title.substring(0, 60),
                  seoDesc: aiResponse.excerpt.substring(0, 150),
                },
              });
              savedPosts.push(newPost.id);
            }
          } catch (err) {
            console.error(`Error processing item ${item.title}:`, err);
            // continue with next item
          }
        }

        return reply.status(200).send({
          message: `Successfully processed and saved ${savedPosts.length} new articles.`,
          savedIds: savedPosts,
        });
      } catch (error: any) {
        console.error("Scraper Error:", error);
        return reply.status(500).send({
          error: "Failed to run news scraper",
          message: error.message,
        });
      }
    },
  );

  fastify.post(
    "/play-run",
    {
      preHandler: [authMiddleware, requireRole("SUPER_ADMIN", "ADMIN")],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { query } = (request.body as { query?: string }) || {};
        const searchQuery = query?.trim() || "berita terkini islami";
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - 8);
        const dateFromStr = dateFrom.toISOString().split("T")[0];

        const dateTo = new Date();
        const dateToStr = dateTo.toISOString().split("T")[0];

        // 1. Fetch from Apify using google-search-scraper
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
            maximumLeadsEnrichmentRecords: 0,
            mobileResults: false,
            perplexitySearch: {
              enablePerplexity: false,
              returnImages: false,
              returnRelatedQuestions: false,
            },
            queries: `${searchQuery} site:youtube.com`,
            resultsPerPage: 100,
            saveHtml: false,
            saveHtmlToKeyValueStore: false,
            searchLanguage: "id",
          });

        const { items } = await apifyClient
          .dataset(run.defaultDatasetId)
          .listItems();

        const searchItems = items as any[];
        let rawNews: any[] = [];
        if (searchItems.length > 0 && searchItems[0].organicResults) {
          rawNews = searchItems[0].organicResults;
        }

        const newsItems: ApifyNewsItem[] = rawNews.map((res: any) => ({
          title: res.title,
          source:
            res.displayedUrl
              ?.split(" ")[0]
              ?.replace("https://", "")
              ?.replace("www.", "") || "YouTube",
          sourceUrl: res.url,
          publishedAt: res.date || null,
          link: res.url,
          image: null,
          text: res.description,
        }));

        // 2. Filter internal duplicates
        const seenUrls = new Set<string>();
        let filteredItems = newsItems.filter((item) => {
          if (!item.title || !item.sourceUrl) return false;

          // Internal Deduplicator
          if (seenUrls.has(item.link)) return false;
          seenUrls.add(item.link);
          return true;
        });

        // 3. Filter existing videos by url
        const urlsToScrape = filteredItems.map((item) => item.link);
        const existingVideos = await prisma.video.findMany({
          where: { videoUrl: { in: urlsToScrape } },
          select: { videoUrl: true },
        });
        const existingUrls = new Set(existingVideos.map((p) => p.videoUrl));

        filteredItems = filteredItems.filter(
          (item) => !existingUrls.has(item.link),
        );

        // Limit to 10 processing per run
        filteredItems = filteredItems.slice(0, 10);

        if (filteredItems.length < 2) {
          return reply.status(200).send({
            message: `Hanya menemukan ${filteredItems.length} video baru. Dibutuhkan minimal 2 video baru per penarikan.`,
            processed: 0,
          });
        }

        const savedVideos = [];

        // 4. Process with OpenAI and Save
        for (const item of filteredItems) {
          try {
            const promptContext = item.text
              ? `\n\nIsi Deskripsi Asli:\n${item.text.substring(0, 1500)}...`
              : "";

            const completion = await openai.chat.completions.create({
              model: "gpt-4o",
              //model: "gpt-5.2",
              messages: [
                {
                  role: "system",
                  content:
                    "Anda adalah seorang penulis dan editor konten video Islami pelengkap presentasi. Tugas Anda adalah mengembangkan informasi metadata video YouTube menjadi deskripsi yang utuh dan menarik dalam format HTML (menggunakan tag <p>, <ul>, dsb tanpa ```html wrapper) dalam format JSON.",
                },
                {
                  role: "user",
                  content: `Buatkan deskripsi video YouTube yang berkaitan dengan topik/keyword "${searchQuery}" dari metadata berikut:\n\nJudul: ${item.title}\nSumber: ${item.source}\nLink Referensi: ${item.link}${promptContext}\n\nBerikan response HANYA DALAM BENTUK JSON yang valid persis dengan struktur berikut:\n{\n  "description": "string html deskripsi lengkap video"\n}`,
                },
              ],
              response_format: { type: "json_object" },
            });

            const aiResponse = JSON.parse(
              completion.choices[0].message.content || "{}",
            );

            if (aiResponse.description) {
              const slug =
                generateSlug(item.title) +
                "-" +
                Date.now().toString().slice(-4);

              const newVideo = await prisma.video.create({
                data: {
                  title: item.title,
                  slug: slug,
                  description:
                    aiResponse.description +
                    `\n<p><br><em>Sumber YouTube: <a href="${item.link}" target="_blank">Lihat Video Asli</a></em></p>`,
                  videoUrl: item.link,
                  coverImage: getYoutubeCover(item.link),
                  status: "DRAFT",
                  sourceType: "YOUTUBE",
                  authorId: (request as any).user.sub,
                  publishedAt: item.publishedAt
                    ? new Date(item.publishedAt)
                    : new Date(),
                },
              });
              savedVideos.push(newVideo.id);
            }
          } catch (err) {
            console.error(`Error processing video ${item.title}:`, err);
            // continue with next item
          }
        }

        return reply.status(200).send({
          message: `Successfully processed and saved ${savedVideos.length} new videos.`,
          savedIds: savedVideos,
        });
      } catch (error: any) {
        console.error("Scraper Error:", error);
        return reply.status(500).send({
          error: "Failed to run youtube scraper",
          message: error.message,
        });
      }
    },
  );

  fastify.post(
    "/monitor",
    {
      preHandler: [authMiddleware, requireRole("SUPER_ADMIN", "ADMIN")],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { query, forceRegenerate = false, dateFrom = "", dateTo = "" } = request.body as {
          query: string;
          forceRegenerate?: boolean;
          dateFrom?: string;
          dateTo?: string;
        };
        if (!query) {
          return reply.status(400).send({ error: "Missing query" });
        }

        let dateFromStr = dateFrom;
        if (!dateFromStr) {
          const df = new Date();
          df.setDate(df.getDate() - 7);
          dateFromStr = df.toISOString().split("T")[0];
        }

        let dateToStr = dateTo;
        if (!dateToStr) {
          const dt = new Date();
          dateToStr = dt.toISOString().split("T")[0];
        }

        // CHECK CACHE
        if (!forceRegenerate) {
          const cached = await prisma.mediaMonitoringCache.findUnique({
            where: {
              query_dateFrom_dateTo: {
                query,
                dateFrom: dateFromStr,
                dateTo: dateToStr,
              },
            },
          });

          if (cached) {
            console.log(
              `[Media Monitoring Cache] Returning cached results for query: "${query}"`,
            );
            return reply.send({ results: cached.resultsData });
          }
        }

        const platforms = [
          {
            key: "web",
            name: "Web (Semua Website)",
            querySuffix:
              " -site:facebook.com -site:twitter.com -site:x.com -site:instagram.com -site:tiktok.com -site:threads.net -site:youtube.com",
          },
          {
            key: "facebook",
            name: "Facebook",
            querySuffix: " site:facebook.com",
          },
          {
            key: "instagram",
            name: "Instagram",
            querySuffix: " site:instagram.com",
          },
          {
            key: "x",
            name: "X (Twitter)",
            querySuffix: " (site:twitter.com OR site:x.com)",
          },
          { key: "tiktok", name: "TikTok", querySuffix: " site:tiktok.com" },
          // { key: "threads", name: "Threads", querySuffix: " site:threads.net" },
        ];

        const monitoringResults = await Promise.all(
          platforms.map(async (platform) => {
            try {
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
                  resultsPerPage: 50,
                  queries: `${query}${platform.querySuffix}`,
                  saveHtml: false,
                  saveHtmlToKeyValueStore: false,
                  searchLanguage: "id",
                });

              const { items } = await apifyClient
                .dataset(run.defaultDatasetId)
                .listItems();

              const searchItems = items as any[];
              let rawResults: any[] = [];
              let totalCount = 0;

              if (searchItems.length > 0) {
                rawResults = searchItems[0].organicResults || [];
                totalCount =
                  searchItems[0].searchInformation?.totalResults ||
                  rawResults.length;
              }

              const topResults = rawResults.slice(0, 50).map((res: any) => {
                let mediaName = undefined;
                let mediaLogo = undefined;
                let postUsername = undefined;

                try {
                  const urlObj = new URL(res.url);
                  if (platform.key === "web") {
                    const host = urlObj.hostname.replace(/^www\./, "");
                    mediaName = host;
                    mediaLogo = `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
                  } else {
                    const pathParts = urlObj.pathname
                      .split("/")
                      .filter(Boolean);
                    if (platform.key === "x" && pathParts.length > 0) {
                      postUsername = "@" + pathParts[0];
                    } else if (
                      platform.key === "tiktok" &&
                      pathParts.length > 0 &&
                      pathParts[0].startsWith("@")
                    ) {
                      postUsername = pathParts[0];
                    } else if (
                      platform.key === "instagram" &&
                      pathParts[0] !== "p" &&
                      pathParts[0] !== "reel" &&
                      pathParts.length > 0
                    ) {
                      postUsername = "@" + pathParts[0];
                    } else if (
                      platform.key === "facebook" &&
                      pathParts[0] !== "groups" &&
                      pathParts[0] !== "watch" &&
                      pathParts[0] !== "story.php" &&
                      pathParts.length > 0
                    ) {
                      postUsername = pathParts[0];
                    }
                  }
                } catch (e) {}

                // Relevance Matching Logic
                const matchQuery = query.toLowerCase().replace(/["']/g, "");
                const titleLower = res.title?.toLowerCase() || "";
                const snippetLower = res.description?.toLowerCase() || "";
                let matchRelevance = "";
                
                const words = matchQuery.split(" ").filter(Boolean);
                const isExact = matchQuery && (titleLower.includes(matchQuery) || snippetLower.includes(matchQuery));
                
                if (isExact) {
                   matchRelevance = `Ada kata "${matchQuery}" di konten ini (Utuh)`;
                } else {
                   const foundWords = words.filter(w => titleLower.includes(w) || snippetLower.includes(w));
                   if (foundWords.length > 0) {
                      matchRelevance = `Ada kata ${foundWords.map(w => `"${w}"`).join(", ")} di konten ini`;
                   }
                }

                return {
                  title: res.title,
                  link: res.url,
                  snippet: res.description,
                  mediaName,
                  mediaLogo,
                  postUsername,
                  matchRelevance,
                  publishedAt: res.date || null,
                };
              });

              // --- UTILITY FOR BATCHING ---
              const runInBatches = async (items: any[], batchSize: number, processor: (item: any) => Promise<any>) => {
                const results = [];
                for (let i = 0; i < items.length; i += batchSize) {
                  const batch = items.slice(i, i + batchSize);
                  const batchResults = await Promise.all(batch.map(processor));
                  results.push(...batchResults);
                }
                return results;
              };

              // Sentiment analysis in batches for these top results using OpenAI
              const analyzedResults = await runInBatches(topResults, 5, async (item) => {
                  try {
                    // 1. Content Sentiment (Sharpened with "Marah")
                    const sentimentCompletion =
                      await openai.chat.completions.create({
                        model: "gpt-4o",
                        messages: [
                          {
                            role: "system",
                            content: `Anda adalah analis sentimen media cerdas. Evaluasi secara menyeluruh konteks, arah narasi, baik dari baris Judul maupun Snippet. 
                            Kriteria Penilaian:
                            - POSITIVE: mayoritas berisi apresiasi, semangat, dukungan, cinta.
                            - NEGATIVE: berisi kritik, kekecewaan, sarkasme, atau isu sensitif.
                            - NEUTRAL: bersifat informatif, formal, atau tidak menunjukkan emosi jelas.
                            - MARAH: bersifat kasar, emosional tinggi, berisi kata-kata kasar/makian.
                            Jawab HANYA dengan satu kata: Positif, Netral, Negatif, atau Marah.`,
                          },
                          {
                            role: "user",
                            content: `Judul: ${item.title}\nSnippet: ${item.snippet}`,
                          },
                        ],
                        max_tokens: 10,
                        temperature: 0.1,
                      });

                    const contentSentiment =
                      sentimentCompletion.choices[0].message.content
                        ?.trim()
                        ?.replace(".", "") || "Netral";

                    // 2. Comments Scraping (Best effort for top 3 per platform to save time/cost)
                    const commentData = await getCommentsForUrl(
                      item.link,
                      platform.key,
                      dateFromStr,
                    );

                    let commentSentiment = {
                      Positif: 0,
                      Netral: 0,
                      Negatif: 0,
                      Marah: 0
                    };
                    let analyzedComments: {
                      text: string;
                      sentiment: string;
                      username: string;
                      isVerified: boolean;
                      likes: number;
                      profileUrl?: string;
                      profileImageUrl?: string;
                      matchRelevance?: string;
                    }[] = [];

                    if (commentData.comments.length > 0) {
                      const commentAnalyses = await Promise.all(
                        commentData.comments.map(async (c: any, idx: number) => {
                          try {
                            const cId = c.id || c.commentId || String(idx + 1);
                            const comp = await openai.chat.completions.create({
                              model: "gpt-4o",
                              response_format: { type: "json_object" },
                              messages: [
                                {
                                  role: "system",
                                  content: `Anda adalah agen AI penganalisis sentimen. 
                                  Kriteria Penilaian:
                                  - POSITIVE: apresiasi, semangat, dukungan, cinta, emoji positif (❤️🙏😊🎉).
                                  - NEGATIVE: kritik, kekecewaan, sarkasme, kemarahan moderat.
                                  - NEUTRAL: informatif, formal, tanpa emosi jelas.
                                  - MARAH: kasar, sangat emosional, makian, emoji marah.
                                  Format output WAJIB JSON:
{
  "id": "${cId}",
  "platform": "${platform.key}",
  "comment": "Teks komentar",
  "overall_sentiment": "POSITIVE | NEGATIVE | NEUTRAL | MARAH",
  "distribution": { "positive": 0, "neutral": 0, "negative": 0, "marah": 0 },
  "summary": "ringkasan singkat"
}`
                                },
                                { role: "user", content: `Komentar: ${c.text}` },
                              ],
                              temperature: 0.3,
                            });
                            
                            const responseContent = comp.choices[0].message.content || "{}";
                            const parsed = JSON.parse(responseContent);
                            let sent = "Netral";
                            if (parsed.overall_sentiment === "POSITIVE") sent = "Positif";
                            else if (parsed.overall_sentiment === "NEGATIVE") sent = "Negatif";
                            else if (parsed.overall_sentiment === "MARAH") sent = "Marah";
                               
                            return { 
                               ...c, 
                               sentiment: sent,
                               sentimentData: parsed 
                            };
                          } catch (err) {
                            return { ...c, sentiment: "Netral", sentimentData: null };
                          }
                        }),
                      );

                      commentAnalyses.forEach((c) => {
                        if (c.sentiment === "Positif")
                          commentSentiment.Positif++;
                        else if (c.sentiment === "Negatif")
                          commentSentiment.Negatif++;
                        else if (c.sentiment === "Marah")
                          commentSentiment.Marah++;
                        else commentSentiment.Netral++;
                      });
                      analyzedComments = commentAnalyses.slice(0, 20);

                      // 2. Overall comments sentiment using Chat Agent
                      try {
                        const allCommentsText = analyzedComments.map(ac => ac.text).join(" | ");
                        const overallId = item.title?.substring(0, 20) || "overall_1";
                        const agentResponse = await (openai as any).responses.create({
                          prompt: {
                            "id": "pmpt_69c8eb9f61748196a2abad66703193c100040af9fa8484f1",
                            "version": "2",
                            "variables": {
                              "id": overallId,
                              "url": item.link,
                              "platform": platform.key,
                              "comment": allCommentsText
                            }
                          }
                        });
                        
                        // Handle and parse response from Agent
                        let parsedAnalysis = null;
                        let rawContent = "";

                        if (Array.isArray(agentResponse)) {
                          // Handle multi-part/agentic array responses
                          const messagePart = agentResponse.find((r: any) => r.type === 'message');
                          const textContent = messagePart?.content?.find((c: any) => c.type === 'output_text' || c.type === 'text');
                          rawContent = textContent?.text || JSON.stringify(agentResponse);
                        } else if (agentResponse?.choices?.[0]?.message?.content) {
                          rawContent = agentResponse.choices[0].message.content;
                        } else if (agentResponse?.output) {
                          rawContent = typeof agentResponse.output === 'string' ? agentResponse.output : JSON.stringify(agentResponse.output);
                        } else {
                          rawContent = JSON.stringify(agentResponse);
                        }

                        console.log(`[Overall Sentiment Raw Content]: ${rawContent.substring(0, 100)}...`);

                        if (rawContent && rawContent.includes("{")) {
                          try {
                            // Extract JSON if it's wrapped in markdown code blocks or extra text
                            const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
                            const jsonToParse = jsonMatch ? jsonMatch[0] : rawContent;
                            parsedAnalysis = JSON.parse(jsonToParse);
                            
                            // NORMALIZE DISTRIBUTION (Convert strings like "80%" to numbers)
                            if (parsedAnalysis.distribution) {
                               const dist = parsedAnalysis.distribution;
                               ['positive', 'neutral', 'negative', 'marah'].forEach(k => {
                                  if (typeof dist[k] === 'string') {
                                     dist[k] = parseInt(dist[k].replace('%', ''), 10) || 0;
                                  }
                               });
                            }
                          } catch (e) {
                            console.error("[Overall Sentiment Parsing Failure]:", e);
                            parsedAnalysis = { summary: rawContent, distribution: { positive: 0, neutral: 0, negative: 0, marah: 0 } };
                          }
                        } else {
                           parsedAnalysis = { summary: rawContent || "Analisis tidak tersedia", distribution: { positive: 0, neutral: 0, negative: 0, marah: 0 } };
                        }

                        (item as any).overallCommentAnalysis = parsedAnalysis;
                      } catch (overallErr) {
                        console.error("[Overall Sentiment Agent Error]:", overallErr);
                      }
                    }

                    // Perbandingan Lanjutan untuk Sosial Media / Komentar
                    let updatedMatchRelevance = item.matchRelevance;
                    const commentWords = query.toLowerCase().replace(/["']/g, "").split(" ").filter(Boolean);
                    
                    if (commentData.comments.length > 0 || (commentData as any).postUsername || item.postUsername) {
                       const commentFoundWords = commentWords.filter(w => 
                          commentData.comments.some((c: any) => c.text?.toLowerCase().includes(w))
                       );
                       const userFoundWords = commentWords.filter(w => 
                          commentData.comments.some((c: any) => c.username?.toLowerCase().includes(w)) ||
                          item.postUsername?.toLowerCase().includes(w) ||
                          (commentData as any).postUsername?.toLowerCase().includes(w)
                       );

                       if (commentFoundWords.length > 0) {
                          updatedMatchRelevance += (updatedMatchRelevance ? " | " : "") + `Ada keyword ${commentFoundWords.map(w => `"${w}"`).join(", ")} pada komentar`;
                       }
                       if (userFoundWords.length > 0) {
                          updatedMatchRelevance += (updatedMatchRelevance ? " | " : "") + `Ada keyword ${userFoundWords.map(w => `"${w}"`).join(", ")} sebagai akun posting/like`;
                       }
                    }

                    if (!updatedMatchRelevance) {
                       updatedMatchRelevance = "Tidak ada kecocokan teks eksplisit (Terscrape via Semantik Algoritma Google/Apify)";
                    }

                    return {
                      ...item,
                      matchRelevance: updatedMatchRelevance,
                      sentiment: contentSentiment,
                      commentSentiment,
                      comments: analyzedComments,
                      commentError: commentData.error,
                      stats: commentData.stats,
                      postUsername:
                        item.postUsername || (commentData as any).postUsername,
                      postIsVerified: (commentData as any).postIsVerified,
                      publishedAt: (commentData as any).publishedAt || item.publishedAt,
                    };
                  } catch (err: any) {
                    console.error(
                      `Error processing item ${item.title}:`,
                      err?.message || err,
                    );
                    return {
                      ...item,
                      sentiment: "Netral",
                      comments: [],
                      commentSentiment: { Positif: 0, Netral: 0, Negatif: 0, Marah: 0 },
                    };
                  }
                });
              
              return {
                key: platform.key,
                name: platform.name,
                quantity: totalCount,
                items: analyzedResults,
              };
            } catch (error) {
              console.error(`Scraping error for ${platform.name}:`, error);
              return {
                key: platform.key,
                name: platform.name,
                error: "Proses scrap ada kendala",
                quantity: 0,
                items: [],
              };
            }
          }),
        );

        const results: any = {};
        monitoringResults.forEach((res) => {
          if (res) {
            const { key, ...data } = res;
            results[key] = data;
          }
        });

        // SAVE TO CACHE
        console.log(
          `[Media Monitoring Cache] Upserting cache for query: "${query}"`,
        );
        await prisma.mediaMonitoringCache.upsert({
          where: {
            query_dateFrom_dateTo: {
              query,
              dateFrom: dateFromStr,
              dateTo: dateToStr,
            },
          },
          update: {
            resultsData: results,
          },
          create: {
            query,
            dateFrom: dateFromStr,
            dateTo: dateToStr,
            resultsData: results,
          },
        });

        return reply.status(200).send({
          query,
          results,
        });
      } catch (error: any) {
        console.error("Monitor Scraper Error:", error);
        return reply.status(500).send({
          error: "Failed to run monitor scraper",
          message: error.message,
        });
      }
    },
  );

  async function downloadProfilePicUrl(
    url: string,
    handle: string,
    platform: string,
    request: FastifyRequest,
  ): Promise<string> {
    if (!url || url.includes("dicebear")) return url;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Failed to fetch photo for ${handle}: ${response.status}`);
        return url;
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      let ext = contentType.split("/")[1] || "jpg";
      if (ext === "jpeg") ext = "jpg";

      const uploadsDir = path.join(
        __dirname,
        "../../public/uploads/socmed-profiles",
      );
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const cleanHandle = handle.replace("@", "");
      const filename = `${platform}-${cleanHandle}.${ext}`;
      const filepath = path.join(uploadsDir, filename);

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(filepath, buffer);

      const host =
        request.headers.host ||
        process.env.BACKEND_URL?.replace(/^https?:\/\//, "") ||
        "localhost:4000";
      const cacheBuster = Date.now();
      return `${request.protocol}://${host}/uploads/socmed-profiles/${filename}?v=${cacheBuster}`;
    } catch (err) {
      console.error("Download avatar error:", err);
      return url;
    }
  }

  async function downloadPostMedia(
    url: string,
    postId: string,
    platform: string,
    request: FastifyRequest,
  ): Promise<string> {
    if (!url) return "";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(
          `[Media Download] Skip post ${postId}: HTTP ${response.status}`,
        );
        return url;
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      let ext = contentType.split("/")[1] || "jpg";
      if (ext === "jpeg") ext = "jpg";

      const uploadsDir = path.join(
        __dirname,
        "../../public/uploads/socmed/posts",
      );
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const filename = `${platform}-${postId}.${ext}`;
      const filepath = path.join(uploadsDir, filename);

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(filepath, buffer);

      const host =
        request.headers.host ||
        process.env.BACKEND_URL?.replace(/^https?:\/\//, "") ||
        "localhost:4000";
      return `${request.protocol}://${host}/uploads/socmed/posts/${filename}`;
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === "AbortError") {
        console.warn(
          `[Media Download] Timeout downloading media for post ${postId}`,
        );
      } else {
        console.error(`[Media Download] Error for post ${postId}:`, e.message);
      }
      return url; // Fallback to original URL
    }
  }

  async function scrapeSocmedProfile(
    handle: string,
    platform: string,
    request: FastifyRequest,
  ) {
    let actorId = "";
    let input: any = {};
    const cleanHandle = handle.replace("@", "");

    switch (platform) {
      case "instagram":
        actorId = "apify/instagram-scraper";
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - 7);
        const dateFromStr = dateFrom.toISOString().split("T")[0];

        input = {
          addParentData: false,
          directUrls: [`https://www.instagram.com/${cleanHandle}`],
          onlyPostsNewerThan: dateFromStr,
          resultsLimit: 50,
          resultsType: "details",
          searchLimit: 1,
          searchType: "hashtag",
        };
        break;
      case "tiktok":
        actorId = "apidojo/tiktok-profile-scraper";
        input = { usernames: [cleanHandle] };
        break;
      case "x":
        actorId = "apidojo/twitter-user-scraper";
        input = { twitterHandles: [cleanHandle] };
        break;
      default:
        throw new Error(`Platform ${platform} tidak didukung`);
    }

    console.log(`[Apify Socmed] Calling ${actorId} for ${handle}`);
    const run = await apifyClient.actor(actorId).call(input);
    const { items } = await apifyClient
      .dataset(run.defaultDatasetId)
      .listItems();

    if (items.length === 0) return null;

    const profile = items[0] as any;

    // Normalize data
    let followers = 0;
    let following = 0;
    let posts = 0;
    let er = 0;
    let avgLikes = 0;
    let avgComments = 0;
    let isPrivate = false;
    let recentTrend: number[] = [40, 45, 42, 48, 55, 60, 65];

    if (platform === "instagram") {
      followers = profile.followersCount || 0;
      following = profile.followsCount || 0;
      posts = profile.postsCount || 0;
      isPrivate = profile.private || profile.isPrivate || false;

      let totalLikes = 0;
      let totalComments = 0;
      let postCount = 0;
      let trendData: number[] = [];

      if (profile.latestPosts && Array.isArray(profile.latestPosts)) {
        postCount = profile.latestPosts.length;

        // Sort posts by timestamp ascending
        const sortedPosts = [...profile.latestPosts].sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );

        for (const post of sortedPosts) {
          totalLikes += post.likesCount || 0;
          totalComments += post.commentsCount || 0;

          // Calculate ER per post and cap at 100%
          const postEngagements =
            (post.likesCount || 0) +
            (post.commentsCount || 0) +
            (post.sharesCount || post.reelShareCount || post.shareCount || 0) +
            (post.reshareCount || post.repostsCount || 0);
          const postEr =
            followers > 0 ? (postEngagements / followers) * 100 : 0;
          trendData.push(Number(postEr.toFixed(2)));
        }
      }

      if (postCount > 0) {
        avgLikes = Math.round(totalLikes / postCount);
        avgComments = Math.round(totalComments / postCount);
        er = followers > 0 ? ((avgLikes + avgComments) / followers) * 100 : 0;

        recentTrend = trendData.slice(-7);
        while (recentTrend.length < 7) {
          recentTrend.unshift(0);
        }
      } else {
        er = profile.engagementRate || 0;
      }
    } else if (platform === "tiktok") {
      followers = profile.followerCount || 0;
      following = profile.followingCount || 0;
      posts = profile.videoCount || 0;
      isPrivate = profile.private || false;
      er = profile.engagementRate || 0;
    } else if (platform === "x") {
      followers = profile.followers_count || 0;
      following = profile.friends_count || 0;
      posts = profile.statuses_count || 0;
      isPrivate = profile.protected || false;
    }

    let avatarUrl =
      profile.profilePicUrlHD ||
      profile.profilePicUrl ||
      profile.avatarThumb ||
      profile.profile_image_url ||
      profile.profileImageUrl;
    avatarUrl = await downloadProfilePicUrl(
      avatarUrl,
      handle,
      platform,
      request,
    );

    // Calculate Followers Trend (7 days)
    // Since we don't have historical data, estimate based on current growth patterns
    const followersTrend: number[] = [];
    const estimatedDailyGrowth = followers > 100000 ? 0.0005 : 0.002; // 0.05% for large, 0.2% for small
    const erImpact = (er / 100) * 0.1; // Engagement slightly boosts growth
    const growthFactor = estimatedDailyGrowth + erImpact;

    for (let i = 6; i >= 0; i--) {
      const noise = (Math.random() - 0.5) * 0.0002;
      const dayFactor = 1 - growthFactor * i + noise;
      followersTrend.push(Math.round(followers * dayFactor));
    }

    // Generate Dates for Trend (last 7 days)
    const trendDates: string[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      // Format: "17 Mar"
      trendDates.push(
        d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }),
      );
    }

    const result = {
      handle: handle.startsWith("@") ? handle : `@${handle}`,
      platform,
      name:
        profile.fullName ||
        profile.nickname ||
        profile.name ||
        profile.username ||
        handle,
      avatar: avatarUrl,
      bio:
        profile.biography ||
        profile.signature ||
        profile.description ||
        profile.bio ||
        "",
      followers,
      following,
      posts,
      er,
      avgLikes,
      avgComments,
      isPrivate,
      recentTrend,
      followersTrend,
      trendDates,
      lastScraped: new Date(),
    };

    return result;
  }

  fastify.post(
    "/socmed-analysis",
    {
      preHandler: [authMiddleware, requireRole("SUPER_ADMIN", "ADMIN")],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const {
          handle,
          platform = "instagram",
          forceRegenerate = false,
        } = request.body as {
          handle: string;
          platform?: string;
          forceRegenerate?: boolean;
        };

        if (!handle) {
          return reply.status(400).send({ error: "Handle is required" });
        }

        const normalizedHandle = handle.startsWith("@") ? handle : `@${handle}`;

        // 1. Check Cache
        if (!forceRegenerate) {
          const cached = await prisma.socmedProfile.findUnique({
            where: {
              handle_platform: {
                handle: normalizedHandle,
                platform,
              },
            },
          });

          // If cache is fresh (less than 24h)
          if (
            cached &&
            Date.now() - cached.lastScraped.getTime() < 24 * 60 * 60 * 1000
          ) {
            return reply.status(200).send(cached);
          }
        }

        // 2. Scrap with Apify
        const scrapedData = await scrapeSocmedProfile(
          normalizedHandle,
          platform,
          request,
        );

        if (!scrapedData) {
          return reply
            .status(404)
            .send({ error: "Account not found or could not be scraped" });
        }

        // 3. Save to DB
        const savedProfile = await prisma.socmedProfile.upsert({
          where: {
            handle_platform: {
              handle: normalizedHandle,
              platform,
            },
          },
          update: scrapedData,
          create: scrapedData,
        });

        return reply.status(200).send(savedProfile);
      } catch (error: any) {
        console.error("Socmed Analysis Error:", error);
        return reply.status(500).send({
          error: "Failed to run socmed analysis",
          message: error.message,
        });
      }
    },
  );

  fastify.post(
    "/socmed-detail",
    {
      preHandler: [authMiddleware, requireRole("SUPER_ADMIN", "ADMIN")],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const {
          handle,
          platform = "instagram",
          forceRegenerate = false,
        } = request.body as {
          handle: string;
          platform?: string;
          forceRegenerate?: boolean;
        };

        if (!handle) {
          return reply.status(400).send({ error: "Handle is required" });
        }

        const normalizedHandle = handle.startsWith("@") ? handle : `@${handle}`;

        // 1. Get profile from DB to get followers count for ER per post
        const profile = await prisma.socmedProfile.findUnique({
          where: {
            handle_platform: {
              handle: normalizedHandle,
              platform,
            },
          },
        });

        if (!profile) {
          return reply.status(404).send({
            error: "Profile analysis not found. Please analyze profile first.",
          });
        }

        if (profile.isPrivate) {
          return reply.status(200).send({ isPrivate: true, posts: [] });
        }

        // 2. Check Cache
        if (!forceRegenerate) {
          const cachedPosts = await prisma.socmedPost.findMany({
            where: { profileId: profile.id },
            orderBy: { timestamp: "desc" },
          });

          if (cachedPosts.length > 0) {
            return reply.status(200).send({
              handle: normalizedHandle,
              platform,
              posts: cachedPosts.map((p, i) => ({ ...p, no: i + 1 })),
            });
          }
        }

        // 3. Hybrid Scraping Logic (Reels + General Posts)
        const username = normalizedHandle.replace("@", "");

        console.log(`[Apify] Starting hybrid scrape for ${normalizedHandle}`);

        // Use allSettled so one failure doesn't kill the whole process
        const results = await Promise.allSettled([
          apifyClient.actor("apify/instagram-reel-scraper").call({
            username: [username],
            resultsLimit: 20,
            includeSharesCount: true,
            includeDownloadedVideo: false,
            includeTranscript: false,
            skipPinnedPosts: false,
          }),
          apifyClient.actor("apify/instagram-scraper").call({
            directUrls: [`https://www.instagram.com/${username}`],
            resultsLimit: 20,
            resultsType: "posts",
            proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
          }),
        ]);

        const reelRunTask =
          results[0].status === "fulfilled" ? results[0].value : null;
        const generalRunTask =
          results[1].status === "fulfilled" ? results[1].value : null;

        if (!reelRunTask && !generalRunTask) {
          throw new Error(
            "Both Instagram scrapers failed to start. Please check your Apify quota or connection.",
          );
        }

        // Fetch datasets
        console.log(
          `[Apify] Fetching datasets (Reel: ${!!reelRunTask}, General: ${!!generalRunTask})`,
        );
        const datasetResults = await Promise.allSettled([
          reelRunTask
            ? apifyClient.dataset(reelRunTask.defaultDatasetId).listItems()
            : Promise.reject("No Reel Task"),
          generalRunTask
            ? apifyClient.dataset(generalRunTask.defaultDatasetId).listItems()
            : Promise.reject("No General Task"),
        ]);

        const reelItems =
          (datasetResults[0].status === "fulfilled"
            ? datasetResults[0].value.items
            : []) || [];
        const generalItems =
          (datasetResults[1].status === "fulfilled"
            ? datasetResults[1].value.items
            : []) || [];

        console.log(
          `[Apify] Received ${reelItems.length} Reels and ${generalItems.length} general items`,
        );

        if (reelItems.length === 0 && generalItems.length === 0) {
          return reply.status(404).send({
            error: "No posts found for this handle using both scrapers.",
          });
        }

        // Merge results: Use general as base, overlay with reel-specific high-detail metrics
        const mergedMap = new Map();

        // Add general items
        generalItems.forEach((item: any) => {
          if (!item) return;
          const id = item.id || item.shortCode;
          if (id) mergedMap.set(String(id), item);
        });

        // Overlay with reel items (usually have more metrics like shared)
        reelItems.forEach((reel: any) => {
          if (!reel) return;
          const id = reel.id || reel.shortCode;
          if (!id) return;

          const existing = mergedMap.get(String(id));
          if (existing) {
            // Merge: priority to reel metrics
            mergedMap.set(String(id), { ...existing, ...reel });
          } else {
            mergedMap.set(String(id), reel);
          }
        });

        const finalItems = Array.from(mergedMap.values())
          .sort((a: any, b: any) => {
            const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return dateB - dateA;
          })
          .slice(0, 20);

        const followers = profile.followers || 1;

        // Parallelize media downloads and DB upserts for all items simultaneously
        const postsResults = await Promise.allSettled(
          finalItems.map(async (item: any) => {
            try {
              const likesCount = item.likesCount || 0;
              const commentsCount = item.commentsCount || 0;
              const shared = item.sharesCount || item.reelShareCount || 0;
              const reposts = item.reshareCount || 0;

              const er =
                ((likesCount + commentsCount + shared + reposts) / followers) *
                100;

              const displayUrl =
                item.displayUrl || (item.images && item.images[0]) || "";
              const localMediaUrl = await downloadPostMedia(
                displayUrl,
                String(item.id || item.shortCode),
                platform,
                request,
              );

              const postData = {
                postId: String(item.id || item.shortCode),
                url:
                  item.url || `https://www.instagram.com/p/${item.shortCode}/`,
                type:
                  item.type ||
                  (item.videoPlayCount || item.videoViewCount
                    ? "Video"
                    : "Image"),
                displayUrl: localMediaUrl,
                caption: item.caption || "",
                timestamp: item.timestamp
                  ? new Date(item.timestamp)
                  : new Date(),
                likesCount,
                commentsCount,
                reposts,
                shared,
                viewsCount:
                  item.videoPlayCount ||
                  item.videoViewCount ||
                  item.viewCount ||
                  0,
                er: parseFloat(er.toFixed(4)),
                hashtags: item.hashtags || [],
                profileId: profile.id,
              };

              // Save to DB
              await prisma.socmedPost.upsert({
                where: {
                  postId_profileId: {
                    postId: postData.postId,
                    profileId: profile.id,
                  },
                },
                update: postData,
                create: postData,
              });

              return postData;
            } catch (itemErr) {
              console.warn(
                `[Apify] Error processing item ${item?.id}:`,
                itemErr,
              );
              return null;
            }
          }),
        );

        const posts = postsResults
          .filter(
            (res): res is PromiseFulfilledResult<any> =>
              res.status === "fulfilled" && res.value !== null,
          )
          .map((res) => res.value);

        return reply.status(200).send({
          handle: normalizedHandle,
          platform,
          posts: posts
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .map((p, i) => ({ ...p, no: i + 1 })),
        });
      } catch (error: any) {
        console.error("Socmed Detail Error:", error);
        return reply.status(500).send({
          error: "Failed to run hybrid socmed detail report",
          message: error.message,
        });
      }
    },
  );
}
