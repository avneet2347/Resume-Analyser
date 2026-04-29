import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function parseJsonText(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("AI response was not valid JSON");
  }
}

export async function POST(request) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return Response.json(
        { error: "AI service not configured. Please check your API key." },
        { status: 500 }
      );
    }

    const { jobRole } = await request.json();

    if (!jobRole || !jobRole.trim()) {
      return Response.json(
        { error: "Job role is required" },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = `You are an expert interviewer. Generate 6-7 interview questions for a "${jobRole}" role.

Return ONLY JSON with no markdown or code blocks:
{"questions": ["question1", "question2", "question3", "question4", "question5", "question6", "question7"]}`;

    let result;
    try {
      result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
        },
      });
    } catch (aiError) {
      console.error("Gemini question generation error:", aiError);
      return Response.json(
        {
          error: "Failed to generate questions with AI.",
          details: aiError.message,
          model: GEMINI_MODEL,
        },
        { status: 500 }
      );
    }

    let parsed;
    try {
      parsed = parseJsonText(result.response.text());
    } catch (err) {
      console.error("AI JSON parse failed:", result.response.text());
      return Response.json(
        { error: "AI returned invalid JSON. Try again.", details: err.message },
        { status: 500 }
      );
    }

    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter((question) => typeof question === "string" && question.trim())
      : [];

    if (questions.length === 0) {
      return Response.json(
        { error: "AI did not return any usable questions." },
        { status: 500 }
      );
    }

    return Response.json({ questions });
  } catch (error) {
    console.error("Question generation error:", error);
    return Response.json(
      { error: "Failed to generate questions", details: error.message },
      { status: 500 }
    );
  }
}
