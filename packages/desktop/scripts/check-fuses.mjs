/**
 * Build-workflow hard-check: the packaged binary actually carries the security fuses (002 §11.2).
 *
 * `apply-fuses.mjs` flips them at pack time; this verifies the result, so a build where the hook
 * silently did nothing (a renamed product, an Electron upgrade that moved a fuse, a hand-assembled
 * artifact) fails rather than shipping a binary that can be relaunched as Node. Runs in the
 * packaging workflows against the app in the staging output, not in ordinary CI — there is no
 * packaged binary there.
 *
 *   node packages/desktop/scripts/check-fuses.mjs <path-to-app-or-binary>
 *
 * Exit 0 when every expected fuse matches, 1 with the mismatches printed.
 */
import { getCurrentFuseWire } from "@electron/fuses";

import { diffFuses, interpretFuseWire, EXPECTED_FUSES } from "./security-guards.mjs";

const target = process.argv[2];
if (!target) {
  process.stderr.write("usage: check-fuses.mjs <path-to-.app-or-binary>\n");
  process.exit(2);
}

const wire = await getCurrentFuseWire(target);
const actual = interpretFuseWire(wire);
const mismatches = diffFuses(actual);

if (mismatches.length === 0) {
  const names = Object.keys(EXPECTED_FUSES).join(", ");
  process.stdout.write(`fuse guard: ${target} carries the expected fuses (${names})\n`);
  process.exit(0);
}

process.stderr.write(`fuse guard: ${mismatches.length} fuse(s) wrong in ${target} (002 §11.2):\n`);
for (const mismatch of mismatches) {
  process.stderr.write(
    `  ${mismatch.fuse}: expected ${mismatch.expected}, found ${mismatch.actual}\n`,
  );
}
process.stderr.write(
  "\nThe packaging afterPack hook (apply-fuses.mjs) did not leave the binary hardened. A build " +
    "that ships without these fuses can be relaunched as a bare Node process; do not release it.\n",
);
process.exit(1);
