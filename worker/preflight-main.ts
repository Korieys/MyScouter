import {workerPreflight} from './preflight';
const deadline=setTimeout(()=>process.exit(1),60000);
workerPreflight().then(report=>{clearTimeout(deadline);console.log(JSON.stringify(report));process.exit(0);}).catch(()=>{clearTimeout(deadline);console.error('capture_worker_iam_preflight_failed');process.exit(1);});
