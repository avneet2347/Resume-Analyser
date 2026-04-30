import {
  generateJsonWithGemini,
  getGeminiApiKey,
  getGeminiConfigErrorMessage,
  getGeminiErrorDetails,
  getGeminiModelName,
} from "@/server/gemini";
import { parseJsonText } from "@/server/json";

export const runtime = "nodejs";

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

    const { jobRole } = await request.json();
    const trimmedJobRole = String(jobRole || "").trim();

    if (!trimmedJobRole) {
      return Response.json({ error: "Job role is required." }, { status: 400 });
    }

    const prompt = `You are an expert interviewer. Generate 6-7 interview questions for a "${trimmedJobRole}" role.

Return ONLY JSON with no markdown or code blocks:
{"questions": ["question1", "question2", "question3", "question4", "question5", "question6", "question7"]}`;

    let responseText = "";
    let modelName = getGeminiModelName();

    try {
      const result = await generateJsonWithGemini(prompt, { temperature: 0.4 });
      responseText = result.text;
      modelName = result.modelName;
    } catch (error) {
      return Response.json(
        {
          error: "Failed to generate interview questions with Gemini.",
          details: getGeminiErrorDetails(error),
          model: modelName,
          raw: error instanceof Error ? error.message : "Unknown Gemini error",
        },
        { status: 500 }
      );
    }

    const parsed = parseJsonText(responseText);
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter(
          (question) => typeof question === "string" && question.trim()
        )
      : [];

    if (questions.length === 0) {
      return Response.json(
        { error: "Gemini did not return any usable interview questions." },
        { status: 500 }
      );
    }

    return Response.json({ questions });
  } catch (error) {
    console.error("Question generation error:", error);
    return Response.json(
      {
        error: "Failed to generate interview questions.",
        details: error instanceof Error ? error.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}
