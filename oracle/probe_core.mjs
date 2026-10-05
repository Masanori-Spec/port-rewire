/* Transport only: tests send independently authored cases through the public API.
   There are intentionally no parsing, mapping, or expected-result functions. */
import { createPlan, applyPlan, parsePatch, inspectPorts, textFromBytes, receiptText } from '../src/core.mjs';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const request = JSON.parse(raw);
try {
  let result;
  if (request.operation === 'parse') result = parsePatch(request.text);
  else if (request.operation === 'ports') result = inspectPorts(request.text);
  else if (request.operation === 'decode') result = textFromBytes(new Uint8Array(request.bytes));
  else {
    const plan = await createPlan(request.inputs);
    if (request.operation === 'create') result = plan;
    else {
      const chosenPlan = { ...plan, ...request.planOverrides };
      result = await applyPlan({ ...request.inputs, ...request.sourceOverrides, plan: chosenPlan });
      result.plainReceipt = receiptText(result);
    }
  }
  // Parser results contain no cycles, but expose more than these tests need.
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error.code, message: error.message }));
}
