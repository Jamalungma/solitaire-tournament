// Логика футбольной лиги: таблица, MVP, рейтинги, ротация команд, подбор составов.
// Здесь нет работы со страницей, поэтому всё можно проверять тестами в Node.js.
//
// Формат данных лиги:
// {
//   name: 'Название лиги', season: '2026',
//   teamNames: { R: 'Красные', B: 'Синие', G: 'Зелёные', Y: 'Жёлтые' },
//   players: [{ name: 'Иван', gk: false }],
//   tours: [{
//     id: 't1', date: '2026-11-08',
//     teams: { R: ['Иван', ...], B: [...] },
//     matches: [{ id: 'm1', a: 'R', b: 'B', len: 420,
//       events: [{ team: 'R', scorer: 'Иван', assist: 'Пётр', own: false, ms: 61000 }] }]
//   }]
// }
// Счёт матча не хранится отдельно, а считается по голам (events).
// team в событии — команда, которой засчитан гол. own: true — автогол (scorer из соперников).

(function (root) {
  'use strict';

  const TEAM_KEYS = ['R', 'B', 'G', 'Y'];
  const DEFAULT_TEAM_NAMES = { R: 'Красные', B: 'Синие', G: 'Зелёные', Y: 'Жёлтые' };
  const TEAM_COLORS = { R: '#ef4444', B: '#3b82f6', G: '#22c55e', Y: '#eab308' };
  const MAX_STREAK = 2; // сколько матчей подряд команда может играть при 3+ командах

  function emptyLeague() {
    return { name: 'Моя лига', season: '', teamNames: { ...DEFAULT_TEAM_NAMES }, players: [], tours: [] };
  }

  function teamName(league, key) {
    return (league && league.teamNames && league.teamNames[key]) || DEFAULT_TEAM_NAMES[key] || key;
  }

  function matchScore(m) {
    let a = 0, b = 0;
    (m.events || []).forEach((e) => {
      if (e.team === m.a) a++;
      else if (e.team === m.b) b++;
    });
    return { a, b };
  }

  function sortedTours(league) {
    return [...(league.tours || [])].sort((x, y) => x.date.localeCompare(y.date) || String(x.id).localeCompare(String(y.id)));
  }

  function monthsOf(league) {
    return [...new Set((league.tours || []).map((t) => t.date.slice(0, 7)))].sort().reverse();
  }

  // Сравнение игроков в общей таблице: очки, разница мячей, победы, имя
  function cmpPlayers(a, b) {
    return b.pts - a.pts || b.gd - a.gd || b.w - a.w || a.name.localeCompare(b.name, 'ru');
  }

  // Баллы игрока за тур (для MVP): 2 за гол, 2 за пас, 2 за победу, 1 за ничью, 1 за сухой матч
  function mvpScore(x) {
    return 2 * x.goals + 2 * x.assists + 2 * x.w + x.d + x.cs;
  }

  function percentile(values, v, lowerIsBetter) {
    if (!values.length) return 50;
    let below = 0, equal = 0;
    values.forEach((x) => {
      if (x === v) equal++;
      else if (lowerIsBetter ? x > v : x < v) below++;
    });
    return Math.round((100 * (below + equal / 2)) / values.length);
  }

  // Главный расчёт. period: 'all' или 'YYYY-MM'
  function computeStats(league, period) {
    period = period || 'all';
    const gkSet = new Set((league.players || []).filter((p) => p.gk).map((p) => p.name));
    const tours = sortedTours(league).filter((t) => period === 'all' || t.date.slice(0, 7) === period);

    const P = {};
    const player = (name) => P[name] || (P[name] = {
      name, games: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, cs: 0, goals: 0, assists: 0, ownGoals: 0,
      tours: 0, history: [], gk: gkSet.has(name),
    });
    const pairs = {};
    const links = {};
    const tourInfo = {};

    tours.forEach((t, ti) => {
      const keys = Object.keys(t.teams || {});
      const team = {};
      keys.forEach((k) => { team[k] = { key: k, games: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }; });
      const inTour = {}; // name -> статистика за тур
      const tp = (name, key) => inTour[name] || (inTour[name] = { name, key, games: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, cs: 0, goals: 0, assists: 0 });
      const pairTour = {};

      (t.matches || []).forEach((m) => {
        const s = matchScore(m);
        [[m.a, s.a, s.b], [m.b, s.b, s.a]].forEach(([k, f, c]) => {
          const r = team[k];
          if (!r) return;
          r.games++; r.gf += f; r.ga += c;
          if (f > c) r.w++; else if (f === c) r.d++; else r.l++;
          const roster = (t.teams[k] || []);
          roster.forEach((n) => {
            const x = tp(n, k);
            x.games++; x.gf += f; x.ga += c;
            if (f > c) x.w++; else if (f === c) x.d++; else x.l++;
            if (c === 0) x.cs++;
          });
          for (let i = 0; i < roster.length; i++) {
            for (let j = i + 1; j < roster.length; j++) {
              const [a, b] = [roster[i], roster[j]].sort();
              const key = a + '|' + b;
              const x = pairTour[key] || (pairTour[key] = { a, b, games: 0, w: 0, d: 0, l: 0 });
              x.games++;
              if (f > c) x.w++; else if (f === c) x.d++; else x.l++;
            }
          }
        });
        (m.events || []).forEach((e) => {
          if (!e.scorer) return;
          if (e.own) { player(e.scorer).ownGoals++; return; }
          const key = keys.find((k) => (t.teams[k] || []).includes(e.scorer)) || e.team;
          tp(e.scorer, key).goals++;
          player(e.scorer).goals++;
          if (e.assist) {
            tp(e.assist, key).assists++;
            player(e.assist).assists++;
            const lk = e.assist + '→' + e.scorer;
            links[lk] = links[lk] || { from: e.assist, to: e.scorer, count: 0 };
            links[lk].count++;
          }
        });
      });

      const standings = Object.values(team)
        .map((r) => ({ ...r, pts: 3 * r.w + r.d, gd: r.gf - r.ga }))
        .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || keys.indexOf(a.key) - keys.indexOf(b.key));
      const place = {};
      standings.forEach((s, i) => { place[s.key] = i + 1; });

      const players = Object.values(inTour).map((x) => ({ ...x, place: place[x.key], pts: 3 * x.w + x.d, score: mvpScore(x) }));
      players.sort((a, b) => b.score - a.score || b.goals - a.goals || b.assists - a.assists || a.place - b.place || a.name.localeCompare(b.name, 'ru'));

      players.forEach((x) => {
        const p = player(x.name);
        ['games', 'w', 'd', 'l', 'gf', 'ga', 'cs'].forEach((f) => { p[f] += x[f]; });
        if (x.games) p.tours++;
        p.history.push({ tourId: t.id, date: t.date, key: x.key, place: x.place, teams: keys.length, pts: x.pts, goals: x.goals, assists: x.assists, score: x.score });
      });

      Object.values(pairTour).forEach((x) => {
        const key = x.a + '|' + x.b;
        const y = pairs[key] || (pairs[key] = { a: x.a, b: x.b, games: 0, w: 0, d: 0, l: 0 });
        y.games += x.games; y.w += x.w; y.d += x.d; y.l += x.l;
      });

      tourInfo[t.id] = { standings, players, mvp: players[0] || null };

      // Позиция каждого игрока в таблице после этого тура (для стрелочек ▲▼)
      Object.values(P)
        .filter((p) => p.games > 0)
        .map((p) => ({ ...p, pts: 3 * p.w + p.d, gd: p.gf - p.ga }))
        .sort(cmpPlayers)
        .forEach((p, i) => { P[p.name].rankAfter = P[p.name].rankAfter || []; P[p.name].rankAfter[ti] = i + 1; });
    });

    const list = Object.values(P).filter((p) => p.games > 0);
    list.forEach((p) => {
      p.pts = 3 * p.w + p.d;
      p.gd = p.gf - p.ga;
      p.winPct = (100 * p.w) / p.games;
      p.ppg = p.pts / p.games;
      p.gfPg = p.gf / p.games;
      p.gaPg = p.ga / p.games;
      p.goalsPg = p.goals / p.games;
      p.assistsPg = p.assists / p.games;
      p.contribPg = (p.goals + p.assists) / p.games;
      p.csPct = (100 * p.cs) / p.games;
    });
    list.sort(cmpPlayers);
    list.forEach((p, i) => {
      p.pos = i + 1;
      const r = p.rankAfter || [];
      const last = r.length - 1;
      p.prevPos = last >= 1 && r[last - 1] != null && r[last] != null ? r[last - 1] : null;
    });

    // Рейтинг: проценты относительно игроков с достаточным числом игр
    const maxGames = Math.max(1, ...list.map((p) => p.games));
    const minGames = Math.max(1, Math.min(10, Math.ceil(maxGames * 0.3)));
    const regular = list.filter((p) => p.games >= minGames);
    const vals = (f) => regular.map(f);
    const metric = {
      attack: vals((x) => x.gfPg), defense: vals((x) => x.gaPg), goals: vals((x) => x.goalsPg),
      passes: vals((x) => x.assistsPg), wins: vals((x) => x.winPct), points: vals((x) => x.ppg),
    };
    list.forEach((p) => {
      p.radar = {
        attack: percentile(metric.attack, p.gfPg),
        defense: percentile(metric.defense, p.gaPg, true),
        goals: percentile(metric.goals, p.goalsPg),
        passes: percentile(metric.passes, p.assistsPg),
        wins: percentile(metric.wins, p.winPct),
        points: percentile(metric.points, p.ppg),
      };
      const r = p.radar;
      const avg = p.gk
        ? (r.attack + 2 * r.defense + r.wins + r.points) / 5
        : (r.attack + r.defense + (r.goals + r.passes) / 2 + r.wins + r.points) / 5;
      p.rating = Math.round(50 + avg * 0.49);
      p.smallSample = p.games < minGames;
    });

    const pairList = Object.values(pairs).map((x) => ({ ...x, ppg: (3 * x.w + x.d) / x.games }));
    const linkList = Object.values(links).sort((a, b) => b.count - a.count || a.from.localeCompare(b.from, 'ru'));
    const byName = {};
    list.forEach((p) => { byName[p.name] = p; });

    return { period, tours, list, byName, tourInfo, pairs: pairList, links: linkList, minGames };
  }

  // MVP завершённых месяцев (today — 'YYYY-MM-DD'); текущий месяц ещё идёт и не считается
  function monthMVPs(league, today) {
    const cur = (today || new Date().toISOString()).slice(0, 7);
    return monthsOf(league)
      .filter((m) => m < cur)
      .map((m) => {
        const s = computeStats(league, m);
        const top = [...s.list].sort((a, b) => b.history.reduce((x, h) => x + h.score, 0) - a.history.reduce((x, h) => x + h.score, 0) || cmpPlayers(a, b))[0];
        return top ? { month: m, player: top, score: top.history.reduce((x, h) => x + h.score, 0) } : null;
      })
      .filter(Boolean);
  }

  // Ротация при 3-4 командах: проигравший уходит, победитель остаётся,
  // но не больше MAX_STREAK матчей подряд. Ничья — организатор решает сам.
  function nextPair(tour, matches) {
    matches = matches || tour.matches || [];
    const keys = Object.keys(tour.teams || {});
    if (keys.length < 2) return null;
    if (!matches.length) return { pair: [keys[0], keys[1]] };
    const last = matches[matches.length - 1];
    if (keys.length === 2) return { pair: [last.a, last.b] };

    const lastPlayed = (k) => {
      for (let i = matches.length - 1; i >= 0; i--) if (matches[i].a === k || matches[i].b === k) return i;
      return -1;
    };
    const streak = (k) => {
      let c = 0;
      for (let i = matches.length - 1; i >= 0 && (matches[i].a === k || matches[i].b === k); i--) c++;
      return c;
    };
    const waiting = keys
      .filter((k) => k !== last.a && k !== last.b)
      .sort((x, y) => lastPlayed(x) - lastPlayed(y) || keys.indexOf(x) - keys.indexOf(y))[0];

    const sa = streak(last.a), sb = streak(last.b);
    if (sa >= MAX_STREAK && sb < MAX_STREAK) return { pair: [last.b, waiting] };
    if (sb >= MAX_STREAK && sa < MAX_STREAK) return { pair: [last.a, waiting] };
    if (sa >= MAX_STREAK && sb >= MAX_STREAK) return { pair: [sa <= sb ? last.a : last.b, waiting] };
    const s = matchScore(last);
    if (s.a > s.b) return { pair: [last.a, waiting] };
    if (s.b > s.a) return { pair: [last.b, waiting] };
    return { draw: [last.a, last.b], waiting };
  }

  // Несколько следующих пар (до первой ничьей, где нужен выбор)
  function upcomingPairs(tour, count) {
    const ms = [...(tour.matches || [])];
    const out = [];
    for (let i = 0; i < count; i++) {
      const n = nextPair(tour, ms);
      if (!n || !n.pair) break;
      out.push(n.pair);
      // будущий результат неизвестен — считаем, что первая команда пары выиграет 1:0
      ms.push({ a: n.pair[0], b: n.pair[1], events: [{ team: n.pair[0] }] });
    }
    return out;
  }

  // Подбор равных составов. ratingOf(name) -> число, isGk(name) -> bool
  function balanceTeams(names, k, ratingOf, isGk, rng) {
    rng = rng || Math.random;
    const keys = TEAM_KEYS.slice(0, k);
    const sizes = keys.map((_, i) => Math.floor(names.length / k) + (i < names.length % k ? 1 : 0));
    const build = (arr) => {
      const T = {};
      let o = 0;
      keys.forEach((key, i) => { T[key] = arr.slice(o, o + sizes[i]); o += sizes[i]; });
      return T;
    };
    const cost = (T) => {
      const avgs = keys.map((key) => T[key].reduce((s, n) => s + ratingOf(n), 0) / Math.max(1, T[key].length));
      const gks = keys.map((key) => T[key].filter(isGk).length);
      return (Math.max(...avgs) - Math.min(...avgs)) + 15 * (Math.max(...gks) - Math.min(...gks));
    };
    let best = null;
    for (let run = 0; run < 25; run++) {
      let arr = [...names];
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      let c = cost(build(arr));
      for (let it = 0; it < 300; it++) {
        const a = Math.floor(rng() * arr.length), b = Math.floor(rng() * arr.length);
        if (a === b) continue;
        const next = [...arr];
        [next[a], next[b]] = [next[b], next[a]];
        const nc = cost(build(next));
        if (nc <= c) { arr = next; c = nc; }
      }
      if (!best || c < best.cost) best = { teams: build(arr), cost: c };
    }
    return best || { teams: build(names), cost: 0 };
  }

  // Переименование игрока во всех турах и матчах
  function renamePlayer(league, from, to) {
    to = String(to || '').trim();
    if (!to || from === to) return league;
    if ((league.players || []).some((p) => p.name === to)) throw new Error('Игрок с таким именем уже есть');
    const r = (n) => (n === from ? to : n);
    return {
      ...league,
      players: league.players.map((p) => (p.name === from ? { ...p, name: to } : p)),
      tours: league.tours.map((t) => ({
        ...t,
        teams: Object.fromEntries(Object.entries(t.teams).map(([k, v]) => [k, v.map(r)])),
        matches: t.matches.map((m) => ({
          ...m,
          events: (m.events || []).map((e) => ({ ...e, scorer: e.scorer && r(e.scorer), assist: e.assist && r(e.assist) })),
        })),
      })),
    };
  }

  // Детерминированный генератор случайных чисел (для демо и тестов)
  function seededRng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // Демо-данные, чтобы посмотреть, как выглядит сайт
  function demoLeague(today) {
    const rng = seededRng(42);
    const names = ['Артём', 'Илья', 'Макс', 'Денис', 'Саша К.', 'Саша П.', 'Влад', 'Никита', 'Рома', 'Женя',
      'Олег', 'Тимур', 'Паша', 'Кирилл', 'Гоша', 'Лёша'];
    const skill = {};
    names.forEach((n) => { skill[n] = 0.3 + rng() * 0.7; });
    const league = { name: 'Лига четвергов', season: 'Осень 2026', teamNames: { ...DEFAULT_TEAM_NAMES },
      players: names.map((n) => ({ name: n, gk: n === 'Олег' || n === 'Тимур' || n === 'Гоша' })), tours: [] };
    const end = new Date((today || new Date().toISOString()).slice(0, 10) + 'T12:00:00Z');
    for (let w = 7; w >= 0; w--) {
      const d = new Date(end.getTime() - w * 7 * 864e5);
      const date = d.toISOString().slice(0, 10);
      const present = names.filter(() => rng() > 0.15).slice(0, 15);
      const k = 3;
      const { teams } = balanceTeams(present, k, (n) => skill[n] * 100, (n) => ['Олег', 'Тимур', 'Гоша'].includes(n), rng);
      const tour = { id: 't' + date, date, teams, matches: [] };
      const count = 7 + Math.floor(rng() * 4);
      for (let i = 0; i < count; i++) {
        const n = nextPair(tour);
        const pair = n.pair || (rng() > 0.5 ? [n.draw[0], n.waiting] : [n.draw[1], n.waiting]);
        const m = { id: tour.id + 'm' + i, a: pair[0], b: pair[1], len: 420, events: [] };
        pair.forEach((key) => {
          const roster = teams[key];
          const power = roster.reduce((s, p) => s + skill[p], 0) / roster.length;
          const goals = Math.floor(rng() * 3.2 * power + rng() * 0.8);
          for (let g = 0; g < goals; g++) {
            const pick = () => roster[Math.floor(rng() * roster.length)];
            const scorer = pick();
            let assist = rng() > 0.4 ? pick() : null;
            if (assist === scorer) assist = null;
            m.events.push({ team: key, scorer, assist, own: false, ms: Math.floor(rng() * 420000) });
          }
        });
        m.events.sort((x, y) => x.ms - y.ms);
        tour.matches.push(m);
      }
      league.tours.push(tour);
    }
    return league;
  }

  const api = {
    TEAM_KEYS, DEFAULT_TEAM_NAMES, TEAM_COLORS, MAX_STREAK,
    emptyLeague, teamName, matchScore, sortedTours, monthsOf, computeStats, monthMVPs, mvpScore,
    nextPair, upcomingPairs, balanceTeams, renamePlayer, seededRng, demoLeague, percentile,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.League = api;
})(typeof window !== 'undefined' ? window : globalThis);
