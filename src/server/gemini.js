import { GoogleGenerativeAI } from "@google/generative-ai";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const MISSING_API_KEY_MESSAGE =
  "Gemini is not configured. Add GEMINI_API_KEY to .env.local, then restart the dev server.";

export function getGeminiApiKey() {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    ""
  );
}

export function getGeminiModelName() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export function getGeminiConfigErrorMessage() {
  return MISSING_API_KEY_MESSAGE;
}

export function createGeminiModel(modelName = getGeminiModelName()) {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error(MISSING_API_KEY_MESSAGE);
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  return {
    model: genAI.getGenerativeModel({ model: modelName }),
    modelName,
  };
}

export async function generateJsonWithGemini(prompt, options = {}) {
  const { temperature = 0, modelName = getGeminiModelName() } = options;
  const { model } = createGeminiModel(modelName);

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
    },
  });

  return {
    modelName,
    text: await result.response.text(),
  };
}

export function getGeminiErrorDetails(error) {
  const rawMessage =
    error instanceof Error ? error.message : "Unknown Gemini API error";

  if (
    /API_KEY_INVALID|API key not found|invalid api key/i.test(rawMessage)
  ) {
    return "Gemini rejected the API key. Create a fresh key in Google AI Studio, put it in .env.local as GEMINI_API_KEY, and restart the server.";
  }

  if (/reported as leaked|key was reported as leaked|blocked/i.test(rawMessage)) {
    return "This Gemini API key appears to have been exposed and blocked. Generate a new key in Google AI Studio and keep it server-side only.";
  }

  if (/403|PERMISSION_DENIED|forbidden/i.test(rawMessage)) {
    return "Gemini returned 403 Forbidden. Verify that the key is active, allowed for Gemini API use, and not restricted to a different app or project.";
  }

  if (/429|RESOURCE_EXHAUSTED|quota/i.test(rawMessage)) {
    return "Gemini rate limits or quota were reached. Try again later or review your Gemini API quota in Google AI Studio.";
  }

  if (/404|not found/i.test(rawMessage)) {
    return "The configured Gemini model was not found for this API key. Check GEMINI_MODEL in .env.local and use a currently supported model.";
  }

  return rawMessage;
}

export function isGeminiPermissionError(error) {
  const rawMessage =
    error instanceof Error ? error.message : String(error || "");

  return /403|PERMISSION_DENIED|forbidden|API_KEY_INVALID|API key not found|invalid api key/i.test(
    rawMessage
  );
}
