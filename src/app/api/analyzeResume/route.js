import { extractResumeTextFromFile } from "@/server/document-parser";
import {
  generateJsonWithGemini,
  getGeminiApiKey,
  getGeminiConfigErrorMessage,
  getGeminiErrorDetails,
  getGeminiModelName,
  isGeminiPermissionError,
} from "@/server/gemini";
import { parseJsonText } from "@/server/json";
import { buildLocalResumeAnalysis } from "@/server/local-resume-analysis";

export const runtime = "nodejs";

function normalizeAnalysis(analysis) {
  return {
    atsScore: Number(analysis.atsScore) || 0,
    skillMatch: Number(analysis.skillMatch) || 0,
    missingKeywords: Array.isArray(analysis.missingKeywords)
      ? analysis.missingKeywords
      : [],
    summary: typeof analysis.summary === "string" ? analysis.summary : "",
    suggestions:
      typeof analysis.suggestions === "string" ? analysis.suggestions : "",
    strengths: Array.isArray(analysis.strengths) ? analysis.strengths : [],
    weaknesses: Array.isArray(analysis.weaknesses) ? analysis.weaknesses : [],
  };
}

export const POST = async (request) => {
  try {
    if (!getGeminiApiKey()) {
      return Response.json(
        {
          error: "AI service not configured.",
          details: getGeminiConfigErrorMessage(),
        },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    let resumeText = "";
    try {
      resumeText = await extractResumeTextFromFile(file);
    } catch (error) {
      return Response.json(
        {
          error: "Failed to read the uploaded resume.",
          details: error instanceof Error ? error.message : "Unknown file parsing error",
        },
        { status: 400 }
      );
    }

    const prompt = `Analyze this resume and return ONLY valid JSON.

Resume content:
${resumeText}

Return JSON:
{
  "atsScore": number,
  "skillMatch": number,
  "missingKeywords": ["string"],
  "summary": "string",
  "suggestions": "string",
  "strengths": ["string"],
  "weaknesses": ["string"]
}`;

    let responseText = "";
    let modelName = getGeminiModelName();

    try {
      const result = await generateJsonWithGemini(prompt);
      responseText = result.text;
      modelName = result.modelName;
    } catch (error) {
      if (isGeminiPermissionError(error)) {
        return Response.json({
          success: true,
          analysis: buildLocalResumeAnalysis(resumeText),
          warning:
            "Gemini rejected the configured API key on localhost, so the app used a local fallback analysis. Add a fresh GEMINI_API_KEY in .env.local for live AI results.",
          provider: "local-fallback",
        });
      }

      return Response.json(
        {
          error: "Failed to analyze the resume with Gemini.",
          details: getGeminiErrorDetails(error),
          model: modelName,
          raw: error instanceof Error ? error.message : "Unknown Gemini error",
        },
        { status: 500 }
      );
    }

    const analysis = normalizeAnalysis(parseJsonText(responseText));

    return Response.json({ success: true, analysis, provider: "gemini" });
  } catch (error) {
    console.error("Resume analysis error:", error);
    return Response.json(
      {
        error: "Server error during resume analysis.",
        details: error instanceof Error ? error.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
};
