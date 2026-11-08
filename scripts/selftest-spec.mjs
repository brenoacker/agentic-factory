import { spawnSync } from 'node:child_process';

const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
const res = spawnSync(pyCmd, ['skills/vendor/tlc-spec-lean/scripts/selftest.py'], { stdio: 'inherit' });
process.exit(res.status ?? 0);
