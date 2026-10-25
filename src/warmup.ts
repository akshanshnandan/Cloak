import { SemanticModel } from './model.ts';
import { LocalPlanner } from './planner.ts';
const model = new SemanticModel('.cache/models', () => console.log(model.status.message, model.status.progress + '%'));
const planner = new LocalPlanner('.cache', () => console.log(planner.status.message, planner.status.progress + '%'));
try {
  await Promise.all([model.embed(['A personal website.']), planner.load()]);
  console.log('Local models downloaded, verified and ready.');
} finally { planner.close(); }
