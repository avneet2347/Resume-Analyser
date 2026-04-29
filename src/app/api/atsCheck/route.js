import mammoth from "mammoth";
import PDFParser from "pdf2json";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// ---------------- Safe decoder for pdf2json strings ----------------
function safeDecode(str) {
  try {
    return decodeURIComponent(str || "");
  } catch {
    try {
      return decodeURIComponent((str || "").replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
    } catch {
      return str || "";
    }
  }
}

// ---------------- PDF extraction using pdf2json (robust) ----------------
function extractPdfText(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();

    parser.on("pdfParser_dataError", (err) => {
      reject(err);
    });

    parser.on("pdfParser_dataReady", (pdfData) => {
      try {
        let text = "";

        const pages =
          pdfData?.formImage?.Pages ||
          pdfData?.Pages ||
          [];

        pages.forEach((page) => {
          if (!page.Texts) return;
          page.Texts.forEach((t) => {
            if (!t.R) return;
            t.R.forEach((r) => {
              // r.T may be URL-encoded text fragments
              text += safeDecode(r.T || "") + " ";
            });
          });
        });

        resolve(text.trim());
      } catch (err) {
        reject(err);
      }
    });

    parser.parseBuffer(buffer);
  });
}

// ---------------- Helper: robustly parse Gemini response ----------------
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

function normalizeAtsAnalysis(analysis) {
  return {
    atsScore: Number(analysis.atsScore) || 0,
    passabilityScore: Number(analysis.passabilityScore) || 0,
    overallRating:
      typeof analysis.overallRating === "string" ? analysis.overallRating : "Needs Improvement",
    strengths: Array.isArray(analysis.strengths) ? analysis.strengths : [],
    weaknesses: Array.isArray(analysis.weaknesses) ? analysis.weaknesses : [],
    formatting:
      analysis.formatting && typeof analysis.formatting === "object"
        ? {
            score: Number(analysis.formatting.score) || 0,
            issues: Array.isArray(analysis.formatting.issues) ? analysis.formatting.issues : [],
          }
        : { score: 0, issues: [] },
    keywords:
      analysis.keywords && typeof analysis.keywords === "object"
        ? {
            score: Number(analysis.keywords.score) || 0,
            analysis: typeof analysis.keywords.analysis === "string" ? analysis.keywords.analysis : "",
          }
        : { score: 0, analysis: "" },
    sections:
      analysis.sections && typeof analysis.sections === "object"
        ? {
            score: Number(analysis.sections.score) || 0,
            analysis: typeof analysis.sections.analysis === "string" ? analysis.sections.analysis : "",
          }
        : { score: 0, analysis: "" },
    recommendations:
      typeof analysis.recommendations === "string" ? analysis.recommendations : "",
  };
}

async function parseGeminiJsonResponse(geminiResp) {
  try {

    if (geminiResp?.response?.text) {
      const txt = await geminiResp.response.text();
      return parseJsonText(txt);
    }
    if (typeof geminiResp === "string") {
      return parseJsonText(geminiResp);
    }

    if (typeof geminiResp === "object") {
      
      if (
        geminiResp.atsScore !== undefined ||
        geminiResp.matchPercentage !== undefined
      ) {
        return geminiResp;
      }

      if (geminiResp.candidates && geminiResp.candidates[0]?.content) {
        const contentParts = geminiResp.candidates[0].content.parts;
        const joined = contentParts.map((p) => p.text || "").join("\n");
        return parseJsonText(joined);
      }

      if (geminiResp.output && typeof geminiResp.output === "string") {
        return parseJsonText(geminiResp.output);
      }

      if (geminiResp.outputs && Array.isArray(geminiResp.outputs) && geminiResp.outputs[0]?.content) {
        const joined = geminiResp.outputs.map(o => (o.content?.[0]?.text || "")).join("\n");
        return parseJsonText(joined);
      }
    }

    throw new Error("Unable to parse Gemini response to JSON");
  } catch (err) {
    throw new Error(`Failed to parse Gemini JSON response: ${err.message}`);
  }
}

// ---------------- Main route ----------------
export async function POST(request) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return Response.json(
        { error: "AI service not configured. Please check your API key." },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];

    if (!allowedTypes.includes(file.type)) {
      return Response.json(
        { error: "Only PDF and DOCX files are supported" },
        { status: 400 }
      );
    }

    // Read file bytes
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract text
    let resumeText = "";
    if (file.type === "application/pdf") {
      try {
        resumeText = await extractPdfText(buffer);
      } catch (err) {
        console.error("PDF extraction error:", err);
        return Response.json({ error: "Failed to extract text from PDF" }, { status: 400 });
      }
    } else {
      
      try {
        const result = await mammoth.extractRawText({ buffer });
        resumeText = result.value || "";
      } catch (err) {
        console.error("DOCX extraction error:", err);
        return Response.json({ error: "Failed to extract text from DOCX" }, { status: 400 });
      }
    }

    if (!resumeText || resumeText.trim().length < 20) {
      return Response.json(
        { error: "Could not extract meaningful text from resume" },
        { status: 400 }
      );
    }

   
    const atsPrompt = `
You are an ATS (Applicant Tracking System) specialist. Analyze the following resume for ATS compatibility and provide a comprehensive assessment.

Resume Text:
${resumeText}

Please analyze and return ONLY valid JSON with this exact structure:
{
  "atsScore": number,                      // 0-100
  "passabilityScore": number,              // 0-100
  "overallRating": "Excellent|Good|Needs Improvement",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "formatting": { "score": number, "issues": ["string"] },
  "keywords": { "score": number, "analysis": "string" },
  "sections": { "score": number, "analysis": "string" },
  "recommendations": "string"
}
Respond only with JSON (no explanation, no markdown).
`;

    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    let geminiResp;
    try {
      geminiResp = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: atsPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      });
    } catch (aiError) {
      console.error("Gemini ATS check error:", aiError);
      return Response.json(
        {
          error: "Failed to check ATS compatibility with AI.",
          details: aiError.message,
          model: GEMINI_MODEL,
        },
        { status: 500 }
      );
    }

    const analysis = normalizeAtsAnalysis(await parseGeminiJsonResponse(geminiResp));

    const requiredFields = [
      "atsScore",
      "passabilityScore",
      "overallRating",
      "strengths",
      "weaknesses",
      "formatting",
      "keywords",
      "sections",
      "recommendations",
    ];
    for (const f of requiredFields) {
      if (analysis[f] === undefined) {
        console.warn(`ATS analysis missing field: ${f}`);
      }
    }

    return Response.json(analysis);
  } catch (err) {
    console.error("ATS check error:", err);
    return Response.json(
      { error: "Failed to check ATS compatibility", details: err.message },
      { status: 500 }
    );
  }
}
