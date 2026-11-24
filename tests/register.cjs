// Compile the real server modules in Node's test runner. No production loader is changed.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const originalLoad = Module._load;
Module._load = function(request, parent, main) {
  if (request === 'server-only') return {};
  if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
  return originalLoad.call(this, request, parent, main);
};
require.extensions['.ts'] = function(module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  }, fileName: filename});
  module._compile(output.outputText, filename);
};
