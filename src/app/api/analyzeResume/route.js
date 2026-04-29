
import mammoth from "mammoth";
import PDFParser from "pdf2json";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// ---------------- SAFE DECODER ----------------
function safeDecode(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return str; // Fallback to raw text to avoid crashes
  }
}

// ---------------- PDF EXTRACTION ----------------
function extractPdfText(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();

    parser.on("pdfParser_dataError", (err) => reject(err));

    parser.on("pdfParser_dataReady", (pdfData) => {
      try {
        let text = "";

        // Handle all possible PDF2JSON structures
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

function parseAnalysisJson(responseText) {
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

function normalizeAnalysis(analysis) {
  return {
    atsScore: Number(analysis.atsScore) || 0,
    skillMatch: Number(analysis.skillMatch) || 0,
    missingKeywords: Array.isArray(analysis.missingKeywords) ? analysis.missingKeywords : [],
    summary: typeof analysis.summary === "string" ? analysis.summary : "",
    suggestions: typeof analysis.suggestions === "string" ? analysis.suggestions : "",
    strengths: Array.isArray(analysis.strengths) ? analysis.strengths : [],
    weaknesses: Array.isArray(analysis.weaknesses) ? analysis.weaknesses : [],
  };
}

export const POST = async (request) => {
  try {
    console.log("=== Analyze Resume API ===");
    console.log("1. Checking API key...");
    
    if (!process.env.GEMINI_API_KEY) {
      console.log("ERROR: No API key found");
      return Response.json(
        { error: "AI service not configured. Please check your API key." },
        { status: 500 }
      );
    }
    console.log("✓ API key present");

    console.log("2. Parsing form data...");
    let formData;
    try {
      formData = await request.formData();
    } catch (parseError) {
      console.error("ERROR parsing formData:", parseError);
      return Response.json(
        { error: "Failed to parse uploaded file", details: parseError.message },
        { status: 400 }
      );
    }
    
    const file = formData.get("file");
    console.log("3. File received:", file ? `${file.name} (${file.type})` : "No file");

    if (!file) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    console.log("4. Converting file to buffer...");
    let buffer;
    try {
      buffer = Buffer.from(await file.arrayBuffer());
    } catch (bufferError) {
      console.error("ERROR creating buffer:", bufferError);
      return Response.json(
        { error: "Failed to process file", details: bufferError.message },
        { status: 400 }
      );
    }
    console.log("✓ Buffer created, size:", buffer.length);

    console.log("5. Extracting text...");
    let extractedText = "";

    try {
      // PDF Handling
      if (file.type === "application/pdf") {
        console.log("  → Processing PDF...");
        extractedText = await extractPdfText(buffer);
      }
      // DOCX Handling
      else if (
        file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        console.log("  → Processing DOCX...");
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value;
      } else {
        console.log("  → Unknown file type:", file.type);
        return Response.json(
          { error: "Unsupported file type. Please upload PDF or DOCX." },
          { status: 400 }
        );
      }
    } catch (extractError) {
      console.error("ERROR extracting text:", extractError);
      return Response.json(
        { error: "Failed to extract text from file", details: extractError.message },
        { status: 400 }
      );
    }

    console.log("✓ Text extracted, length:", extractedText.length);

    if (!extractedText || extractedText.trim().length < 20) {
      return Response.json(
        { error: "Could not extract text from resume" },
        { status: 400 }
      );
    }

    console.log("6. Calling Gemini AI...");
    const prompt = `Analyze this resume and return ONLY valid JSON.

Resume content:
${extractedText}

Return exactly this JSON:
{
  "atsScore": number (0-100),
  "skillMatch": number (0-100),
  "missingKeywords": ["string"],
  "summary": "string",
  "suggestions": "string",
  "strengths": ["string"],
  "weaknesses": ["string"]
}`;

    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    console.log("  → Sending request to Gemini...");
    let aiResponse;
    try {
      aiResponse = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      });
    } catch (aiError) {
      console.error("ERROR calling Gemini:", aiError);
      return Response.json(
        {
          error: "Failed to analyze resume with AI",
          details: aiError.message,
          model: GEMINI_MODEL,
        },
        { status: 500 }
      );
    }

    if (!aiResponse || !aiResponse.response) {
      console.error("ERROR: No response from AI service");
      throw new Error("No response from AI service");
    }

    const responseText = aiResponse.response.text();
    console.log("✓ AI response received, parsing JSON...");
    
    if (!responseText) {
      throw new Error("Empty response from AI service");
    }

    let analysis;
    try {
      analysis = normalizeAnalysis(parseAnalysisJson(responseText));
    } catch (parseError) {
      console.error("ERROR parsing AI response:", parseError, "Response:", responseText);
      return Response.json(
        {
          error: "Invalid AI response format",
          details: parseError.message,
          responsePreview: responseText.slice(0, 500),
        },
        { status: 500 }
      );
    }

    console.log("✓ Analysis complete");
    return Response.json({ success: true, analysis });
  } catch (err) {
    console.error("=== UNEXPECTED ERROR ===", err);
    return Response.json(
      { error: "Server error during analysis", details: err.message },
      { status: 500 }
    );
  }
}
