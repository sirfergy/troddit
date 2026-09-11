import type { NextApiRequest, NextApiResponse } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import packageInfo from "../../../package.json";
import { buildId, buildRevision } from "../../../lib/diagnostics";

export default async function handler(request: NextApiRequest, response: NextApiResponse) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }
  const nonce: unknown = request.body?.nonce;
  if (typeof nonce !== "string" || !/^[a-f0-9]{32}$/.test(nonce)) {
    response.status(400).json({ error: "INVALID_CHALLENGE" });
    return;
  }
  try {
    const id = process.env.NODE_ENV === "development"
      ? "development"
      : buildId((await readFile(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim());
    if (!id) throw new Error("Build ID unavailable");
    response.status(200).json({
      nonce, buildId: id, version: packageInfo.version,
      revision: buildRevision(process.env.NEXT_PUBLIC_BUILD_REVISION),
    });
  } catch {
    console.error("Build metadata is unavailable");
    response.status(503).json({ error: "BUILD_METADATA_UNAVAILABLE" });
  }
}
