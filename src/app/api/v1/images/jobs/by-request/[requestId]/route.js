import { handleImageJob } from "@/sse/handlers/imageJobs.js";

export async function GET(request, { params }) {
  return handleImageJob(request, { requestId: (await params).requestId });
}
