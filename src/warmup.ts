import { SemanticModel } from './model.ts';
const model = new SemanticModel('.cache/models', () => console.log(model.status.message, model.status.progress + '%'));
await model.embed(['Your internet, tailored to you.']);
console.log('Model downloaded and verified. Cloak is ready to run offline inference.');
