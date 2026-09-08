// D-12: the public barrel. Phase 4's runner (and anything else consuming this package
// in-process) imports from here rather than reaching into individual src/ modules directly.
export { analyzeSql, loadDefaultRules } from "./analyze";
export { loadRules } from "./classifier/classify";
export * from "./types";
