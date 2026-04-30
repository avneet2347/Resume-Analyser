import {
  generateJsonWithGemini,
  getGeminiApiKey,
  getGeminiConfigErrorMessage,
  getGeminiErrorDetails,
  getGeminiModelName,
} from "@/server/gemini";
import { parseJsonText } from "@/server/json";

export const runtime = "nodejs";

function normalizeEvaluation(parsed) {
  return {
    overallScore: Number(parsed.overallScore) || 0,
    categoryScores: {
      communication: Number(parsed.categoryScores?.communication) || 0,
      technical: Number(parsed.categoryScores?.technical) || 0,
      problemSolving: Number(parsed.categoryScores?.problemSolving) || 0,
      leadership: Number(parsed.categoryScores?.leadership) || 0,
    },
    feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
    detailedFeedback: Array.isArray(parsed.detailedFeedback)
      ? parsed.detailedFeedback
      : [],
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    recommendations:
      typeof parsed.recommendations === "string" ? parsed.recommendations : "",
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

    const { jobRole, questions, answers } = await request.json();
    const trimmedJobRole = String(jobRole || "").trim();

    if (!trimmedJobRole || !Array.isArray(questions) || !Array.isArray(answers)) {
      return Response.json(
        { error: "Job role, questions, and answers are required." },
        { status: 400 }
      );
    }

    if (questions.length !== answers.length) {
      return Response.json(
        { error: "Number of questions and answers must match." },
        { status: 400 }
      );
    }

    const qaText = questions
      .map(
        (question, index) =>
          `Question ${index + 1}: ${question}\nAnswer: ${answers[index]}`
      )
      .join("\n\n");

    const prompt = `You are an expert interviewer and career coach. Evaluate the following interview responses for a ${trimmedJobRole} role:

${qaText}

Return ONLY valid JSON:
{"overallScore": number, "categoryScores": {"communication": number, "technical": number, "problemSolving": number, "leadership": number}, "feedback": "string", "detailedFeedback": ["string"], "strengths": ["string"], "improvements": ["string"], "recommendations": "string"}`;

    let responseText = "";
    let modelName = getGeminiModelName();

    try {
      const result = await generateJsonWithGemini(prompt);
      responseText = result.text;
      modelName = result.modelName;
    } catch (error) {
      return Response.json(
        {
          error: "Failed to evaluate answers with Gemini.",
          details: getGeminiErrorDetails(error),
          model: modelName,
          raw: error instanceof Error ? error.message : "Unknown Gemini error",
        },
        { status: 500 }
      );
    }

    return Response.json(normalizeEvaluation(parseJsonText(responseText)));
  } catch (error) {
    console.error("Answer evaluation error:", error);
    return Response.json(
      {
        error: "Failed to evaluate answers.",
        details: error instanceof Error ? error.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}
