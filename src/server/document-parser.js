import mammoth from "mammoth";
import PDFParser from "pdf2json";
import { PDFParse } from "pdf-parse";

const PDF_MIME_TYPE = "application/pdf";
const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME_TYPE = "application/msword";
const MIN_EXTRACTED_TEXT_LENGTH = 20;

export const SUPPORTED_RESUME_EXTENSIONS = ".pdf,.docx";
export const SUPPORTED_RESUME_FILE_MESSAGE =
  "Only PDF and DOCX resumes are supported.";

function normalizeExtractedText(text) {
  return String(text || "")
    .replace(/\u0000/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text || "");
  } catch {
    try {
      return decodeURIComponent(
        String(text || "").replace(/%(?![0-9A-Fa-f]{2})/g, "%25")
      );
    } catch {
      return String(text || "");
    }
  }
}

function detectResumeFileType(file) {
  const mimeType = String(file?.type || "").toLowerCase();
  const fileName = String(file?.name || "").toLowerCase();

  if (mimeType === PDF_MIME_TYPE || fileName.endsWith(".pdf")) {
    return "pdf";
  }

  if (mimeType === DOCX_MIME_TYPE || fileName.endsWith(".docx")) {
    return "docx";
  }

  if (mimeType === DOC_MIME_TYPE || fileName.endsWith(".doc")) {
    return "doc";
  }

  return null;
}

function ensureMeaningfulText(text, fileTypeLabel) {
  const cleaned = normalizeExtractedText(text);

  if (cleaned.length < MIN_EXTRACTED_TEXT_LENGTH) {
    throw new Error(`Could not extract meaningful text from the ${fileTypeLabel} file.`);
  }

  return cleaned;
}

async function extractPdfTextWithPdfParse(buffer) {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText({ pageJoiner: "\n" });
    return ensureMeaningfulText(result.text, "PDF");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function extractPdfTextWithPdf2Json(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();

    parser.on("pdfParser_dataError", (error) => {
      reject(error instanceof Error ? error : new Error("pdf2json failed to parse the PDF."));
    });

    parser.on("pdfParser_dataReady", (pdfData) => {
      try {
        const pages = pdfData?.formImage?.Pages || pdfData?.Pages || [];
        const text = pages
          .flatMap((page) => page?.Texts || [])
          .flatMap((textBlock) => textBlock?.R || [])
          .map((run) => safeDecode(run?.T || ""))
          .join(" ");

        resolve(ensureMeaningfulText(text, "PDF"));
      } catch (error) {
        reject(error);
      }
    });

    parser.parseBuffer(buffer);
  });
}

async function extractPdfText(buffer) {
  const attempts = [];

  try {
    return await extractPdfTextWithPdfParse(buffer);
  } catch (error) {
    attempts.push(error instanceof Error ? error.message : "pdf-parse failed");
  }

  try {
    return await extractPdfTextWithPdf2Json(buffer);
  } catch (error) {
    attempts.push(error instanceof Error ? error.message : "pdf2json failed");
  }

  throw new Error(
    `Failed to read the PDF resume. ${attempts.join(" ")}`
  );
}

async function extractDocxText(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return ensureMeaningfulText(result.value, "DOCX");
}

export function validateResumeFile(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("No file uploaded.");
  }

  const fileType = detectResumeFileType(file);

  if (fileType === "doc") {
    throw new Error(
      "Legacy .doc files are not supported. Please convert the resume to PDF or DOCX."
    );
  }

  if (!fileType) {
    throw new Error(SUPPORTED_RESUME_FILE_MESSAGE);
  }

  return fileType;
}

export async function extractResumeTextFromFile(file) {
  const fileType = validateResumeFile(file);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (fileType === "pdf") {
    return await extractPdfText(buffer);
  }

  return await extractDocxText(buffer);
}
