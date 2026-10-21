import { handleImageJob } from "@/sse/handlers/imageJobs.js";

export async function POST(request) {
  return handleImageJob(request);
}
