// The built dicta-js, served under /dicta/js/; see architecture.md (dicta-js
// files).

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
