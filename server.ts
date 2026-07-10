import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAILTO = "vysak.v@gmail.com"; // Used for OpenAlex polite pool

// Helper to reconstruct abstract from OpenAlex inverted index
function reconstructAbstract(invertedIndex: Record<string, number[]> | null): string | null {
  if (!invertedIndex) return null;
  let maxIndex = 0;
  for (const indices of Object.values(invertedIndex)) {
    for (const index of indices) {
      if (index > maxIndex) maxIndex = index;
    }
  }
  const words = new Array(maxIndex + 1).fill('');
  for (const [word, indices] of Object.entries(invertedIndex)) {
    for (const index of indices) {
      words[index] = word;
    }
  }
  return words.join(' ').trim();
}

// Map OpenAlex work to our internal Paper format
function mapOpenAlexWork(work: any) {
  return {
    paperId: work.id ? work.id.replace('https://openalex.org/', '') : Math.random().toString(),
    title: work.title || 'Untitled',
    authors: (work.authorships || []).map((a: any) => ({ name: a.author?.display_name || 'Unknown' })),
    abstract: reconstructAbstract(work.abstract_inverted_index),
    year: work.publication_year || null,
    citationCount: work.cited_by_count || 0,
    url: work.doi || work.id,
    externalIds: {
      DOI: work.doi ? work.doi.replace('https://doi.org/', '') : undefined,
      ArXiv: work.ids?.arxiv ? work.ids.arxiv.replace('https://arxiv.org/abs/', '') : undefined
    }
  };
}

async function fetchWithRetry(url: string, options: any, maxRetries = 3) {
  let delay = 1500;
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(url, options);
    if (response.status === 429 && i < maxRetries - 1) {
      console.warn(`Rate limited (429) on ${url}. Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
      continue;
    }
    return response;
  }
  return fetch(url, options);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/test-api", async (req, res) => {
    try {
      const response = await fetch(`https://api.openalex.org/works?search=test&per-page=1&mailto=${MAILTO}`);
      res.json({ 
        status: response.status, 
        ok: response.ok,
        data: await response.json()
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: Search papers
  app.get("/api/search", async (req, res) => {
    const { query, year, arxivOnly } = req.query;
    console.log(`Search request received for: ${query}, year: ${year}, arxivOnly: ${arxivOnly}`);
    if (!query) return res.status(400).json({ error: "Query required" });

    try {
      let apiUrl = `https://api.openalex.org/works?search=${encodeURIComponent(query as string)}&per-page=100&sort=cited_by_count:desc&mailto=${MAILTO}`;
      
      const filters: string[] = [];
      if (year) {
        filters.push(`publication_year:${year}`);
      }
      if (arxivOnly === "true") {
        // arXiv source ID in OpenAlex
        filters.push(`locations.source.id:S4306400194`);
      }

      if (filters.length > 0) {
        apiUrl += `&filter=${filters.join(",")}`;
      }
      
      console.log(`Fetching from OpenAlex: ${apiUrl}`);
      
      const response = await fetchWithRetry(apiUrl, {
        headers: { 'User-Agent': 'Omniscientia/1.0.0' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`OpenAlex API error (${response.status}):`, errorText);
        return res.status(response.status).json({ error: "External API error", details: errorText });
      }

      const data = await response.json();
      const mappedData = (data.results || []).map(mapOpenAlexWork);
      
      console.log(`Search successful, found ${mappedData.length} papers`);
      res.json({ data: mappedData });
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ error: "Failed to fetch papers" });
    }
  });

  // API Route: Get citations for a paper
  app.get("/api/papers/:id/citations", async (req, res) => {
    const { id } = req.params;
    console.log(`Citations request received for paper ID: ${id}`);
    try {
      // Fetch papers that CITE this paper (cited by), sorted by their own citation count
      const apiUrl = `https://api.openalex.org/works?filter=cites:${id}&per-page=6&sort=cited_by_count:desc&mailto=${MAILTO}`;
      
      const response = await fetchWithRetry(apiUrl, {
        headers: { 'User-Agent': 'Omniscientia/1.0.0' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`OpenAlex Citations API error (${response.status}):`, errorText);
        return res.status(response.status).json({ error: "External API error", details: errorText });
      }

      const data = await response.json();
      const mappedData = (data.results || []).map(mapOpenAlexWork);
      
      console.log(`Citations fetch successful, found ${mappedData.length} citations`);
      res.json({ data: mappedData });
    } catch (error) {
      console.error("Citations error:", error);
      res.status(500).json({ error: "Failed to fetch citations" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
