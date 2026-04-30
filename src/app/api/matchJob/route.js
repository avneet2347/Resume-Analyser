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

function normalizeMatchAnalysis(analysis) {
  return {
    matchPercentage: Number(analysis.matchPercentage) || 0,
    experienceMatch: Number(analysis.experienceMatch) || 0,
    roleAlignment: Number(analysis.roleAlignment) || 0,
    matchedKeywords: Array.isArray(analysis.matchedKeywords)
      ? analysis.matchedKeywords
      : [],
    missingKeywords: Array.isArray(analysis.missingKeywords)
      ? analysis.missingKeywords
      : [],
    skillGaps: Array.isArray(analysis.skillGaps) ? analysis.skillGaps : [],
    recommendations:
      typeof analysis.recommendations === "string"
        ? analysis.recommendations
        : "",
    jobTitle:
      typeof analysis.jobTitle === "string"
        ? analysis.jobTitle
        : "Job Matching Analysis",
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
    const jobDescription = String(formData.get("jobDescription") || "").trim();

    if (!jobDescription) {
      return Response.json(
        { error: "Job description is required." },
        { status: 400 }
      );
    }

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

    const matchPrompt = `
You are an expert job-matching specialist. Compare the candidate's resume with the job description.

Resume:
${resumeText}

Job Description:
${jobDescription}

Return only valid JSON with the following structure:
{
  "matchPercentage": number,
  "experienceMatch": number,
  "roleAlignment": number,
  "matchedKeywords": ["string"],
  "missingKeywords": ["string"],
  "skillGaps": ["string"],
  "recommendations": "string",
  "jobTitle": "string"
}
`;

    let responseText = "";
    let modelName = getGeminiModelName();

    try {
      const result = await generateJsonWithGemini(matchPrompt);
      responseText = result.text;
      modelName = result.modelName;
    } catch (error) {
      return Response.json(
        {
          error: "Failed to analyze the job match with Gemini.",
          details: getGeminiErrorDetails(error),
          model: modelName,
          raw: error instanceof Error ? error.message : "Unknown Gemini error",
        },
        { status: 500 }
      );
    }

    return Response.json(normalizeMatchAnalysis(parseJsonText(responseText)));
  } catch (error) {
    console.error("Job matching error:", error);
    return Response.json(
      {
        error: "Failed to analyze the job match.",
        details: error instanceof Error ? error.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}
