function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function hasPattern(text, pattern) {
  return pattern.test(text);
}

function countPattern(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function detectSections(text) {
  return {
    contact: hasPattern(text, /@|linkedin|github|portfolio|phone|mobile/i),
    summary: hasPattern(text, /\b(summary|profile|objective)\b/i),
    experience: hasPattern(text, /\b(experience|employment|work history|internship)\b/i),
    education: hasPattern(text, /\b(education|university|college|bachelor|master|degree)\b/i),
    skills: hasPattern(text, /\b(skills|technologies|tools|tech stack|competencies)\b/i),
    projects: hasPattern(text, /\b(projects?|portfolio|case study)\b/i),
    certifications: hasPattern(text, /\b(certifications?|certificate|licensed)\b/i),
  };
}

function collectStrengths(text, sections, quantifiedCount, keywordHits) {
  const strengths = [];

  if (sections.contact) strengths.push("Contains contact or portfolio details.");
  if (sections.experience) strengths.push("Includes an experience section.");
  if (sections.skills) strengths.push("Lists skills or technologies explicitly.");
  if (sections.education) strengths.push("Includes education credentials.");
  if (sections.projects) strengths.push("Mentions projects or portfolio work.");
  if (quantifiedCount > 0) strengths.push("Uses measurable results or numeric details.");
  if (keywordHits >= 6) strengths.push("Contains a healthy spread of common resume keywords.");

  return unique(strengths).slice(0, 4);
}

function collectWeaknesses(sections, quantifiedCount, keywordHits, wordCount) {
  const weaknesses = [];

  if (!sections.summary) weaknesses.push("Missing a clear professional summary.");
  if (!sections.skills) weaknesses.push("Skills section is missing or hard to identify.");
  if (!sections.projects) weaknesses.push("Projects or work samples are not clearly highlighted.");
  if (quantifiedCount === 0) weaknesses.push("Few or no quantified achievements were detected.");
  if (keywordHits < 4) weaknesses.push("Resume may be light on ATS-friendly keywords.");
  if (wordCount < 180) weaknesses.push("Resume content looks shorter than a typical full resume.");

  return unique(weaknesses).slice(0, 4);
}

function collectMissingKeywords(text) {
  const candidateKeywords = [
    "leadership",
    "collaboration",
    "communication",
    "analysis",
    "ownership",
    "strategy",
    "impact",
    "optimization",
    "stakeholders",
    "delivery",
    "performance",
    "automation",
  ];

  return candidateKeywords.filter((keyword) => !text.includes(keyword)).slice(0, 6);
}

function buildSuggestions(sections, quantifiedCount, missingKeywords) {
  const suggestions = [];

  if (!sections.summary) {
    suggestions.push("Add a short summary tailored to the role you want.");
  }
  if (!sections.skills) {
    suggestions.push("Create a dedicated skills section with tools, languages, and platforms.");
  }
  if (quantifiedCount === 0) {
    suggestions.push("Add numbers, percentages, timelines, or scale to show impact.");
  }
  if (missingKeywords.length > 0) {
    suggestions.push(`Consider weaving in relevant keywords such as ${missingKeywords.slice(0, 3).join(", ")}.`);
  }
  if (!sections.projects) {
    suggestions.push("Highlight one or two projects with outcomes and responsibilities.");
  }

  return suggestions.slice(0, 4).join(" ");
}

export function buildLocalResumeAnalysis(resumeText) {
  const normalizedText = String(resumeText || "");
  const lowered = normalizedText.toLowerCase();
  const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
  const quantifiedCount = countPattern(
    normalizedText,
    /\b\d+%|\b\d+\+|\$\d+|\b\d+\s*(years|months|users|clients|projects)\b/gi
  );

  const keywordLibrary = [
    "javascript",
    "typescript",
    "react",
    "node",
    "python",
    "sql",
    "api",
    "aws",
    "docker",
    "leadership",
    "communication",
    "analysis",
  ];

  const keywordHits = keywordLibrary.filter((keyword) => lowered.includes(keyword)).length;
  const sections = detectSections(normalizedText);
  const sectionCount = Object.values(sections).filter(Boolean).length;
  const missingKeywords = collectMissingKeywords(lowered);

  let atsScore = 35;
  atsScore += sectionCount * 8;
  atsScore += quantifiedCount > 0 ? 10 : -6;
  atsScore += wordCount >= 220 ? 8 : -4;
  atsScore += keywordHits >= 5 ? 8 : 0;
  atsScore = clamp(atsScore, 25, 92);

  const skillMatch = clamp(Math.round((keywordHits / keywordLibrary.length) * 100), 20, 90);
  const strengths = collectStrengths(lowered, sections, quantifiedCount, keywordHits);
  const weaknesses = collectWeaknesses(sections, quantifiedCount, keywordHits, wordCount);

  return {
    atsScore,
    skillMatch,
    missingKeywords,
    summary: `Local fallback analysis detected ${sectionCount} core resume sections and ${quantifiedCount} quantified achievement references across about ${wordCount} words.`,
    suggestions: buildSuggestions(sections, quantifiedCount, missingKeywords),
    strengths,
    weaknesses,
  };
}
