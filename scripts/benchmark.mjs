import { performance } from 'node:perf_hooks';
import { evaluate } from '../frontend/engine/index.js';
import { example } from '../frontend/demo.js';
for(let i=0;i<1000;i++)evaluate(example);
const samples=Array.from({length:10000},()=>{const start=performance.now();evaluate(example);return performance.now()-start;}).sort((a,b)=>a-b);
console.log(JSON.stringify({iterations:samples.length,median_ms:samples[5000],p95_ms:samples[9500],max_ms:samples.at(-1),note:'Local wall-clock measurements, not zero latency or a real-time deadline guarantee. No network calls.'},null,2));
