// The built dicta-js, served under /dicta/js/; see architecture.md (dicta-js
// files).

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, relative, sep } from "node:path";

export type JsFile = { body: Buffer; etag: string };

// Every .js file in the folder and its subfolders, by its path in the folder
// with "/" between the parts, for example "audio/worklet.js". Empty without the
// folder.
export function loadJsFiles(folder: string): Map<string, JsFile> {
  const files = new Map<string, JsFile>();
  if (!existsSync(folder)) {
    return files;
  }
  for (const entry of readdirSync(folder, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      continue;
    }
    const file = join(entry.parentPath, entry.name);
    const body = readFileSync(file);
    const hash = createHash("sha256").update(body).digest("base64url");
    files.set(relative(folder, file).split(sep).join("/"), {
      body,
      etag: `"${hash}"`,
    });
  }
  return files;
}

// Answers a request for a file: 304 while the client's copy is current, else
// 200 with the file.
export function serveJsFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: JsFile,
): void {
  const headers = {
    "cache-control": "no-cache",
    etag: file.etag,
    "access-control-allow-origin": "*",
  };
  // A proxy may have made the tag weak (W/) or listed several.
  const current = req.headers["if-none-match"]
    ?.split(",")
    .some((tag) => tag.trim().replace(/^W\//, "") === file.etag);
  if (current) {
    res.writeHead(304, headers).end();
  } else {
    res
      .writeHead(200, { ...headers, "content-type": "text/javascript" })
      .end(file.body);
  }
}
