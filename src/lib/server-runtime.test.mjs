import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('server SDK cold-starts with the hosting runtime require-of-ESM restriction', () => {
    const output = execFileSync(process.execPath, [
        '--no-experimental-require-module', '--input-type=module', '-e',
        `import assert from 'node:assert/strict';
         assert.equal(process.features.require_module, false);
         const { getAuth } = await import('firebase-admin/auth');
         const { getFirestore } = await import('firebase-admin/firestore');
         const { getStorage } = await import('firebase-admin/storage');
         for (const service of [getAuth, getFirestore, getStorage]) assert.equal(typeof service, 'function');
         process.stdout.write('cold-start-ok');`,
    ], {
        cwd: fileURLToPath(new URL('../..', import.meta.url)),
        env: { ...process.env, FIREBASE_CLIENT_EMAIL: '', FIREBASE_PRIVATE_KEY: '' },
        encoding: 'utf8', timeout: 30000,
    });
    assert.equal(output, 'cold-start-ok');
});
