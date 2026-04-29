
import mammoth from "mammoth";
import PDFParser from "pdf2json";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

export async function action({ request, params }) {
  try {
    console.log("API called - checking API key");
    if (!process.env.GEMINI_API_KEY) {
      console.log("No API key found");
      return Response.json(
        { error: "AI service not configured. Please check your API key." },
        { status: 500 }
      );
    }

    console.log("API key found, processing form data");
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      console.log("No file uploaded");
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    console.log("File received:", file.name, file.type);

    // Simple test response without AI processing
    return Response.json({
      success: true,
      analysis: {
        atsScore: 85,
        skillMatch: 80,
        missingKeywords: ["JavaScript", "React"],
        summary: "Test analysis - file received successfully",
        suggestions: "This is a test response",
        strengths: ["Good format"],
        weaknesses: ["Needs more keywords"]
      }
    });
  } catch (err) {
    console.error("Analysis Error:", err);
    return Response.json(
      { error: "Server error during analysis", details: err.message },
      { status: 500 }
    );
  }
}
