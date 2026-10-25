const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(process.argv[2] || path.join(root, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const context = vm.createContext({ window: { addEventListener() {} } });
vm.runInContext(script, context);
const api = vm.runInContext('({getPlayerGames, calculatePlayerMetrics, calculatePlayerOpponents, calculatePlayerStats, calculatePairStats})', context);
const plain = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);

// Known results exercise penalties, tied ranks, negative points, skipped tables and term boundaries.
const player = (name, points, rank, finalScore, penalty = 0) => ({ name, points, rank, finalScore, penalty });
const game = players => ({ type: 'game', date: '2026/10/26 00:00:00', players });
const fixture = [
  game([player('A', 40000, 0, 45), player('B', 25000, 1, 10)]),
  game([player('not-seated', 25000, 0, 30)]),
  game([player('A', 26000, 1, -9, -20), player('B', 20000, 1, 5)]),
  { type: 'semesterSwitch', date: '2026/10/26' },
  game([player('A', -1000, 3, -56), player('B', 45000, 0, 50)]),
  game([player('A', 35000, 0, 40), player('B', 5000, 3, -50)])
];
const entries = api.getPlayerGames(fixture, 'A');
assert.deepEqual(plain(entries.map(e => [e.gameNumber, e.semester])), [[1, 1], [3, 1], [4, 2], [5, 2]]);
const metrics = api.calculatePlayerMetrics(entries);
assert.deepEqual(plain(metrics.ranks), [2, 1, 0, 1]);
for (const [key, expected] of Object.entries({
  games: 4, totalScore: 20, totalPenalty: -20, penaltyGames: 1, aboveBase: 3,
  positiveScore: 2, negativePoints: 1, averageRank: 2, averagePoints: 25000,
  averageRawGain: 0, averageScore: 5, averageBaseScore: 10,
  maxPoints: 40000, minPoints: -1000, maxScore: 45, minScore: -56,
  longestFirst: 1, longestTopTwo: 2, longestAvoidFourth: 2
})) near(metrics[key], expected, key);
near(metrics.scoreStdDev, Math.sqrt(1685.5), 'population deviation');
assert.equal(api.calculatePlayerStats(fixture, true).A.totalScore, 2);
assert.equal(api.calculatePlayerMetrics(api.getPlayerGames(fixture, 'A', '1')).totalScore, 36);
assert.equal(api.calculatePlayerMetrics(api.getPlayerGames(fixture, 'A', '2')).totalScore, -16);
assert.deepEqual(plain(api.calculatePlayerOpponents(fixture, 'A')), [{ name: 'B', games: 4, scoreDifference: 5, ahead: 2, behind: 1, tied: 1 }]);
const empty = api.calculatePlayerMetrics(api.getPlayerGames(fixture, 'missing'));
assert.equal(empty.games, 0);
for (const key of ['averageRank', 'averagePoints', 'averageRawGain', 'averageScore', 'scoreStdDev', 'maxScore', 'minPoints']) assert.equal(empty[key], null);
assert.equal(api.calculatePlayerMetrics(entries.slice(0, 1)).scoreStdDev, null);
const exactlyBase = api.calculatePlayerMetrics([{ player: player('A', 25000, 2, 0) }]);
assert.equal(exactlyBase.aboveBase, 0);
assert.equal(exactlyBase.positiveScore, 0);
assert.equal(exactlyBase.negativePoints, 0);

// Build an independent per-player/per-term ledger from the real export.
const records = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8')).records;
const ledger = new Map();
let semester = 1;
let gameNumber = 0;
for (const record of records) {
  if (record.type === 'semesterSwitch') { semester++; continue; }
  gameNumber++;
  for (const p of record.players) {
    if (!ledger.has(p.name)) ledger.set(p.name, []);
    ledger.get(p.name).push({ ...p, semester, gameNumber });
  }
}
assert.equal([...ledger.values()].reduce((total, observations) => total + observations.length, 0), gameNumber * 4);
const pairs = api.calculatePairStats(records);
for (const [name, observations] of ledger) {
  for (const scope of ['all', ...Array.from({ length: semester + 1 }, (_, index) => String(index + 1))]) {
    const expected = observations.filter(p => scope === 'all' || String(p.semester) === scope);
    const actualEntries = api.getPlayerGames(records, name, scope);
    assert.deepEqual(plain(actualEntries.map(e => e.gameNumber)), expected.map(p => p.gameNumber));
    for (const size of [null, 10, 20]) {
      const selected = size ? expected.slice(-size) : expected;
      const actual = api.calculatePlayerMetrics(size ? actualEntries.slice(-size) : actualEntries);
      const n = selected.length;
      assert.equal(actual.games, n);
      assert.deepEqual(plain(actual.ranks), [0, 1, 2, 3].map(rank => selected.filter(p => p.rank === rank).length));
      near(actual.totalScore, selected.reduce((total, p) => total + p.finalScore, 0), `${name} total`);
      if (n) {
        near(actual.averageRank, selected.map(p => p.rank + 1).reduce((a, b) => a + b) / n, `${name} rank`);
        near(actual.averageRawGain, selected.reduce((total, p) => total + p.points - 25000, 0) / n, `${name} raw gain`);
        near(actual.averageScore, selected.reduce((total, p) => total + p.finalScore / n, 0), `${name} score`);
      }
    }
  }
  for (const opponent of api.calculatePlayerOpponents(records, name)) {
    const pair = pairs[JSON.stringify([name, opponent.name])];
    assert.equal(opponent.games, pair.games);
    assert.equal(opponent.ahead + opponent.behind + opponent.tied, pair.games);
    near(opponent.scoreDifference, pair.scoreDifference, `${name} opponent difference`);
  }
}
// Check each marked penalty independently so future imports and added games stay valid.
for (const name of ledger.keys()) {
  for (const entry of api.getPlayerGames(records, name).filter(e => e.player.penalty < 0)) {
    const single = api.calculatePlayerMetrics([entry]);
    near(single.averageScore, entry.player.finalScore, `${name} net score`);
    near(single.averageBaseScore, entry.player.finalScore - entry.player.penalty, `${name} pre-penalty score`);
    near(single.averageRawGain, entry.player.points - 25000, `${name} raw points`);
    assert.equal(single.totalPenalty, entry.player.penalty);
  }
}
console.log(`PASS: known-result fixtures and all ${ledger.size} players across terms/recent windows; penalties, empty/single samples, streaks and opponent differences.`);
