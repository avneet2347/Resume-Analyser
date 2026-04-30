# AI Resume Analyser

## Description
AI Resume Analyser is a web application that helps job seekers analyze, improve, and optimize their resumes. It supports resume analysis, ATS checking, job matching, and mock interview preparation using Gemini-powered server APIs with a local fallback for resume analysis during Gemini key failures.

## Features
- AI-based resume analysis
- ATS compatibility checking
- Job description matching
- Mock interview question generation
- Mock interview answer evaluation
- Local storage for recent results
- Responsive UI with dark mode support

## Tech Stack
- Frontend: React, React Router, Tailwind CSS, Vite
- Backend: Node.js route handlers
- AI Integration: Gemini API
- Document Parsing: `pdf-parse`, `pdf2json`, `mammoth`

## Environment Setup
Create a `.env.local` file in the project root with:

```env
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-2.5-flash
AUTH_SECRET=your_random_secret
```

Notes:

- Use a fresh Gemini API key from Google AI Studio.
- Do not expose the API key in client-side variables such as `VITE_GEMINI_API_KEY`.
- Restart the dev server after changing env values.

## How to Run Locally
1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm run dev
```

3. Open the app in your browser:

`http://localhost:4000`

## Supported Resume Formats
- PDF
- DOCX

## Project Highlights
- Shared server-side Gemini helper for consistent model usage
- Centralized resume parsing for PDF and DOCX files
- Local fallback analysis when Gemini access fails on localhost
- Cleaner error messages for invalid or blocked Gemini keys

## Author
Jaykishor Singh

GitHub: https://github.com/Jaybyte01
