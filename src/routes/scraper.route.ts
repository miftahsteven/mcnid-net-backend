import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ApifyClient } from "apify-client";
import OpenAI from "openai";
import { prisma } from "../lib/prisma";
import { authMiddleware, requireRole } from "../middlewares/auth.middleware";

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
): Promise<{ comments: string[]; error?: string; stats?: { likes: number, retweets: number, replies: number } }> {
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
          includeNestedComments: true,
          onlyCommentsNewerThan: dateFromStr || "2026-03-16",
          resultsLimit: 50,
          startUrls: [{ url: fbUrl }],
          viewOption: "RECENT_ACTIVITY",
        };
        break;
      case "instagram":
        actorId = "apify/instagram-comment-scraper";
        input = { 
          directUrls: [url],
          includeNestedComments: true,
          isNewestComments: false,
          resultsLimit: 15
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
          tweetLanguage: "id"
        };
        break;
      case "tiktok":
        actorId = "apidojo/tiktok-comments-scraper";
        input = { 
          customMapFunction: "(object) => { return {...object} }",
          includeReplies: false,
          maxItems: 10,
          startUrls: [url] 
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
      .map((item) => item.text || item.comment || item.full_text || "")
      .filter(Boolean)
      .slice(0, 20);
    console.log(
      `[Apify] Extracted ${comments.length} comments for URL: ${url}`,
    );

    let stats;
    if (platformKey === "x" && items.length > 0) {
      // Find the main tweet or just use the first one if we can't reliably match the URL
      const mainItem = (items as any[]).find(i => i.url === url || i.twitterUrl === url) || items[0];
      if (mainItem) {
        stats = {
          likes: mainItem.likeCount || 0,
          retweets: mainItem.retweetCount || 0,
          replies: mainItem.replyCount || 0,
        };
      }
    }

    return { comments, stats };
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
            queries: "cholil nafis",
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

        // 2. Filter internal duplicates and allowed sources
        const seenTitles = new Set<string>();
        let filteredItems = newsItems.filter((item) => {
          if (!item.title || !item.sourceUrl) return false;

          const isAllowed = allowedSources.some((source) =>
            item.sourceUrl.includes(source),
          );
          if (!isAllowed) return false;

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
              model: "gpt-5.1",
              messages: [
                {
                  role: "system",
                  content:
                    "Anda adalah seorang penulis dan editor berita profesional Islami. Tugas Anda adalah mengembangkan informasi singkat menjadi artikel utuh format HTML (menggunakan tag <p>, <h2>, <ul>, dsb tanpa ```html wrapper) dan memberikan excerpt (ringkasan 2 kalimat) dalam format JSON.",
                },
                {
                  role: "user",
                  content: `Buatkan artikel berita lengkap tentang tokoh "Cholil Nafis" berdasarkan metadata berikut:\n\nJudul: ${item.title}\nSumber: ${item.source}\nLink Referensi: ${item.link}${promptContext}\n\nBerikan response HANYA DALAM BENTUK JSON yang valid persis dengan struktur berikut:\n{\n  "content": "string html artikel lengkap (minimal 3 paragraf)",\n  "excerpt": "string ringkasan singkat maksimal 250 karakter"\n}`,
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
            queries: "cholil nafis site:youtube.com",
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
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content:
                    "Anda adalah seorang penulis dan editor konten video Islami pelengkap presentasi. Tugas Anda adalah mengembangkan informasi metadata video YouTube menjadi deskripsi yang utuh dan menarik dalam format HTML (menggunakan tag <p>, <ul>, dsb tanpa ```html wrapper) dalam format JSON.",
                },
                {
                  role: "user",
                  content: `Buatkan deskripsi video YouTube tentang tokoh "Cholil Nafis" berdasarkan metadata berikut:\n\nJudul: ${item.title}\nSumber: ${item.source}\nLink Referensi: ${item.link}${promptContext}\n\nBerikan response HANYA DALAM BENTUK JSON yang valid persis dengan struktur berikut:\n{\n  "description": "string html deskripsi lengkap video"\n}`,
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
        const { query, forceRegenerate = false } = request.body as { query: string; forceRegenerate?: boolean };
        if (!query) {
          return reply.status(400).send({ error: "Missing query" });
        }

        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - 7);
        const dateFromStr = dateFrom.toISOString().split("T")[0];

        const dateTo = new Date();
        const dateToStr = dateTo.toISOString().split("T")[0];

        // CHECK CACHE
        if (!forceRegenerate) {
          const cached = await prisma.mediaMonitoringCache.findUnique({
            where: {
              query_dateFrom_dateTo: {
                query,
                dateFrom: dateFromStr,
                dateTo: dateToStr,
              }
            }
          });
          
          if (cached) {
            console.log(`[Media Monitoring Cache] Returning cached results for query: "${query}"`);
            return reply.send({ results: cached.resultsData });
          }
        }

        const platforms = [
          { key: "web", name: "Web (Media Nasional)", querySuffix: " (site:kompas.com OR site:detik.com OR site:tempo.co OR site:cnnindonesia.com OR site:republika.co.id OR site:antaranews.com OR site:viva.co.id OR site:suara.com OR site:merdeka.com OR site:liputan6.com OR site:tribunnews.com)" },
          {
            key: "facebook",
            name: "Facebook",
            querySuffix: " site:facebook.com",
          },
          { key: "instagram", name: "Instagram", querySuffix: " site:instagram.com" },
          { key: "x", name: "X (Twitter)", querySuffix: " (site:twitter.com OR site:x.com)" },
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
                  resultsPerPage: 20,
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

              const topResults = rawResults.slice(0, 5).map((res: any) => ({
                title: res.title,
                link: res.url,
                snippet: res.description,
              }));

              // Sentiment analysis in parallel for these top results using OpenAI
              const analyzedResults = await Promise.all(
                topResults.map(async (item) => {
                  try {
                    // 1. Content Sentiment
                    const sentimentCompletion =
                      await openai.chat.completions.create({
                        model: "gpt-4o-mini",
                        messages: [
                          {
                            role: "system",
                            content:
                              "Anda adalah analis sentimen media. Tentukan sentimen (Positif, Netral, Negatif) dari judul/konten berikut. Jawab hanya dengan satu kata: Positif, Netral, atau Negatif.",
                          },
                          {
                            role: "user",
                            content: `Judul: ${item.title}\nSnippet: ${item.snippet}`,
                          },
                        ],
                        max_tokens: 10,
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
                    };
                    let analyzedComments: {
                      text: string;
                      sentiment: string;
                    }[] = [];

                    if (commentData.comments.length > 0) {
                      const commentAnalyses = await Promise.all(
                        commentData.comments.map(async (text) => {
                          try {
                            const comp = await openai.chat.completions.create({
                              model: "gpt-4o-mini",
                              messages: [
                                {
                                  role: "system",
                                  content:
                                    "Tentukan sentimen (Positif, Netral, Negatif) dari komentar ini. Jawab satu kata saja.",
                                },
                                { role: "user", content: text },
                              ],
                              max_tokens: 5,
                            });
                            const sent =
                              comp.choices[0].message.content
                                ?.trim()
                                ?.replace(".", "") || "Netral";
                            return { text, sentiment: sent };
                          } catch {
                            return { text, sentiment: "Netral" };
                          }
                        }),
                      );

                      commentAnalyses.forEach((c) => {
                        if (c.sentiment === "Positif")
                          commentSentiment.Positif++;
                        else if (c.sentiment === "Negatif")
                          commentSentiment.Negatif++;
                        else commentSentiment.Netral++;
                      });
                      analyzedComments = commentAnalyses.slice(0, 20);
                    }

                    return {
                      ...item,
                      sentiment: contentSentiment,
                      commentSentiment,
                      comments: analyzedComments,
                      commentError: commentData.error,
                      stats: commentData.stats
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
                      commentSentiment: { Positif: 0, Netral: 0, Negatif: 0 },
                    };
                  }
                }),
              );

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
        console.log(`[Media Monitoring Cache] Upserting cache for query: "${query}"`);
        await prisma.mediaMonitoringCache.upsert({
          where: {
            query_dateFrom_dateTo: {
              query,
              dateFrom: dateFromStr,
              dateTo: dateToStr,
            }
          },
          update: {
            resultsData: results
          },
          create: {
            query,
            dateFrom: dateFromStr,
            dateTo: dateToStr,
            resultsData: results
          }
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
}
