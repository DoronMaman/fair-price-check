// Prints the DataQualityReport for the bundled CSV: `npm run data:report -w @fpc/api`
import { loadDataset } from '../data/loadDataset.js';

const { report } = loadDataset();
console.log(JSON.stringify(report, null, 2));
