// Тесты логики лиги: node test_league.js
const assert = require('assert');
const L = require('./public/league.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('✓ ' + name);
}

const ev = (team, scorer, assist, own) => ({ team, scorer: scorer || null, assist: assist || null, own: !!own });

// Маленькая лига: 1 тур, 3 команды по 2 игрока, 3 матча
function smallLeague() {
  return {
    name: 'Тест', teamNames: { ...L.DEFAULT_TEAM_NAMES },
    players: [{ name: 'А1', gk: true }, { name: 'А2' }, { name: 'Б1' }, { name: 'Б2' }, { name: 'В1' }, { name: 'В2' }],
    tours: [{
      id: 't1', date: '2026-10-01',
      teams: { R: ['А1', 'А2'], B: ['Б1', 'Б2'], G: ['В1', 'В2'] },
      matches: [
        { id: 'm1', a: 'R', b: 'B', events: [ev('R', 'А2', 'А1'), ev('R', 'А2'), ev('B', 'Б1')] }, // 2:1 R
        { id: 'm2', a: 'R', b: 'G', events: [] },                                                // 0:0
        { id: 'm3', a: 'B', b: 'G', events: [ev('G', 'Б2', null, true)] },                       // автогол, 0:1 G
      ],
    }],
  };
}

test('matchScore считает голы по событиям', () => {
  assert.deepStrictEqual(L.matchScore({ a: 'R', b: 'B', events: [ev('R'), ev('B'), ev('R')] }), { a: 2, b: 1 });
  assert.deepStrictEqual(L.matchScore({ a: 'R', b: 'B' }), { a: 0, b: 0 });
});

test('таблица тура: очки команд и порядок', () => {
  const s = L.computeStats(smallLeague());
  const st = s.tourInfo.t1.standings.map((x) => [x.key, x.pts, x.gf, x.ga]);
  assert.deepStrictEqual(st, [['R', 4, 2, 1], ['G', 4, 1, 0], ['B', 0, 1, 3]]);
});

test('очки игрока = очки его команды в сыгранных матчах', () => {
  const s = L.computeStats(smallLeague());
  const a2 = s.byName['А2'];
  assert.strictEqual(a2.games, 2);
  assert.strictEqual(a2.pts, 4);
  assert.strictEqual(a2.goals, 2);
  assert.strictEqual(s.byName['А1'].assists, 1);
  assert.strictEqual(s.byName['Б2'].goals, 0, 'автогол не идёт в зачёт бомбардиров');
  assert.strictEqual(s.byName['Б2'].ownGoals, 1);
  assert.strictEqual(s.byName['В1'].cs, 2, 'два сухих матча у зелёных');
});

test('MVP тура — по баллам 2г+2п+2в+н+сухие', () => {
  const s = L.computeStats(smallLeague());
  const mvp = s.tourInfo.t1.mvp;
  // А2: 2 гола (4) + победа (2) + ничья (1) + сухой (1) = 8
  assert.strictEqual(mvp.name, 'А2');
  assert.strictEqual(mvp.score, 8);
});

test('общая таблица отсортирована по очкам и разнице мячей', () => {
  const s = L.computeStats(smallLeague());
  assert.deepStrictEqual(s.list.slice(0, 2).map((p) => p.name).sort(), ['А1', 'А2']);
  assert.ok(s.list.every((p, i) => i === 0 || s.list[i - 1].pts >= p.pts));
  assert.strictEqual(s.list[0].pos, 1);
});

test('фильтр по месяцу', () => {
  const lg = smallLeague();
  lg.tours.push({ id: 't2', date: '2026-11-05', teams: { R: ['А1'], B: ['Б1'] }, matches: [{ id: 'x', a: 'R', b: 'B', events: [ev('B', 'Б1')] }] });
  assert.deepStrictEqual(L.monthsOf(lg), ['2026-11', '2026-10']);
  const nov = L.computeStats(lg, '2026-11');
  assert.strictEqual(nov.tours.length, 1);
  assert.strictEqual(nov.byName['Б1'].pts, 3);
  assert.strictEqual(nov.byName['А2'], undefined);
});

test('стрелки изменения позиции появляются со второго тура', () => {
  const lg = smallLeague();
  let s = L.computeStats(lg);
  assert.ok(s.list.every((p) => p.prevPos === null));
  lg.tours.push({ id: 't2', date: '2026-10-08', teams: { R: ['Б1', 'Б2'], B: ['А1', 'А2'] },
    matches: [
      { id: 'y', a: 'R', b: 'B', events: [ev('R', 'Б1'), ev('R', 'Б1'), ev('R', 'Б2')] },
      { id: 'z', a: 'R', b: 'B', events: [ev('R', 'Б1')] },
    ] });
  s = L.computeStats(lg);
  const b1 = s.byName['Б1'];
  assert.ok(b1.prevPos > b1.pos, 'Б1 поднялся в таблице');
});

