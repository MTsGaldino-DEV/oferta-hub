import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMutex } from './mutex.js';

test('executa uma de cada vez, na ordem que chegou', async () => {
  const lock = createMutex();
  const ordem: number[] = [];
  const tarefa = (n: number, ms: number) =>
    lock(async () => {
      ordem.push(n);
      await new Promise((r) => setTimeout(r, ms));
    });

  await Promise.all([tarefa(1, 30), tarefa(2, 0), tarefa(3, 0)]);
  assert.deepEqual(ordem, [1, 2, 3]);
});

test('erro numa chamada nao trava as proximas', async () => {
  const lock = createMutex();
  await assert.rejects(
    lock(async () => {
      throw new Error('falha');
    }),
  );
  let rodou = false;
  await lock(async () => {
    rodou = true;
  });
  assert.equal(rodou, true);
});
