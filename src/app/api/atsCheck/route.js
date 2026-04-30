import { extractResumeTextFromFile } from "@/server/document-parser";
import {
  generateJsonWithGemini,
  getGeminiApiKey,
  getGeminiConfigErrorMessage,
  getGeminiErrorDetails,
  getGeminiModelName,
} from "@/server/gemini";
import { parseJsonText } from "@/server/json";

export const runtime = "nodejs";

function normalizeAtsAnalysis(analysis) {
  return {
    atsScore: Number(analysis.atsScore) || 0,
    passabilityScore: Number(analysis.passabilityScore) || 0,
    overallRating:
      typeof analysis.overallRating === "string"
        ? analysis.overallRating
        : "Needs Improvement",
    strengths: Array.isArray(analysis.strengths) ? analysis.strengths : [],
    weaknesses: Array.isArray(analysis.weaknesses) ? analysis.weaknesses : [],
    formatting:
      analysis.formatting && typeof analysis.formatting === "object"
        ? {
            score: Number(analysis.formatting.score) || 0,
            issues: Array.isArray(analysis.formatting.issues)
              ? analysis.formatting.issues
              : [],
          }
        : { score: 0, issues: [] },
    keywords:
      analysis.keywords && typeof analysis.keywords === "object"
        ? {
            score: Number(analysis.keywords.score) || 0,
            analysis:
              typeof analysis.keywords.analysis === "string"
                ? analysis.keywords.analysis
                : "",
          }
        : { score: 0, analysis: "" },
    sections:
      analysis.sections && typeof analysis.sections === "object"
        ? {
            score: Number(analysis.sections.score) || 0,
            analysis:
              typeof analysis.sections.analysis === "string"
                ? analysis.sections.analysis
                : "",
          }
        : { score: 0, analysis: "" },
    recommendations:
      typeof analysis.recommendations === "string"
        ? analysis.recommendations
        : "",
  };
}

export async function POST(request) {
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

    const atsPrompt = `
You are an ATS (Applicant Tracking System) specialist. Analyze the following resume for ATS compatibility and provide a comprehensive assessment.

Resume Text:
${resumeText}

Please analyze and return ONLY valid JSON with this exact structure:
{
  "atsScore": number,
  "passabilityScore": number,
  "overallRating": "Excellent|Good|Needs Improvement",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "formatting": { "score": number, "issues": ["string"] },
  "keywords": { "score": number, "analysis": "string" },
  "sections": { "score": number, "analysis": "string" },
  "recommendations": "string"
}
Respond only with JSON.
`;

    let responseText = "";
    let modelName = getGeminiModelName();

    try {
      const result = await generateJsonWithGemini(atsPrompt);
      responseText = result.text;
      modelName = result.modelName;
    } catch (error) {
      return Response.json(
        {
          error: "Failed to check ATS compatibility with Gemini.",
          details: getGeminiErrorDetails(error),
          model: modelName,
          raw: error instanceof Error ? error.message : "Unknown Gemini error",
        },
        { status: 500 }
      );
    }

    return Response.json(normalizeAtsAnalysis(parseJsonText(responseText)));
  } catch (error) {
    console.error("ATS check error:", error);
    return Response.json(
      {
        error: "Failed to check ATS compatibility.",
        details: error instanceof Error ? error.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}