test('MVP месяца — только за завершённые месяцы', () => {
  const lg = smallLeague();
  assert.strictEqual(L.monthMVPs(lg, '2026-10-20').length, 0);
  const mm = L.monthMVPs(lg, '2026-11-02');
  assert.strictEqual(mm.length, 1);
  assert.strictEqual(mm[0].month, '2026-10');
  assert.strictEqual(mm[0].player.name, 'А2');
});

test('рейтинг в пределах 50–99, вратарь отмечен', () => {
  const s = L.computeStats(L.demoLeague('2026-11-09'));
  assert.ok(s.list.every((p) => p.rating >= 50 && p.rating <= 99));
  assert.ok(s.list.some((p) => p.gk));
  Object.values(s.list[0].radar).forEach((v) => assert.ok(v >= 0 && v <= 100));
});

test('ротация: первый матч — первые две команды', () => {
  const t = { teams: { R: [], B: [], G: [] }, matches: [] };
  assert.deepStrictEqual(L.nextPair(t).pair, ['R', 'B']);
});

test('ротация: победитель остаётся, ждущая команда выходит', () => {
  const t = { teams: { R: [], B: [], G: [] }, matches: [{ a: 'R', b: 'B', events: [ev('B')] }] };
  assert.deepStrictEqual(L.nextPair(t).pair, ['B', 'G']);
});

test('ротация: больше двух матчей подряд нельзя', () => {
  const t = { teams: { R: [], B: [], G: [] }, matches: [
    { a: 'R', b: 'B', events: [ev('B')] },
    { a: 'B', b: 'G', events: [ev('B')] }, // B выиграл второй раз подряд, но уходит
  ] };
  assert.deepStrictEqual(L.nextPair(t).pair, ['G', 'R']);
});

test('ротация: ничья — решает организатор', () => {
  const t = { teams: { R: [], B: [], G: [] }, matches: [{ a: 'R', b: 'B', events: [] }] };
  const n = L.nextPair(t);
  assert.deepStrictEqual(n.draw, ['R', 'B']);
  assert.strictEqual(n.waiting, 'G');
});

test('ротация: две команды играют друг с другом', () => {
  const t = { teams: { R: [], B: [] }, matches: [{ a: 'R', b: 'B', events: [] }] };
  assert.deepStrictEqual(L.nextPair(t).pair, ['R', 'B']);
});

test('подбор составов: все игроки распределены, команды почти равны', () => {
  const names = Array.from({ length: 14 }, (_, i) => 'P' + i);
  const rating = (n) => 50 + Number(n.slice(1)) * 3;
  const gk = (n) => n === 'P0' || n === 'P1';
  const { teams } = L.balanceTeams(names, 3, rating, gk, L.seededRng(7));
  const all = Object.values(teams).flat().sort();
  assert.deepStrictEqual(all, [...names].sort());
  const sizes = Object.values(teams).map((t) => t.length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
  const avgs = Object.values(teams).map((t) => t.reduce((s, n) => s + rating(n), 0) / t.length);
  assert.ok(Math.max(...avgs) - Math.min(...avgs) < 6, 'средние рейтинги близки');
  const gks = Object.values(teams).map((t) => t.filter(gk).length);
  assert.ok(Math.max(...gks) <= 1, 'вратари в разных командах');
});

test('переименование меняет имя везде', () => {
  const lg = L.renamePlayer(smallLeague(), 'А2', 'Артём');
  assert.ok(lg.players.some((p) => p.name === 'Артём'));
  assert.ok(lg.tours[0].teams.R.includes('Артём'));
  assert.strictEqual(lg.tours[0].matches[0].events[0].scorer, 'Артём');
  assert.strictEqual(L.computeStats(lg).byName['Артём'].goals, 2);
  assert.throws(() => L.renamePlayer(smallLeague(), 'А2', 'Б1'));
});

test('демо-лига собирается и считается', () => {
  const d = L.demoLeague('2026-11-09');
  assert.strictEqual(d.tours.length, 8);
  const s = L.computeStats(d);
  assert.ok(s.list.length >= 10);
  assert.ok(s.links.length > 0);
});

console.log(`\n✅ Все ${passed} тестов прошли!`);
