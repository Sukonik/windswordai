import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../fixtures/demo.json", import.meta.url), "utf8");
const forbidden = [
  /attorney-client privileged/i,
  /social security/i,
  /password\s*[:=]/i,
  /api[_ -]?key\s*[:=]/i,
  /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/i,
];

for (const pattern of forbidden) {
  if (pattern.test(raw)) {
    console.error(`Demo fixture failed safety check: ${pattern}`);
    process.exit(1);
  }
}
console.log("Synthetic demo fixture safety check passed.");
