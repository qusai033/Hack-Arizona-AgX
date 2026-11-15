import { evaluate, analyze } from '../frontend/engine/index.js';
let content='';
for await(const chunk of process.stdin)content+=chunk;
try {
  const input=JSON.parse(content);
  console.log(JSON.stringify(process.argv.includes('--diagnostics')?analyze(input):evaluate(input),null,2));
}catch(error){console.error(`Invalid JSON: ${error.message}`);process.exitCode=1;}
