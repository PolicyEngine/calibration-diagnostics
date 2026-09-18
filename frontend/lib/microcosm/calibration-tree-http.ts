import type { GetBlobResult } from "@vercel/blob";
import { NextResponse } from "next/server";

import { calibrationTreeBlobText } from "./calibration-tree-blob";

function acceptsGzip(request: Request): boolean {
  return (request.headers.get("accept-encoding") ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .some((item) => {
      const [encoding, ...parameters] = item.split(";").map((value) => value.trim());
      if (encoding !== "gzip" && encoding !== "*") return false;
      return !parameters.some((parameter) => /^q=0(?:\.0*)?$/.test(parameter));
    });
}

export async function immutableCalibrationTreePartResponse(
  request: Request,
  result: GetBlobResult,
  headers: Record<string, string>,
): Promise<NextResponse> {
  if (!result.stream) {
    throw new Error("Private Blob response did not contain a stream.");
  }
  const responseHeaders = {
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Accept-Encoding",
  };
  if (acceptsGzip(request)) {
    return new NextResponse(result.stream, {
      status: 200,
      headers: {
        ...responseHeaders,
        "Content-Encoding": "gzip",
      },
    });
  }
  return new NextResponse(await calibrationTreeBlobText(result.stream), {
    status: 200,
    headers: responseHeaders,
  });
}
