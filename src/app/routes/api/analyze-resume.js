import { POST as analyzeResume } from "../../api/analyzeResume/route.js";

export const runtime = "nodejs";

export async function action({ request }) {
  return analyzeResume(request);
}
