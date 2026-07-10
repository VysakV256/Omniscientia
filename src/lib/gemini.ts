import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = "gemini-flash-latest";

// Simple request queue to prevent concurrent bursts and ensure sequential execution
let requestQueue: Promise<void> = Promise.resolve();

async function callGeminiWithRetry(fn: () => Promise<any>, maxRetries = 7) {
  return new Promise((resolve, reject) => {
    // Chain to the queue to ensure sequential execution
    requestQueue = requestQueue.then(async () => {
      try {
        // Add a small fixed delay between any two requests to stay under rate limits
        await new Promise(r => setTimeout(r, 1500));
        
        let delay = 5000;
        for (let i = 0; i < maxRetries; i++) {
          try {
            console.log(`[Gemini] Calling ${MODEL_NAME} (Attempt ${i + 1}/${maxRetries})...`);
            const result = await fn();
            console.log(`[Gemini] Success`);
            resolve(result);
            return;
          } catch (error: any) {
            const errorStr = JSON.stringify(error);
            const isRateLimit = 
              error?.message?.includes("429") || 
              error?.status === 429 || 
              error?.code === 429 ||
              errorStr.includes("429") ||
              errorStr.includes("RESOURCE_EXHAUSTED");

            if (isRateLimit && i < maxRetries - 1) {
              console.warn(`[Gemini] Rate limited (429). Retrying in ${delay}ms...`);
              await new Promise(r => setTimeout(r, delay));
              delay *= 2;
              continue;
            }
            // Not a rate limit or max retries reached
            console.error(`[Gemini] Fatal error:`, error);
            throw error;
          }
        }
      } catch (error) {
        reject(error);
      }
    }).catch((err) => {
      // Ensure the queue continues even if a request fails
      console.error("[Gemini] Queue task failed but continuing queue:", err);
    });
  });
}

export async function summarizePaper(title: string, abstract: string | null) {
  if (!abstract) return "No abstract available for summarization.";

  try {
    const response: any = await callGeminiWithRetry(() => ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Summarize the following academic paper abstract in 2-3 concise sentences. Focus on the core contribution and methodology.
      
      Title: ${title}
      Abstract: ${abstract}`,
    }));
    return response.text || "Summary unavailable.";
  } catch (error) {
    console.error("Summarization error:", error);
    return "Failed to generate summary due to high traffic. Please try again in a moment.";
  }
}

export async function analyzeThemes(papers: { id: string; title: string; abstract: string | null }[]) {
  const context = papers
    .map((p) => `ID: ${p.id}\nTitle: ${p.title}\nAbstract: ${p.abstract?.slice(0, 200)}...`)
    .join("\n\n");

  try {
    const response: any = await callGeminiWithRetry(() => ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Analyze these academic papers and group them into 3-5 high-level research themes. For each paper, assign it to the most relevant theme. Return a JSON array of objects with 'id' (the paper ID) and 'theme' (a short 2-4 word theme name).
      
      ${context}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              theme: { type: Type.STRING },
            },
            required: ["id", "theme"],
          },
        },
      },
    }));
    return JSON.parse(response.text || "[]") as { id: string; theme: string }[];
  } catch (error) {
    console.error("Theme analysis error:", error);
    return [];
  }
}

export async function extractConcepts(papers: { title: string; abstract: string | null }[]) {
  const context = papers
    .map((p, i) => `Paper ${i + 1}: ${p.title}\nAbstract: ${p.abstract?.slice(0, 300)}...`)
    .join("\n\n");

  try {
    const response: any = await callGeminiWithRetry(() => ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Based on the following academic papers, identify the top 5-7 key concepts or research themes that connect them. Return only a JSON array of strings.
      
      ${context}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
    }));
    return JSON.parse(response.text || "[]") as string[];
  } catch (error) {
    console.error("Concept extraction error:", error);
    return [];
  }
}

export async function generateFieldInsight(query: string, yearRange: string, papers: { title: string; authors: { name: string }[]; year: number | null }[]) {
  const paperContext = papers
    .slice(0, 15)
    .map(p => `- ${p.title} (${p.year}), Authors: ${p.authors.map(a => a.name).join(", ")}`)
    .join("\n");

  try {
    const response: any = await callGeminiWithRetry(() => ai.models.generateContent({
      model: MODEL_NAME,
      contents: `You are a senior research historian. Provide a concise, high-level synthesis of the development of the field "${query}" ${yearRange ? `during the period ${yearRange}` : "historically"}.
      
      Based on these key papers:
      ${paperContext}
      
      Your response should:
      1. Summarize the major shift or evolution in the field.
      2. Mention 2-3 key thinkers or seminal works from the list.
      3. Be exactly 3-4 sentences long.
      4. Use a sophisticated, academic yet accessible tone.
      5. Do not use markdown formatting like bold or bullet points, just a single paragraph of text.`,
    }));
    return response.text || "Insight unavailable.";
  } catch (error) {
    console.error("Field insight error:", error);
    return "Failed to generate field insight. This may be due to temporary API limits.";
  }
}

export async function extractKeyIdeasForSpeedReading(title: string, text: string) {
  try {
    const response: any = await callGeminiWithRetry(() => ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Analyze the following academic text (Title: "${title}", Text: "${text}") and break it down into a chronological sequence of 8-15 short, punchy, sequential key ideas/phrases. 
      Each phrase MUST be exactly 2 to 6 words long so it can be read rapidly in a high-speed teleprompter (Speed Reader).
      Do NOT include long sentences. Focus on key results, methodologies, and contributions.
      
      Example of desired output phrases for a paper about graph neural networks:
      - Graph structures are complex
      - Traditional models fail
      - We propose GNN-Sledge
      - Aggregates neighborhood features
      - Reduces computation by 45%
      - State-of-the-art accuracy achieved
      
      Return only a JSON array of strings representing these sequential concepts.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
    }));
    return JSON.parse(response.text || "[]") as string[];
  } catch (error) {
    console.error("Key ideas speed-reading extraction error:", error);
    // Return empty array to trigger client-side fallback
    return [];
  }
}
