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
    detailedFeedback: Array.isArray(parsed.detailedFeedback) ? parsed.detailedFeedback : [],
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    recommendations: typeof parsed.recommendations === "string" ? parsed.recommendations : "",
  };
}

export async function POST(request) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return Response.json(
        { error: "AI service not configured. Please check your API key." },
        { status: 500 }
      );
    }

    const { jobRole, questions, answers } = await request.json();

    if (!jobRole || !questions || !answers) {
      return Response.json(
        { error: "Job role, questions, and answers are required" },
        { status: 400 }
      );
    }

    if (questions.length !== answers.length) {
      return Response.json(
        { error: "Number of questions and answers must match" },
        { status: 400 }
      );
    }

    const qaText = questions
      .map(
        (q, i) => `Question ${i + 1}: ${q}\nAnswer: ${answers[i]}`
      )
      .join("\n\n");

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = `You are an expert interviewer and career coach. Evaluate the following interview responses for a ${jobRole} role:

${qaText}

Return ONLY valid JSON:
{"overallScore": number, "categoryScores": {"communication": number, "technical": number, "problemSolving": number, "leadership": number}, "feedback": "string", "detailedFeedback": ["string"], "strengths": ["string"], "improvements": ["string"], "recommendations": "string"}`;

    let result;
    try {
      result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      });
    } catch (aiError) {
      console.error("Gemini answer evaluation error:", aiError);
      return Response.json(
        {
          error: "Failed to evaluate answers with AI.",
          details: aiError.message,
          model: GEMINI_MODEL,
        },
        { status: 500 }
      );
    }

    let parsed;
    try {
      parsed = normalizeEvaluation(parseJsonText(result.response.text()));
    } catch (err) {
      console.error("AI JSON parse failed:", result.response.text());
      return Response.json(
        { error: "AI returned invalid JSON", details: err.message },
        { status: 500 }
      );
    }

    return Response.json(parsed);
  } catch (error) {
    console.error("Answer evaluation error:", error);
    return Response.json(
      { error: "Failed to evaluate answers. Please try again.", details: error.message },
      { status: 500 }
    );
  }
}
