// typescript-eslint needs the TypeScript compiler API, which TypeScript 7
// (the native Go port) does not ship. Give the typescript-eslint packages
// their own copy of the official TS 6 API package instead of the project's
// TS 7 peer. The project's own `tsc` stays on TS 7.
const TS6 = "npm:@typescript/typescript6@6.0.2";

function needsTs6(name) {
  return (
    name === "typescript-eslint" ||
    name.startsWith("@typescript-eslint/") ||
    name === "ts-api-utils"
  );
}

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (needsTs6(pkg.name) && pkg.peerDependencies?.typescript) {
        delete pkg.peerDependencies.typescript;
        pkg.dependencies = { ...pkg.dependencies, typescript: TS6 };
      }
      return pkg;
    },
  },
};
