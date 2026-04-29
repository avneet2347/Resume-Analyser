import mammoth from "mammoth";
import PDFParser from "pdf2json";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// ----------- SAFE DECODER -----------
function safeDecode(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

// ----------- PDF EXTRACTOR -----------
function extractPdfText(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();

    parser.on("pdfParser_dataError", (err) => reject(err));

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
              text += safeDecode(r.T || "") + " ";
            });
          });
        });

        resolve(text.trim());
      } catch (error) {
        reject(error);
      }
    });

    parser.parseBuffer(buffer);
  });
}

function stripJsonFence(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseMatchJson(responseText) {
  const cleaned = stripJsonFence(responseText);

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

function normalizeMatchAnalysis(analysis) {
  return {
    matchPercentage: Number(analysis.matchPercentage) || 0,
    experienceMatch: Number(analysis.experienceMatch) || 0,
    roleAlignment: Number(analysis.roleAlignment) || 0,
    matchedKeywords: Array.isArray(analysis.matchedKeywords) ? analysis.matchedKeywords : [],
    missingKeywords: Array.isArray(analysis.missingKeywords) ? analysis.missingKeywords : [],
    skillGaps: Array.isArray(analysis.skillGaps) ? analysis.skillGaps : [],
    recommendations: typeof analysis.recommendations === "string" ? analysis.recommendations : "",
    jobTitle: typeof analysis.jobTitle === "string" ? analysis.jobTitle : "Job Matching Analysis",
  };
}

// ----------- MAIN POST ROUTE -----------
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
    const jobDescription = formData.get("jobDescription");

    if (!file || !jobDescription) {
      return Response.json(
        { error: "File and job description are required" },
        { status: 400 }
      );
    }

    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (!allowedTypes.includes(file.type)) {
      return Response.json(
        { error: "Only PDF and DOCX files are supported" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let resumeText = "";

    // ----------- PDF -----------
    if (file.type === "application/pdf") {
      resumeText = await extractPdfText(buffer);
    }

    // ----------- DOCX -----------
    else {
      const result = await mammoth.extractRawText({ buffer });
      resumeText = result.value;
    }

    if (!resumeText || resumeText.length < 20) {
      return Response.json(
        { error: "Could not extract text from resume" },
        { status: 400 }
      );
    }

    // ----------- AI PROMPT -----------
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

    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    let resp;
    try {
      resp = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: matchPrompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      });
    } catch (aiError) {
      console.error("Gemini job matching error:", aiError);
      return Response.json(
        {
          error: "Failed to analyze job match with AI.",
          details: aiError.message,
          model: GEMINI_MODEL,
        },
        { status: 500 }
      );
    }

    const responseText = resp.response.text();
    const analysis = normalizeMatchAnalysis(parseMatchJson(responseText));

    return Response.json(analysis);
  } catch (err) {
    console.error("Job matching error:", err);
    return Response.json(
      {
        error: "Failed to analyze job match.",
        details: err.message,
      },
      { status: 500 }
    );
  }
}
