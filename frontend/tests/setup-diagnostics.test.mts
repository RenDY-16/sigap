import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRuntime, checkDatabaseVersion, describeSetupError } from '../scripts/setup-diagnostics.mts';
test('supported runtime and photographed npm version', () => {
 assert.doesNotThrow(() => checkRuntime('22.2.1', 'npm/10.5.1'));
 assert.throws(() => checkRuntime('22.2.1', 'npm/9.2.0'), /npm terlalu lama/);
 assert.throws(() => checkRuntime('20.19.0', 'npm/10.5.1'), /Node.js terlalu lama/);
});
test('reject Oracle MySQL before MariaDB DDL', () => {
 assert.throws(() => checkDatabaseVersion('8.0.43-0ubuntu0.24.04.1'), /bukan MariaDB/);
 assert.doesNotThrow(() => checkDatabaseVersion('5.5.5-10.4.32-MariaDB'));
 assert.doesNotThrow(() => checkDatabaseVersion('11.4.5-MariaDB'));
 assert.throws(() => checkDatabaseVersion('10.3.39-MariaDB'), /terlalu lama/);
});
test('errors are actionable without driver secrets', () => {
 const secret = 'mysql://private-user:private-password@localhost/sigap';
 for (const code of ['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ECONNREFUSED', 'UNEXPECTED']) {
  const text = describeSetupError({code, message:secret, sql:secret}, 'migrasi database');
  assert.ok(!text.includes(secret));
 }
 assert.match(describeSetupError({code:'ER_ACCESS_DENIED_ERROR'}, 'koneksi'), /Login database ditolak/);
 assert.match(describeSetupError({code:'ECONNREFUSED'}, 'koneksi'), /Nyalakan MariaDB/);
});
