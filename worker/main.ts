import {runWorker} from './run';
// No provider/DOM errors are printed: they can contain website contents or credentials.
const deadline=setTimeout(()=>{console.error('capture_worker_timeout');process.exit(1);},240000);
runWorker().then(()=>{clearTimeout(deadline);process.exit(0);}).catch(()=>{clearTimeout(deadline);console.error('capture_worker_failed');process.exit(1);});
