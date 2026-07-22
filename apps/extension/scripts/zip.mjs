import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const packageFile = fileURLToPath(new URL("../package.json", import.meta.url));
const { version } = JSON.parse(await readFile(packageFile, "utf8"));
const output = fileURLToPath(new URL(`../prompt-notebook-chrome-${version}.zip`, import.meta.url));
const latestOutput = fileURLToPath(new URL("../prompt-notebook-chrome.zip", import.meta.url));
const files = {};

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else files[relative(root, path).replaceAll("\\", "/")] = new Uint8Array(await readFile(path));
  }
}

await collect(root);
const archive = zipSync(files, { level: 9 });
await Promise.all([writeFile(output, archive), writeFile(latestOutput, archive)]);
console.log(`Created ${output}`);
