const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

function isRepairPlan(plan) {
  return plan &&
    typeof plan.problem === "string" &&
    Array.isArray(plan.clarifyingQuestions) &&
    Array.isArray(plan.steps) &&
    Array.isArray(plan.tools) &&
    Array.isArray(plan.materials) &&
    Array.isArray(plan.safetyWarnings) &&
    typeof plan.professionalHelpRecommended === "boolean";
}

function extractJson(text) {
  const cleaned = text.replace(/```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Ollama returned no JSON repair plan.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function generateWithOllama(description) {
  const response = await fetch(`${process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
      stream: false,
      format: "json",
      prompt: `You are a cautious household repair assistant. Return only valid JSON with exactly these fields: problem (string), clarifyingQuestions (array of strings), steps (array of objects with step number and instruction string), tools (array of objects with name, quantity number, reason), materials (array of objects with name and reason), safetyWarnings (array of strings), professionalHelpRecommended (boolean). Never invent marketplace listings, owners, prices, or availability. Recommend a qualified professional for electrical, gas, structural, roofing, or dangerous work. Repair description: ${description}`,
    }),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
  const data = await response.json();
  const plan = extractJson(data.response || "");
  if (!isRepairPlan(plan)) throw new Error("Ollama returned an incomplete repair plan.");
  return plan;
}

async function generateWithGemini(description, image = null) {
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      contents: [{
        role: "user",
        parts: [
          { text: `You are a cautious household repair assistant. Return only valid JSON with exactly these fields: problem (string), summary (string), clarifyingQuestions (array of strings), steps (array of objects with step number and instruction string), tools (array of objects with name, quantity number, reason), materials (array of objects with name and reason), safetyWarnings (array of strings), professionalHelpRecommended (boolean). Never invent marketplace listings, owners, prices, or availability. Use the attached photo as supplementary evidence, but clearly state uncertainty and do not identify people. Recommend a qualified professional for electrical, gas, structural, roofing, or dangerous work. Repair description: ${description}` },
          ...(image ? [{ inlineData: { mimeType: image.match(/^data:(image\/[^;]+);base64,/)?.[1], data: image.replace(/^data:image\/[^;]+;base64,/, "") } }] : []),
        ],
      }],
    }),
  });
  if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}.`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const plan = extractJson(text);
  if (!isRepairPlan(plan) || typeof plan.summary !== "string") throw new Error("Gemini returned an incomplete repair plan.");
  return plan;
}

module.exports = { generateWithOllama, generateWithGemini, isRepairPlan };
