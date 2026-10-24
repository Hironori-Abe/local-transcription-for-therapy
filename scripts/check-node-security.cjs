'use strict';

// CVE-2026-111497: npm packages cannot patch Node's bundled Brotli decoder.
const minimums = { 22: [23, 4], 24: [22, 1], 26: [12, 1] };

function isSupportedPatchedNode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  const minimum = minimums[major];
  return Boolean(minimum && (minor > minimum[0] ||
    (minor === minimum[0] && patch >= minimum[1])));
}

if (require.main === module && !isSupportedPatchedNode(process.versions.node)) {
  console.error(`Node.js ${process.versions.node} is not supported. ` +
    'CVE-2026-111497: install Node.js 22.23.4+, 24.22.1+, or 26.12.1+ ' +
    '(within the same major release) before installing dependencies, developing, or building LoTT.');
  process.exitCode = 1;
}

module.exports = { isSupportedPatchedNode };
