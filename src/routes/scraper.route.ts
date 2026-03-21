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
  "nu.or.id"
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
  if (shortMatch) return `https://img.youtube.com/vi/${shortMatch[1]}/maxresdefault.jpg`;
  
  return null;
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
              returnRelatedQuestions: false
            },
            queries: "cholil nafis",
            resultsPerPage: 100,
            saveHtml: false,
            saveHtmlToKeyValueStore: false,
            searchLanguage: "id"
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
          source: res.displayedUrl?.split(" ")[0]?.replace("https://", "")?.replace("www.", "") || "Media",
          sourceUrl: res.url,
          publishedAt: res.date || null,
          link: res.url,
          image: null,
          text: res.description
        }));

        // 2. Filter internal duplicates and allowed sources
        const seenTitles = new Set<string>();
        let filteredItems = newsItems.filter((item) => {
          if (!item.title || !item.sourceUrl) return false;

          const isAllowed = allowedSources.some((source) => item.sourceUrl.includes(source));
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
              returnRelatedQuestions: false
            },
            queries: "cholil nafis site:youtube.com",
            resultsPerPage: 100,
            saveHtml: false,
            saveHtmlToKeyValueStore: false,
            searchLanguage: "id"
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
          source: res.displayedUrl?.split(" ")[0]?.replace("https://", "")?.replace("www.", "") || "YouTube",
          sourceUrl: res.url,
          publishedAt: res.date || null,
          link: res.url,
          image: null,
          text: res.description
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
              model: "gpt-5.1",
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
}
