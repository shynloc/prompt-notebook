import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const source = fileURLToPath(new URL("../assets/icon-source.svg", import.meta.url));
const output = fileURLToPath(new URL("../public/icons/", import.meta.url));
await mkdir(output, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp(source).resize(size, size).png().toFile(`${output}/icon-${size}.png`);
}
console.log("Rendered Chrome extension icons");
