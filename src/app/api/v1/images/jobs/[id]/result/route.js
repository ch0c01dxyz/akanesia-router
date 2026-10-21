import { handleImageJob } from "@/sse/handlers/imageJobs.js";

export async function GET(request, { params }) {
  return handleImageJob(request, { id: (await params).id, result: true });
}
