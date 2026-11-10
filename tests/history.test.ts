import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { forecastsSettled, historyNow, historyProgress, historyShare, HISTORY_READY, looksLikeHistory, noteHistory } from '../lib/model/history';

const counts = (o: Record<string, [number, number]>) => Object.entries(o).map(([k, [have, total]]): [string, { have: number; total: number }] => [k, { have, total }]);

describe('how much history a host has', () => {
  it('adds up everything counted, and nothing counted means nothing to wait for', () => {
    assert.equal(historyShare([{ have: 10, total: 100 }, { have: 90, total: 100 }]), 0.5);
    assert.equal(historyShare([]), 1);
    // A count can run past its total (a game re-filed under another season, say): it never counts for more than its own part.
    assert.equal(historyShare([{ have: 200, total: 100 }, { have: 0, total: 100 }]), 0.5);
  });

  it('calls forecasts settled from what they lean on, whatever the prop history has got to', () => {
    assert.equal(forecastsSettled(counts({ 'nba:lines': [10, 100], 'nba:boxes': [10, 100], 'nba:props': [1000, 1000] })), false);
    assert.equal(forecastsSettled(counts({ 'nba:lines': [100, 100], 'nba:boxes': [100, 100], 'nba:props': [0, 1000] })), true);
  });

  it("goes by the slowest league: one league's huge finished count can't hide another still far behind", () => {
    // Pooled, this is 94% on file; the NBA alone is 2%.
    assert.equal(forecastsSettled(counts({ 'mlb:lines': [7400, 7400], 'nba:lines': [10, 500] })), false);
    assert.equal(forecastsSettled(counts({ 'mlb:lines': [7400, 7400], 'nba:lines': [300, 500] })), true);
    assert.equal(forecastsSettled([]), true);
  });

  const months = (n: number) => Array.from({ length: n }, (_, i) => `espn-b1-nba-box-2025${String(i + 1).padStart(2, '0')}.json`);

  it("knows stored seasons from anything else in the folder, and from a new host's first few months", () => {
    assert.equal(looksLikeHistory(months(12)), true);
    assert.equal(looksLikeHistory(months(3)), false);
    assert.equal(looksLikeHistory(['ledger', 'movement', 'push-vapid.json', 'espn-nba-injuries.json']), false);
    assert.equal(looksLikeHistory([]), false);
  });

  // In this order: `historyNow` only looks at the disk until the first count comes in, and the counts last the whole process.
  const empty = mkdtemp(path.join(tmpdir(), 'history-empty-'));
  const full = mkdtemp(path.join(tmpdir(), 'history-full-'));
  after(async () => {
    await rm(await empty, { recursive: true, force: true });
    await rm(await full, { recursive: true, force: true });
  });

  it("warns the first visitor to an empty disk, before anything's been counted", async () => {
    const now = await historyNow(await empty);
    assert.deepEqual([now.loading, now.forecastsSettled, now.share], [true, false, 0]);
    assert.equal((await historyNow(path.join(await empty, 'no such folder'))).loading, true);
  });

  it('says nothing on a disk with history, while the first build runs', async () => {
    for (const file of months(12)) await writeFile(path.join(await full, file), '{}');
    const now = await historyNow(await full);
    assert.deepEqual([now.loading, now.forecastsSettled], [false, true]);
  });

  it('trusts the counts once there are some, and keeps the latest for each kind', async () => {
    noteHistory('nba', 'boxes', 10, 100);
    assert.equal((await historyNow(await full)).loading, true);
    noteHistory('nba', 'boxes', 95, 100);
    const after2 = historyProgress();
    assert.equal(after2.loading, false);
    assert.ok(after2.share >= HISTORY_READY);
    assert.equal(after2.kinds['nba:boxes'], '95/100');
    // Counted, so an empty disk no longer changes the answer.
    assert.equal((await historyNow(await empty)).loading, false);
  });
});
