// Интерфейс футбольной лиги. Расчёты лежат в league.js (window.League).
(function () {
  'use strict';

  const LG = window.League;
  const $ = (s) => document.querySelector(s);
  const view = $('#view');

  /* ---------- Хранилище браузера (может быть недоступно) ---------- */
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* нет доступа */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* нет доступа */ } },
  };

  /* ---------- Состояние ---------- */
  const S = {
    data: null, version: 0, live: null, editable: false,
    pwd: store.get('fl-pwd'),
    period: 'all',
    cache: {},
    playerSort: 'rating', search: '',
    expanded: {},
    draft: null,      // черновик нового тура / составов
    goal: null,       // черновик гола в шторке
  };
  const isEditor = () => !!S.pwd;

  /* ---------- Форматирование ---------- */
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const AVATAR_COLORS = ['#ffd23f', '#ffb4a2', '#b8e0d2', '#c3b8ff', '#ffd6a5', '#a0d2ff', '#e4c1f9', '#caffbf', '#ffc6e0', '#d4e09b'];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (s) => { const d = parseDate(s); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`; };
  const fmtWeekday = (s) => WEEKDAYS[parseDate(s).getDay()];
  const fmtMonth = (m) => MONTHS[Number(m.slice(5, 7)) - 1] + (m.slice(0, 4) !== todayStr().slice(0, 4) ? ' ' + m.slice(0, 4) : '');
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  };
  const nWord = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`;
  const fix1 = (x) => (Math.round(x * 10) / 10).toLocaleString('ru-RU');
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const colorFor = (s) => {
    let h = 2166136261;
    for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    h ^= h >>> 15;
    return AVATAR_COLORS[(h >>> 0) % AVATAR_COLORS.length];
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const isGk = (name) => !!(S.data.players.find((p) => p.name === name) || {}).gk;

  const tn = (k) => LG.teamName(S.data, k);
  const dot = (k) => `<span class="team-dot" style="background:var(--${k})"></span>`;
  const avatar = (name, size) => `<span class="ava ${size || ''}" style="background:${colorFor(name)}">${esc(initials(name))}${isGk(name) ? '<span class="gk" title="Вратарь">🧤</span>' : ''}</span>`;
  const playerHref = (name) => '#/player/' + enc(name);
  const icon = (id) => `<svg class="icon"><use href="#i-${id}"/></svg>`;

  /* ---------- Статистика (с кэшем) ---------- */
  function stats(period) {
    period = period || S.period;
    if (!S.cache[period]) S.cache[period] = LG.computeStats(S.data, period);
    return S.cache[period];
  }
  const allStats = () => stats('all');
  function invalidate() { S.cache = {}; }
  const ratingFor = (name) => {
    const p = allStats().byName[name];
    if (!p) return 60;
    return p.smallSample ? (p.rating + 60) / 2 : p.rating;
  };

  /* ---------- Сервер ---------- */
  async function api(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (S.pwd) headers['X-Admin-Password'] = S.pwd;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch (e) { /* пустой ответ */ }
    if (!res.ok) {
      const err = new Error((data && data.detail) || `Ошибка сервера (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function load() {
    const d = await api('GET', '/api/league');
    S.data = d.data;
    S.version = d.version;
    S.editable = d.editable;
    if (!isEditor()) S.live = d.live;
    else S.live = store.get('fl-live') || d.live;
    if (!S.data.teamNames) S.data.teamNames = { ...LG.DEFAULT_TEAM_NAMES };
    invalidate();
  }

  // Изменить данные лиги и сохранить на сервер. mutate получает копию данных.
  async function save(mutate, okMsg) {
    const next = clone(S.data);
    try { mutate(next); } catch (e) { toast(e.message, 'error'); return false; }
    try {
      const r = await api('PUT', '/api/league', { data: next, version: S.version });
      S.data = next;
      S.version = r.version;
      invalidate();
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      if (e.status === 401) { logout(); toast('Пароль не подошёл, войдите заново', 'error'); }
      else if (e.status === 409) { toast('Данные изменились, обновляю', 'error'); await load(); render(); }
      else toast(e.message, 'error');
      return false;
    }
  }

  async function pushLive() {
    store.set('fl-live', S.live);
    updateLiveDot();
    if (S.live && S.live.matchId) return; // правка старого матча — зрителям не показываем
    try { await api('PUT', '/api/live', { live: S.live }); }
    catch (e) { toast('Не удалось отправить матч на сервер: ' + e.message, 'error'); }
  }

  function logout() {
    S.pwd = null;
    store.del('fl-pwd');
    store.del('fl-live');
    render();
  }

  /* ---------- Тост и шторка ---------- */
  let toastTimer;
  function toast(msg, type) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast ${type === 'error' ? 'error' : ''} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  let modalRender = null;
  function openModal(renderFn) {
    modalRender = renderFn;
    const m = $('#modal'), b = $('#backdrop');
    m.innerHTML = renderFn();
    m.hidden = b.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => { m.classList.add('open'); b.classList.add('open'); }));
    document.body.style.overflow = 'hidden';
  }
  function refreshModal() { if (modalRender) $('#modal').innerHTML = modalRender(); }
  function closeModal() {
    const m = $('#modal'), b = $('#backdrop');
    modalRender = null;
    m.classList.remove('open'); b.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { if (!modalRender) { m.hidden = b.hidden = true; m.innerHTML = ''; } }, 300);
  }
  const modalOpen = () => !!modalRender;

  /* ---------- Общие куски разметки ---------- */
  function topMain(onCover) {
    return `<header class="topbar ${onCover ? 'on-cover' : ''}">
      <a class="wordmark" href="#/"><i>⚽</i><span>${esc(S.data.name || 'Лига')}</span></a>
      <a class="round-btn" href="#/settings" aria-label="${isEditor() ? 'Настройки' : 'Вход для организатора'}">${icon(isEditor() ? 'gear' : 'lock')}</a>
    </header>`;
  }
  function topBack(title, back, onCover) {
    return `<header class="topbar ${onCover ? 'on-cover' : ''}">
      <div class="back-title"><a class="round-btn ${onCover ? 'glass' : ''}" href="${back}" aria-label="Назад">${icon('back')}</a>${title ? `<h1>${esc(title)}</h1>` : ''}</div>
    </header>`;
  }
  const empty = (e, title, text, action) => `<div class="empty"><div class="e">${e}</div><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}${action || ''}</div>`;

  function periodPills() {
    const months = LG.monthsOf(S.data);
    if (!months.length) return '';
    const pill = (v, label) => `<button class="pill" data-act="period" data-v="${v}" aria-pressed="${S.period === v}">${esc(label)}</button>`;
    return `<div class="pills">${pill('all', 'Всё время')}${months.map((m) => pill(m, fmtMonth(m))).join('')}</div>`;
  }

  function goalsLine(e) {
    if (e.own) return `${esc(e.scorer || '?')} (авт.)`;
    return `${esc(e.scorer || 'Неизвестно')}${e.assist ? ` <span class="muted">(${esc(e.assist)})</span>` : ''}`;
  }
  const minute = (e) => (e.ms != null ? `${Math.floor(e.ms / 60000) + 1}′ ` : '');

  function matchHtml(t, m, i, editable) {
    const s = LG.matchScore(m);
    const evA = (m.events || []).filter((e) => e.team === m.a);
    const evB = (m.events || []).filter((e) => e.team === m.b);
    const goals = evA.length || evB.length
      ? `<div class="goals"><div>${evA.map((e) => `⚽ ${goalsLine(e)}`).join('<br>')}</div><div class="b">${evB.map((e) => `${goalsLine(e)} ⚽`).join('<br>')}</div></div>`
      : '';
    return `<div class="match ${editable ? 'editable' : ''}" ${editable ? `data-act="edit-match" data-tour="${esc(t.id)}" data-match="${esc(m.id)}" title="Изменить матч"` : ''}>
      <div class="side">${dot(m.a)}<span>${esc(tn(m.a))}</span></div>
      <div class="sc num">${s.a}:${s.b}</div>
      <div class="side b"><span>${esc(tn(m.b))}</span>${dot(m.b)}</div>
      ${goals}
    </div>`;
  }

  function liveScore(L) {
    return LG.matchScore({ a: L.a, b: L.b, events: L.events });
  }
  const elapsed = (L) => (L.acc || 0) + (L.run ? Date.now() - L.run : 0);
  function clockText(L) {
    const left = (L.len || 420) * 1000 - elapsed(L);
    const a = Math.abs(left);
    return (left < 0 ? '+' : '') + Math.floor(a / 60000) + ':' + pad(Math.floor((a % 60000) / 1000));
  }

  function liveBanner() {
    const L = S.live;
    if (!L) return '';
    const s = liveScore(L);
    return `<a class="live-banner" href="#/live"><span class="live-badge">LIVE</span>
      <span>${dot(L.a)} ${esc(tn(L.a))} — ${esc(tn(L.b))} ${dot(L.b)}</span><span class="sc num">${s.a}:${s.b}</span></a>`;
  }

  /* ---------- Таблица ---------- */
  function vTable() {
    const st = stats();
    const all = allStats();
    const players = new Set(S.data.players.map((p) => p.name)).size;
    let html = topMain(true) + `<section class="cover">
      <div class="ball" aria-hidden="true">⚽</div>
      <h1>${esc(S.data.name || 'Лига')}</h1>
      <div class="sub">${S.data.season ? esc(S.data.season) + ' · ' : ''}${nWord(all.tours.length, 'тур', 'тура', 'туров')} · ${nWord(players, 'игрок', 'игрока', 'игроков')}</div>
    </section><main class="sheet">`;

    if (!all.tours.length) {
      html += `<section class="section">${empty('🏟️', 'Пока нет ни одного тура',
        isEditor() ? 'Создайте первый тур: выберите игроков, и сайт сам подберёт равные составы.' : 'Организатор ещё не внёс игры.',
        isEditor() ? `<a class="btn btn-black" href="#/new">${icon('plus')}Новый тур</a>` : '')}</section></main>`;
      return html;
    }

    html += `<section class="section" style="padding-bottom:6px">${periodPills()}${S.live ? `<div style="margin-top:12px">${liveBanner()}</div>` : ''}</section>`;

    const lastTour = st.tours[st.tours.length - 1];
    const mvp = lastTour && st.tourInfo[lastTour.id].mvp;
    if (mvp) {
      html += `<section class="section" style="padding-top:8px"><a class="yellow-card" href="#/tour/${enc(lastTour.id)}">
        <div class="label">MVP тура · ${fmtDate(lastTour.date)}</div>
        <div class="who">${avatar(mvp.name)}<div><b>${esc(mvp.name)}</b>
          <span>${nWord(mvp.goals, 'гол', 'гола', 'голов')} · ${nWord(mvp.assists, 'пас', 'паса', 'пасов')} · ${nWord(mvp.w, 'победа', 'победы', 'побед')}</span></div>
          <div class="score"><b class="num">${mvp.score}</b><span>${plural(mvp.score, 'балл', 'балла', 'баллов')}</span></div></div>
      </a></section>`;
    }

    const by = (f, filter) => [...st.list].filter(filter || (() => true)).sort((a, b) => f(b) - f(a))[0];
    const regular = (p) => !p.smallSample;
    const leaders = [
      ['⚽', 'Бомбардир', by((p) => p.goals * 1000 + p.assists), (p) => nWord(p.goals, 'гол', 'гола', 'голов')],
      ['👟', 'Ассистент', by((p) => p.assists * 1000 + p.goals), (p) => nWord(p.assists, 'пас', 'паса', 'пасов')],
      ['⭐', 'Рейтинг', by((p) => p.rating, regular), (p) => `${p.rating}`],
      ['🏆', 'Побед', by((p) => p.winPct, regular), (p) => `${Math.round(p.winPct)}%`],
      ['🔁', 'Больше игр', by((p) => p.games), (p) => nWord(p.games, 'матч', 'матча', 'матчей')],
    ].filter((x) => x[2]);
    html += `<div class="chips-row">${leaders.map(([e, k, p, v]) => `<a class="info-card" href="${playerHref(p.name)}"><span class="emoji">${e}</span><div><span class="k">${k}</span><b>${esc(p.name)}</b><span class="v">${v(p)}</span></div></a>`).join('')}</div>`;

    if (S.period === 'all') {
      const mm = LG.monthMVPs(S.data, todayStr());
      if (mm.length) {
        html += `<div class="gap"></div><section class="section" style="padding-bottom:6px"><h2 class="h2">MVP месяца</h2></section>
          <div class="chips-row">${mm.map((x) => `<a class="info-card" href="${playerHref(x.player.name)}">${avatar(x.player.name, 's')}<div><span class="k">${esc(fmtMonth(x.month))}</span><b>${esc(x.player.name)}</b><span class="v">${nWord(x.score, 'балл', 'балла', 'баллов')}</span></div></a>`).join('')}</div>`;
      }
    }

    html += `<div class="gap"></div><section class="section"><h2 class="h2"><span>Таблица<span class="count">${st.list.length}</span></span></h2>
      <ul class="rows">${st.list.map((p) => {
        let move = '';
        if (p.prevPos != null && p.prevPos !== p.pos) move = p.prevPos > p.pos ? `<small class="up">▲${p.prevPos - p.pos}</small>` : `<small class="down">▼${p.pos - p.prevPos}</small>`;
        return `<li><a class="row" href="${playerHref(p.name)}">
          <span class="pos num">${p.pos}${move}</span>${avatar(p.name)}
          <span class="main"><span class="name">${esc(p.name)}</span>
            <span class="meta num">И ${p.games} · ${p.w}-${p.d}-${p.l} · ⚽ ${p.goals} · 👟 ${p.assists}</span></span>
          <span class="end"><span class="big num">${p.pts}</span><span class="meta">${plural(p.pts, 'очко', 'очка', 'очков')}</span></span>
        </a></li>`;
      }).join('')}</ul>
      <p class="hint">Очки игрока — сумма очков его команды в матчах, где он играл: 3 за победу, 1 за ничью.</p></section></main>`;
    return html;
  }

  /* ---------- Туры ---------- */
  function vTours() {
    const st = allStats();
    let html = topMain() + `<main><section class="section"><h2 class="h2"><span>Туры<span class="count">${st.tours.length || ''}</span></span>
      ${isEditor() ? `<a class="btn btn-black sm" href="#/new">${icon('plus')}Новый тур</a>` : ''}</h2>`;
    if (S.live) html += `<div style="margin-bottom:12px">${liveBanner()}</div>`;
    if (!st.tours.length) {
      html += empty('📅', 'Туров пока нет', isEditor() ? 'Нажмите «Новый тур», чтобы собрать составы.' : 'Организатор ещё не внёс игры.');
    } else {
      html += [...st.tours].reverse().map((t) => {
        const info = st.tourInfo[t.id];
        return `<a class="card tour-card" href="#/tour/${enc(t.id)}">
          <div class="top"><span class="date">${fmtDate(t.date)}</span><span class="muted">${fmtWeekday(t.date)} · ${nWord(t.matches.length, 'матч', 'матча', 'матчей')}</span></div>
          <div class="teams">${info.standings.map((s, i) => `<span class="tag ${i === 0 && s.games ? 'yellow' : ''}">${dot(s.key)} ${esc(tn(s.key))} · ${s.pts}</span>`).join('')}</div>
          ${info.mvp ? `<div class="mvp">⭐ MVP: <b>${esc(info.mvp.name)}</b> · ${nWord(info.mvp.score, 'балл', 'балла', 'баллов')}</div>` : ''}
        </a>`;
      }).join('');
    }
    return html + '</section></main>';
  }

  function vTour(id) {
    const t = S.data.tours.find((x) => x.id === id);
    if (!t) return topBack('Тур', '#/tours') + `<main class="section">${empty('🤷', 'Тур не найден', 'Возможно, его удалили.')}</main>`;
    const info = allStats().tourInfo[t.id];
    const ed = isEditor();
    let html = topBack('', '#/tours', true) + `<section class="cover small">
      <h1>${fmtDate(t.date)}</h1>
      <div class="sub">${fmtWeekday(t.date)} · ${nWord(t.matches.length, 'матч', 'матча', 'матчей')}${info.mvp ? ` · MVP <b>${esc(info.mvp.name)}</b>` : ''}</div>
    </section><main class="sheet">`;

    if (ed) {
      html += `<section class="section"><div class="actions">
        <button class="btn btn-black" data-act="live-from-tour" data-tour="${esc(t.id)}">${icon('play')}Матч</button>
        <a class="btn btn-gray" href="#/roster/${enc(t.id)}">${icon('edit')}Составы</a></div></section>`;
    }

    html += `<section class="section"><h2 class="h2">Таблица тура</h2>
      <table class="team-table num"><thead><tr><th></th><th>Команда</th><th>И</th><th>В</th><th>Н</th><th>П</th><th>Мячи</th><th>О</th></tr></thead><tbody>
      ${info.standings.map((s, i) => `<tr><td>${i + 1}</td><td><span class="tn">${dot(s.key)}${esc(tn(s.key))}</span></td><td>${s.games}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td><td>${s.gf}:${s.ga}</td><td class="pts">${s.pts}</td></tr>`).join('')}
      </tbody></table></section><div class="gap"></div>`;

    html += `<section class="section"><h2 class="h2"><span>Матчи<span class="count">${t.matches.length}</span></span>${ed && t.matches.length ? '<span class="muted" style="font-size:13px;font-weight:500">нажмите, чтобы изменить</span>' : ''}</h2>
      ${t.matches.length ? t.matches.map((m, i) => matchHtml(t, m, i, ed)).join('') : empty('⚽', 'Матчей ещё не было', ed ? 'Нажмите «Матч», чтобы начать первый.' : '')}</section>`;

    if (info.players.length && t.matches.length) {
      html += `<div class="gap"></div><section class="section"><h2 class="h2">MVP тура</h2><ul class="rows">
        ${info.players.slice(0, 5).map((p, i) => `<li><a class="row" href="${playerHref(p.name)}">
          <span class="pos num">${i === 0 ? '⭐' : i + 1}</span>${avatar(p.name)}
          <span class="main"><span class="name">${esc(p.name)}</span><span class="meta">${dot(p.key)} ⚽ ${p.goals} · 👟 ${p.assists} · ${p.w}-${p.d}-${p.l}${p.cs ? ` · 🧱 ${p.cs}` : ''}</span></span>
          <span class="end"><span class="big num">${p.score}</span><span class="meta">${plural(p.score, 'балл', 'балла', 'баллов')}</span></span></a></li>`).join('')}
        </ul><p class="hint">Баллы: 2 за гол, 2 за пас, 2 за победу, 1 за ничью, 1 за сухой матч.</p></section>`;
    }

    html += `<div class="gap"></div><section class="section"><h2 class="h2">Составы</h2><div class="rosters">
      ${Object.entries(t.teams).map(([k, names]) => {
        const place = info.standings.findIndex((s) => s.key === k) + 1;
        return `<div class="roster"><h3>${dot(k)}${esc(tn(k))}<span class="muted">${place ? place + '-е место' : ''}</span></h3>
          <div class="chips">${names.map((n) => `<a class="chip" href="${playerHref(n)}">${isGk(n) ? '🧤 ' : ''}${esc(n)}</a>`).join('')}</div></div>`;
      }).join('')}</div></section>`;

    if (ed) html += `<div class="gap"></div><section class="section"><button class="btn btn-danger block" data-act="delete-tour" data-tour="${esc(t.id)}">${icon('trash')}Удалить тур</button></section>`;
    return html + '</main>';
  }

  /* ---------- Матч (лайв) ---------- */
  function currentTour() {
    const ts = LG.sortedTours(S.data);
    return ts[ts.length - 1] || null;
  }

  function vLive() {
    const L = S.live;
    const ed = isEditor();
    let html = topMain() + '<main><section class="section">';

    if (L) {
      const t = S.data.tours.find((x) => x.id === L.tourId);
      if (!t) {
        if (ed) { S.live = null; pushLive(); }
        return html + empty('🤷', 'Тур этого матча удалён', '') + '</section></main>';
      }
      const s = liveScore(L);
      const editing = !!L.matchId;
      const over = elapsed(L) > (L.len || 420) * 1000;
      html += `<div class="scoreboard">
        <div class="head">${editing ? '<span>Изменение матча</span>' : (L.run ? '<span class="live-badge">LIVE</span>' : '<span>Пауза</span>')}
          <span>Матч ${L.n || t.matches.length + 1} · ${fmtDate(t.date)}</span>
          <span class="clock ${over ? 'over' : ''}" data-clock>${editing ? '' : clockText(L)}</span></div>
        <div class="teams">
          <div class="team">${dot(L.a)}${esc(tn(L.a))}</div>
          <div class="score">${s.a}:${s.b}</div>
          <div class="team">${dot(L.b)}${esc(tn(L.b))}</div>
        </div>
        ${L.events.length ? `<div class="evs">${L.events.map((e) => `<div>${dot(e.team)}<span>${minute(e)}${goalsLine(e)}</span></div>`).join('')}</div>` : ''}
      </div>`;

      if (ed) {
        html += `<div class="controls">
          <button class="btn btn-gray" data-act="goal" data-team="${L.a}">${dot(L.a)} Гол</button>
          <button class="btn btn-gray" data-act="goal" data-team="${L.b}">${dot(L.b)} Гол</button>
          ${editing ? '' : `<button class="btn btn-gray" data-act="clock">${icon(L.run ? 'pause' : 'play')}${L.run ? 'Пауза' : (elapsed(L) ? 'Дальше' : 'Старт')}</button>`}
          <button class="btn btn-gray ${editing ? 'full' : ''}" data-act="undo-goal" ${L.events.length ? '' : 'disabled'}>${icon('undo')}Убрать гол</button>
          <button class="btn btn-black full" data-act="finish">${icon('check')}${editing ? 'Сохранить матч' : 'Завершить матч'}</button>
        </div>
        ${editing ? '' : `<div class="pills" style="margin-top:14px;justify-content:center;flex-wrap:wrap">${[5, 7, 8, 10, 12].map((m) => `<button class="pill" data-act="len" data-v="${m * 60}" aria-pressed="${(L.len || 420) === m * 60}">${m} мин</button>`).join('')}</div>`}
        <div class="actions" style="margin-top:14px">
          ${editing ? `<button class="btn btn-danger sm" data-act="delete-match">${icon('trash')}Удалить матч</button>` : ''}
          <button class="btn btn-gray sm" data-act="cancel-live">${editing ? 'Не сохранять' : 'Отменить матч'}</button></div>`;
      }

      if (!editing) {
        const after = [...t.matches, { a: L.a, b: L.b, events: L.events }];
        const n = LG.nextPair({ teams: t.teams }, after);
        if (n && Object.keys(t.teams).length > 2) {
          html += `<div class="card" style="margin-top:16px"><span class="muted">Если матч закончится так, дальше</span><br>
            <b>${n.pair ? `${dot(n.pair[0])} ${esc(tn(n.pair[0]))} — ${esc(tn(n.pair[1]))} ${dot(n.pair[1])}` : `ничья: ${esc(tn(n.draw[0]))} или ${esc(tn(n.draw[1]))} против ${esc(tn(n.waiting))}`}</b></div>`;
        }
      }
      return html + '</section></main>';
    }

    const t = currentTour();
    if (!ed) {
      html += empty('📺', 'Сейчас матч не идёт', 'Когда организатор начнёт матч, здесь появится счёт и голы в реальном времени.');
      if (t && t.matches.length) {
        const m = t.matches[t.matches.length - 1];
        html += `<h2 class="h2" style="margin-top:20px">Последний матч · ${fmtDate(t.date)}</h2>${matchHtml(t, m, 0, false)}
          <a class="btn btn-gray block" style="margin-top:10px" href="#/tour/${enc(t.id)}">Весь тур</a>`;
      }
      return html + '</section></main>';
    }

    if (!t) {
      return html + empty('🏟️', 'Сначала создайте тур', 'В туре задаются составы команд, после этого можно вести матчи.',
        `<a class="btn btn-black" href="#/new">${icon('plus')}Новый тур</a>`) + '</section></main>';
    }
    const keys = Object.keys(t.teams);
    const n = LG.nextPair(t);
    html += `<h2 class="h2">Тур ${fmtDate(t.date)}<a class="link" href="#/tour/${enc(t.id)}">Открыть</a></h2>`;
    if (t.date < todayStr()) html += `<p class="hint" style="margin:-6px 0 12px">Это прошедший тур. Для новой игры <a href="#/new">создайте тур</a>.</p>`;
    if (n && n.pair) {
      html += `<div class="yellow-card"><div class="label">Следующий матч · №${t.matches.length + 1}</div>
        <div class="who" style="justify-content:center;gap:14px;font-size:20px;font-weight:800">${dot(n.pair[0])} ${esc(tn(n.pair[0]))} — ${esc(tn(n.pair[1]))} ${dot(n.pair[1])}</div>
        <button class="btn btn-black block" style="margin-top:14px" data-act="start" data-tour="${esc(t.id)}" data-a="${n.pair[0]}" data-b="${n.pair[1]}">${icon('play')}Начать матч</button></div>`;
    } else if (n && n.draw) {
      html += `<div class="yellow-card"><div class="label">Прошлый матч — ничья</div><p style="margin:8px 0 12px;font-weight:600">Кто остаётся играть с командой «${esc(tn(n.waiting))}»?</p>
        <div class="actions">${n.draw.map((k) => `<button class="btn btn-black" data-act="start" data-tour="${esc(t.id)}" data-a="${k}" data-b="${n.waiting}">${dot(k)} ${esc(tn(k))}</button>`).join('')}</div></div>`;
    }
    if (keys.length > 2) {
      const pairs = [];
      keys.forEach((a, i) => keys.slice(i + 1).forEach((b) => pairs.push([a, b])));
      html += `<h2 class="h2" style="margin-top:22px;font-size:16px">Другая пара</h2><div class="chips">${pairs.map(([a, b]) => `<button class="chip" style="background:var(--fill)" data-act="start" data-tour="${esc(t.id)}" data-a="${a}" data-b="${b}">${dot(a)} ${esc(tn(a))} — ${esc(tn(b))} ${dot(b)}</button>`).join('')}</div>`;
    }
    if (t.matches.length) {
      html += `<h2 class="h2" style="margin-top:22px;font-size:16px">Сыграно<span class="count">${t.matches.length}</span></h2>${t.matches.map((m, i) => matchHtml(t, m, i, true)).join('')}`;
    }
    return html + '</section></main>';
  }

  function goalModal() {
    const L = S.live, g = S.goal;
    const t = S.data.tours.find((x) => x.id === L.tourId);
    const other = g.team === L.a ? L.b : L.a;
    const scorers = g.own ? (t.teams[other] || []) : (t.teams[g.team] || []);
    const assists = (t.teams[g.team] || []).filter((n) => n !== g.scorer);
    const chip = (act, v, label, on) => `<button class="chip ${on ? 'on' : ''}" style="${on ? '' : 'background:var(--fill)'}" data-act="${act}" data-v="${esc(v)}">${label}</button>`;
    return `<div class="modal-head"><button class="link-btn" data-act="close-modal">Отмена</button><h2>${dot(g.team)} Гол: ${esc(tn(g.team))}</h2><span></span></div>
      <div class="group"><h3>${g.own ? `Кто забил в свои ворота (${esc(tn(other))})` : 'Кто забил'}</h3><div class="chips">
        ${scorers.map((n) => chip('g-scorer', n, esc(n), g.scorer === n)).join('')}
        ${g.own ? '' : chip('g-scorer', '', 'Не знаю', g.scorer === null)}</div></div>
      ${g.own ? '' : `<div class="group"><h3>Голевой пас</h3><div class="chips">
        ${chip('g-assist', '', 'Без паса', !g.assist)}
        ${assists.map((n) => chip('g-assist', n, esc(n), g.assist === n)).join('')}</div></div>`}
      <div class="group"><div class="chips">${chip('g-own', '', '🙈 Автогол', g.own)}</div></div>
      <div class="group"><button class="btn btn-yellow block" data-act="g-save" ${g.own && !g.scorer ? 'disabled' : ''}>${icon('check')}Засчитать гол</button></div>`;
  }

  /* ---------- Игроки ---------- */
  function vPlayers() {
    const st = allStats();
    const sorts = { rating: ['Рейтинг', (p) => p.rating - (p.smallSample ? 100 : 0)], pts: ['Очки', (p) => p.pts], goals: ['Голы', (p) => p.goals * 1000 + p.assists], assists: ['Пасы', (p) => p.assists * 1000 + p.goals], games: ['Игры', (p) => p.games] };
    const [, f] = sorts[S.playerSort] || sorts.rating;
    const q = S.search.trim().toLowerCase();
    const list = [...st.list].filter((p) => !q || p.name.toLowerCase().includes(q)).sort((a, b) => f(b) - f(a) || a.name.localeCompare(b.name, 'ru'));
    const idle = S.data.players.filter((p) => !st.byName[p.name] && (!q || p.name.toLowerCase().includes(q)));

    let html = topMain() + `<main><section class="section"><h2 class="h2"><span>Игроки<span class="count">${S.data.players.length}</span></span></h2>
      <label class="input" style="margin-bottom:12px">${icon('search')}<input type="search" data-input="search" value="${esc(S.search)}" placeholder="Найти игрока" aria-label="Поиск игрока"></label>
      <div class="pills" style="margin-bottom:6px">${Object.entries(sorts).map(([k, [label]]) => `<button class="pill" data-act="psort" data-v="${k}" aria-pressed="${S.playerSort === k}">${label}</button>`).join('')}</div>
      <ul class="rows" id="player-list">`;
    if (!list.length && !idle.length) html += `<li>${empty('🔍', q ? 'Никого не нашлось' : 'Игроков пока нет', q ? '' : 'Игроки появятся, когда организатор создаст тур.')}</li>`;
    html += list.map((p) => `<li><a class="row" href="${playerHref(p.name)}">
        <span class="rating num ${p.smallSample ? 'dim' : ''}" title="${p.smallSample ? 'Мало игр для точного рейтинга' : 'Рейтинг'}">${p.rating}</span>
        ${avatar(p.name)}
        <span class="main"><span class="name">${esc(p.name)}</span><span class="meta num">${nWord(p.games, 'матч', 'матча', 'матчей')} · ⚽ ${p.goals} · 👟 ${p.assists}</span></span>
        <span class="end"><span class="big num">${Math.round(p.winPct)}%</span><span class="meta">побед</span></span></a></li>`).join('');
    html += idle.map((p) => `<li><a class="row" href="${playerHref(p.name)}"><span class="rating dim">—</span>${avatar(p.name)}<span class="main"><span class="name">${esc(p.name)}</span><span class="meta">ещё не играл</span></span></a></li>`).join('');
    return html + `</ul><p class="hint">Рейтинг от 50 до 99 показывает, как игрок выглядит на фоне остальных: атака и защита его команд, голы и пасы, победы и очки. Серый рейтинг — пока мало матчей.</p></section></main>`;
  }

  function radarSvg(r) {
    const axes = [['Атака', r.attack], ['Защита', r.defense], ['Голы', r.goals], ['Пасы', r.passes], ['Победы', r.wins], ['Очки', r.points]];
    const cx = 160, cy = 132, R = 92;
    const pt = (i, v) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
      return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
    };
    const ring = (v) => axes.map((_, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
    const area = axes.map(([, v], i) => pt(i, Math.max(0.04, v / 100)).map((x) => x.toFixed(1)).join(',')).join(' ');
    return `<svg class="radar" viewBox="0 0 320 270" role="img" aria-label="Профиль игрока: ${axes.map(([k, v]) => `${k} ${v}`).join(', ')}">
      ${[0.25, 0.5, 0.75, 1].map((v) => `<polygon class="grid" points="${ring(v)}"/>`).join('')}
      ${axes.map((_, i) => { const [x, y] = pt(i, 1); return `<line class="grid" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('')}
      <polygon class="area" points="${area}"/>
      ${axes.map(([k, v], i) => {
        const [x, y] = pt(i, 1.2);
        const anchor = Math.abs(x - cx) < 5 ? 'middle' : x > cx ? 'start' : 'end';
        return `<text x="${x.toFixed(1)}" y="${(y + (y < cy ? -2 : 8)).toFixed(1)}" text-anchor="${anchor}">${k}<tspan class="pct" dx="4">${v}</tspan></text>`;
      }).join('')}
    </svg>`;
  }

  function sparkSvg(ranks, total) {
    const pts = ranks.map((r, i) => [i, r]).filter(([, r]) => r != null);
    if (pts.length < 2) return '';
    const W = 300, H = 70, P = 8;
    const maxR = Math.max(total, ...pts.map(([, r]) => r));
    const x = (i) => P + (i / (ranks.length - 1)) * (W - 2 * P);
    const y = (r) => P + ((r - 1) / Math.max(1, maxR - 1)) * (H - 2 * P);
    const d = pts.map(([i, r], j) => `${j ? 'L' : 'M'}${x(i).toFixed(1)},${y(r).toFixed(1)}`).join(' ');
    const [li, lr] = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Место в таблице по турам"><path class="l" d="${d}"/><circle cx="${x(li).toFixed(1)}" cy="${y(lr).toFixed(1)}" r="5"/></svg>`;
  }

  function vPlayer(name) {
    const st = allStats();
    const p = st.byName[name];
    const known = S.data.players.find((x) => x.name === name);
    if (!p && !known) return topBack('Игрок', '#/players') + `<main class="section">${empty('🤷', 'Игрок не найден', '')}</main>`;
    const ed = isEditor();
    let html = topBack('', '#/players', true) + `<section class="cover small">
      <div style="display:grid;justify-items:center;margin-bottom:10px">${avatar(name, 'l')}</div>
      <h1>${esc(name)}</h1>
      <div class="sub">${p ? `<b>#${p.pos}</b> в таблице · рейтинг <b>${p.rating}</b>` : 'Ещё не играл'}${isGk(name) ? ' · вратарь' : ''}</div>
    </section><main class="sheet">`;

    if (p) {
      const tiles = [['Матчи', p.games], ['Очки', p.pts], ['Очки/матч', fix1(p.ppg)], ['Победы', Math.round(p.winPct) + '%'], ['Голы', p.goals], ['Пасы', p.assists],
        ['Сухие', p.cs], ['Туры', p.tours], ['Мячи', `${p.gf}:${p.ga}`]];
      html += `<section class="section"><div class="stat-grid">${tiles.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v num">${v}</div></div>`).join('')}</div></section>
        <div class="gap"></div><section class="section"><h2 class="h2">Профиль игрока</h2>${radarSvg(p.radar)}
        <p class="hint" style="text-align:center">Цифры — процент игроков, у которых этот показатель хуже.${p.smallSample ? ' Пока мало матчей, профиль может сильно меняться.' : ''}</p></section>`;

      const hist = p.history.slice(-10).reverse();
      html += `<div class="gap"></div><section class="section"><h2 class="h2">Форма</h2>
        <div class="form">${hist.map((h) => `<a class="${h.place === 1 ? 'p1' : h.place === h.teams ? 'plast' : ''}" href="#/tour/${enc(h.tourId)}" title="${fmtDate(h.date)}: ${h.place}-е место, ${h.goals} г, ${h.assists} п">${h.place}</a>`).join('')}</div>
        <p class="hint">Место команды игрока в последних турах, слева самый свежий.</p>
        ${sparkSvg(p.rankAfter || [], st.list.length) ? `<h3 style="margin:16px 0 6px;font-size:15px">Место в общей таблице</h3>${sparkSvg(p.rankAfter || [], st.list.length)}` : ''}
      </section>`;

      const partners = st.pairs.filter((x) => (x.a === name || x.b === name) && x.games >= 3)
        .map((x) => ({ ...x, other: x.a === name ? x.b : x.a })).sort((a, b) => b.ppg - a.ppg || b.games - a.games).slice(0, 3);
      const feeds = st.links.filter((l) => l.to === name).slice(0, 3);
      const gives = st.links.filter((l) => l.from === name).slice(0, 3);
      if (partners.length || feeds.length || gives.length) {
        html += '<div class="gap"></div><section class="section">';
        if (partners.length) {
          html += `<h2 class="h2">Лучшие партнёры</h2><ul class="rows">${partners.map((x) => `<li><a class="row" href="${playerHref(x.other)}">${avatar(x.other)}<span class="main"><span class="name">${esc(x.other)}</span><span class="meta">${nWord(x.games, 'матч', 'матча', 'матчей')} вместе · ${x.w}-${x.d}-${x.l}</span></span><span class="end"><span class="big num">${fix1(x.ppg)}</span><span class="meta">очк/матч</span></span></a></li>`).join('')}</ul>`;
        }
        const linkRows = (arr, key) => arr.map((l) => `<li><a class="row" href="${playerHref(l[key])}">${avatar(l[key], 's')}<span class="main"><span class="name">${esc(l[key])}</span></span><span class="end num"><b>${l.count}</b></span></a></li>`).join('');
        if (feeds.length) html += `<h2 class="h2" style="margin-top:14px">Чаще всего пасуют ему</h2><ul class="rows">${linkRows(feeds, 'from')}</ul>`;
        if (gives.length) html += `<h2 class="h2" style="margin-top:14px">Он чаще всего пасует</h2><ul class="rows">${linkRows(gives, 'to')}</ul>`;
        html += '</section>';
      }
    } else {
      html += `<section class="section">${empty('🕐', 'Матчей пока нет', 'Статистика появится после первого тура с этим игроком.')}</section>`;
    }

    if (ed && known) {
      html += `<div class="gap"></div><section class="section"><h2 class="h2">Для организатора</h2>
        <form data-form="rename" data-name="${esc(name)}"><div class="field"><label for="rn">Имя</label>
          <div class="input"><input id="rn" name="to" value="${esc(name)}" maxlength="40" autocomplete="off"></div></div>
          <div class="actions" style="margin-top:12px"><button class="btn btn-black" type="submit">Переименовать</button>
          <button class="btn btn-gray" type="button" data-act="toggle-gk" data-name="${esc(name)}">${isGk(name) ? 'Не вратарь' : '🧤 Вратарь'}</button></div></form>
        ${p ? '' : `<button class="btn btn-danger block" style="margin-top:12px" data-act="delete-player" data-name="${esc(name)}">${icon('trash')}Удалить игрока</button>`}
      </section>`;
    }
    return html + '</main>';
  }

  /* ---------- Статистика ---------- */
  function vStats() {
    const st = stats();
    let html = topMain() + `<main><section class="section" style="padding-bottom:8px"><h2 class="h2">Статистика</h2>${periodPills()}</section>`;
    if (!st.list.length) return html + `<section class="section">${empty('📊', 'Пока нечего считать', 'Статистика появится после первых матчей.')}</section></main>`;

    const block = (key, title, items, row, more) => {
      if (!items.length) return '';
      const open = S.expanded[key];
      const shown = open ? items : items.slice(0, 5);
      return `<div class="gap"></div><section class="section"><h2 class="h2">${title}</h2><ul class="rows">${shown.map(row).join('')}</ul>
        ${items.length > 5 ? `<button class="see-all" data-act="expand" data-key="${key}"><span>${open ? 'Свернуть' : `Показать всех (${items.length})`}</span>${icon('chev')}</button>` : ''}${more || ''}</section>`;
    };
    const prow = (val, label, meta) => (p, i) => `<li><a class="row" href="${playerHref(p.name)}"><span class="pos num">${i + 1}</span>${avatar(p.name)}
      <span class="main"><span class="name">${esc(p.name)}</span><span class="meta">${meta(p)}</span></span>
      <span class="end"><span class="big num">${val(p)}</span><span class="meta">${label(p)}</span></span></a></li>`;
    const sortBy = (f, filter) => [...st.list].filter(filter || ((p) => f(p) > 0)).sort((a, b) => f(b) - f(a) || a.games - b.games);

    html += block('goals', '⚽ Бомбардиры', sortBy((p) => p.goals), prow((p) => p.goals, (p) => plural(p.goals, 'гол', 'гола', 'голов'), (p) => `${fix1(p.goalsPg)} за матч · ${nWord(p.games, 'матч', 'матча', 'матчей')}`));
    html += block('assists', '👟 Ассистенты', sortBy((p) => p.assists), prow((p) => p.assists, (p) => plural(p.assists, 'пас', 'паса', 'пасов'), (p) => `${fix1(p.assistsPg)} за матч`));
    html += block('ga', '🔥 Гол + пас', sortBy((p) => p.goals + p.assists), prow((p) => p.goals + p.assists, () => 'г+п', (p) => `⚽ ${p.goals} · 👟 ${p.assists}`));
    html += block('cs', '🧱 Сухие матчи', sortBy((p) => p.cs), prow((p) => p.cs, () => 'сухих', (p) => `${Math.round(p.csPct)}% матчей на ноль`));
    html += block('ppg', '📈 Очки за матч', sortBy((p) => p.ppg, (p) => !p.smallSample), prow((p) => fix1(p.ppg), () => 'очк/матч', (p) => `${p.w}-${p.d}-${p.l}`),
      `<p class="hint">Только игроки, у которых хотя бы ${nWord(st.minGames, 'матч', 'матча', 'матчей')}.</p>`);

    const minPair = Math.max(3, Math.round(st.minGames / 2));
    const pairs = st.pairs.filter((x) => x.games >= minPair).sort((a, b) => b.ppg - a.ppg || b.games - a.games);
    html += block('pairs', '🤝 Лучшие связки', pairs, (x, i) => `<li class="row"><span class="pos num">${i + 1}</span>
      <span class="main"><span class="name">${esc(x.a)} + ${esc(x.b)}</span><span class="meta">${nWord(x.games, 'матч', 'матча', 'матчей')} вместе · ${x.w}-${x.d}-${x.l}</span></span>
      <span class="end"><span class="big num">${fix1(x.ppg)}</span><span class="meta">очк/матч</span></span></li>`, `<p class="hint">Пары, сыгравшие вместе от ${nWord(minPair, 'матча', 'матчей', 'матчей')}.</p>`);
    html += block('links', '🎯 Голевые связки', st.links, (l, i) => `<li class="row"><span class="pos num">${i + 1}</span>
      <span class="main"><span class="name">${esc(l.from)} → ${esc(l.to)}</span><span class="meta">пас и гол</span></span>
      <span class="end"><span class="big num">${l.count}</span><span class="meta">${plural(l.count, 'раз', 'раза', 'раз')}</span></span></li>`);
    return html + '</main>';
  }

  /* ---------- Новый тур / составы ---------- */
  function startDraft(tourId) {
    const t = tourId && S.data.tours.find((x) => x.id === tourId);
    if (t) {
      S.draft = { tourId, date: t.date, k: Object.keys(t.teams).length, selected: Object.values(t.teams).flat(), teams: clone(t.teams) };
    } else {
      const last = currentTour();
      S.draft = { tourId: null, date: todayStr(), k: last ? Object.keys(last.teams).length : 3, selected: last ? Object.values(last.teams).flat() : [], teams: null };
    }
  }

  function vDraft(tourId) {
    if (!isEditor()) { location.hash = '#/settings'; return ''; }
    if (!S.draft || S.draft.tourId !== (tourId || null)) startDraft(tourId);
    const D = S.draft;
    const st = allStats();
    const names = [...new Set([...S.data.players.map((p) => p.name), ...D.selected])]
      .sort((a, b) => ((st.byName[b] || {}).games || 0) - ((st.byName[a] || {}).games || 0) || a.localeCompare(b, 'ru'));
    let html = topBack(tourId ? 'Составы' : 'Новый тур', tourId ? '#/tour/' + enc(tourId) : '#/tours') + '<main><section class="section">';

    html += `<div class="field"><label for="tdate">Дата</label><div class="input">${icon('cal')}<input type="date" id="tdate" data-input="draft-date" value="${esc(D.date)}"></div></div>
      <div class="field"><span class="label">Сколько команд</span><div class="pills">${[2, 3, 4].map((k) => `<button class="pill yellow" data-act="draft-k" data-v="${k}" aria-pressed="${D.k === k}">${k} команды</button>`).join('')}</div></div>
      <div class="field"><span class="label">Кто играет · ${D.selected.length}</span>
        <div class="chips">${names.map((n) => `<button class="chip ${D.selected.includes(n) ? 'on' : ''}" style="${D.selected.includes(n) ? '' : 'background:var(--fill)'}" data-act="draft-toggle" data-name="${esc(n)}">${isGk(n) ? '🧤 ' : ''}${esc(n)}</button>`).join('')}</div>
        <form data-form="add-player" style="display:flex;gap:8px;margin-top:10px"><div class="input" style="flex:1"><input name="name" placeholder="Новый игрок" maxlength="40" autocomplete="off" aria-label="Имя нового игрока"></div><button class="btn btn-gray" type="submit" aria-label="Добавить">${icon('plus')}</button></form>
      </div>
      <button class="btn btn-black block" style="margin-top:18px" data-act="draft-balance" ${D.selected.length < D.k * 2 ? 'disabled' : ''}>${icon('shuffle')}${D.teams ? 'Подобрать заново' : 'Подобрать составы'}</button>
      ${D.selected.length < D.k * 2 ? `<p class="hint">Нужно хотя бы ${D.k * 2} игроков.</p>` : ''}
    </section>`;

    if (D.teams) {
      html += `<div class="gap"></div><section class="section"><h2 class="h2">Составы<span class="muted" style="font-size:13px;font-weight:500">нажмите на игрока, чтобы перевести</span></h2><div class="rosters">
        ${Object.entries(D.teams).map(([k, list]) => {
          const avg = list.length ? Math.round(list.reduce((s, n) => s + ratingFor(n), 0) / list.length) : 0;
          return `<div class="roster"><h3>${dot(k)}${esc(tn(k))}<span class="muted">${nWord(list.length, 'игрок', 'игрока', 'игроков')} · ср. рейтинг ${avg}</span></h3>
            <div class="chips">${list.map((n) => `<button class="chip" data-act="draft-move" data-name="${esc(n)}">${isGk(n) ? '🧤 ' : ''}${esc(n)} <span class="muted">${Math.round(ratingFor(n))}</span></button>`).join('') || '<span class="muted">пусто</span>'}</div></div>`;
        }).join('')}</div>
        <button class="btn btn-yellow block" style="margin-top:16px" data-act="draft-save">${icon('check')}${tourId ? 'Сохранить составы' : 'Создать тур'}</button></section>`;
    }
    return html + '</main>';
  }

  /* ---------- Настройки ---------- */
  function vSettings() {
    let html = topBack('Настройки', '#/') + '<main>';
    if (!isEditor()) {
      html += `<section class="section"><div class="empty"><div class="e">🔒</div><b>Вход для организатора</b><p>Организатор создаёт туры, ведёт матчи и правит статистику. Остальным вход не нужен.</p></div>
        ${S.editable ? `<form data-form="login" style="margin-top:16px"><div class="field"><label for="pw">Пароль</label><div class="input">${icon('lock')}<input id="pw" name="password" type="password" autocomplete="current-password" required></div></div>
          <button class="btn btn-black block" style="margin-top:14px" type="submit">Войти</button></form>`
        : '<p class="hint" style="text-align:center;margin-top:14px">Редактирование выключено: на сервере не задан пароль (переменная ADMIN_PASSWORD).</p>'}
      </section></main>`;
      return html;
    }
    const D = S.data;
    html += `<section class="section"><h2 class="h2">Лига</h2><form data-form="league">
      <div class="field"><label for="ln">Название</label><div class="input"><input id="ln" name="name" value="${esc(D.name)}" maxlength="40" required></div></div>
      <div class="field"><label for="ls">Сезон</label><div class="input"><input id="ls" name="season" value="${esc(D.season || '')}" maxlength="40" placeholder="Например, Осень 2026"></div></div>
      <div class="field"><span class="label">Названия команд</span>${LG.TEAM_KEYS.map((k) => `<div class="input" style="margin-top:8px">${dot(k)}<input name="team-${k}" value="${esc(tn(k))}" maxlength="24" aria-label="Команда ${k}"></div>`).join('')}</div>
      <button class="btn btn-black block" style="margin-top:16px" type="submit">Сохранить</button></form></section>
      <div class="gap"></div><section class="section"><h2 class="h2">Вратари</h2><p class="hint" style="margin:-6px 0 10px">Вратарей сайт раскидывает по разным командам при подборе составов.</p>
      <div class="chips">${D.players.map((p) => `<button class="chip ${p.gk ? 'on' : ''}" style="${p.gk ? '' : 'background:var(--fill)'}" data-act="toggle-gk" data-name="${esc(p.name)}">${p.gk ? '🧤 ' : ''}${esc(p.name)}</button>`).join('') || '<span class="muted">Игроков пока нет</span>'}</div></section>
      <div class="gap"></div><section class="section"><h2 class="h2">Данные</h2><div class="actions">
        <button class="btn btn-gray" data-act="export">${icon('download')}Скачать копию</button>
        <label class="btn btn-gray">${icon('upload')}Загрузить<input type="file" accept="application/json,.json" data-input="import" hidden></label></div>
        ${D.tours.length ? '' : `<button class="btn btn-yellow block" style="margin-top:10px" data-act="demo">Заполнить демо-данными</button><p class="hint">Добавит 16 игроков и 8 туров, чтобы посмотреть, как выглядит сайт. Потом всё можно удалить, загрузив пустую копию.</p>`}
      </section>
      <div class="gap"></div><section class="section"><button class="btn btn-gray block" data-act="logout">Выйти</button></section></main>`;
    return html;
  }

  /* ---------- Роутер ---------- */
  const routes = [
    [/^\/?$/, vTable, 'table'],
    [/^\/tours$/, vTours, 'tours'],
    [/^\/tour\/(.+)$/, vTour, 'tours'],
    [/^\/live$/, vLive, 'live'],
    [/^\/players$/, vPlayers, 'players'],
    [/^\/player\/(.+)$/, vPlayer, 'players'],
    [/^\/stats$/, vStats, 'stats'],
    [/^\/new$/, () => vDraft(null), 'tours'],
    [/^\/roster\/(.+)$/, vDraft, 'tours'],
    [/^\/settings$/, vSettings, null],
  ];
  let lastPath = null;

  function render() {
    if (!S.data) return;
    const path = location.hash.replace(/^#/, '') || '/';
    let html = null, tab = null;
    for (const [re, fn, t] of routes) {
      const m = path.match(re);
      if (m) { html = fn(...m.slice(1).map(decodeURIComponent)); tab = t; break; }
    }
    if (html === null) { html = vTable(); tab = 'table'; }
    const y = window.scrollY;
    view.innerHTML = html;
    if (path === lastPath) window.scrollTo(0, y); else window.scrollTo(0, 0);
    lastPath = path;
    document.querySelectorAll('.tabbar a').forEach((a) => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = S.data.name ? `${S.data.name} · Футбольная лига` : 'Футбольная лига';
    updateLiveDot();
  }
  function updateLiveDot() { $('#live-dot').hidden = !S.live; }

  /* ---------- Действия ---------- */
  const ACT = {
    period(d) { S.period = d.v; render(); },
    psort(d) { S.playerSort = d.v; render(); },
    expand(d) { S.expanded[d.key] = !S.expanded[d.key]; render(); },
    'close-modal'() { closeModal(); },
    logout() { logout(); toast('Вы вышли'); location.hash = '#/'; },

    async 'delete-tour'(d) {
      if (!confirm('Удалить тур со всеми матчами? Это нельзя отменить.')) return;
      if (await save((L) => { L.tours = L.tours.filter((t) => t.id !== d.tour); }, 'Тур удалён')) location.hash = '#/tours';
    },

    // лайв
    start(d) {
      const t = S.data.tours.find((x) => x.id === d.tour);
      S.live = { tourId: d.tour, a: d.a, b: d.b, events: [], acc: 0, run: null, len: S.data.matchLen || 420, matchId: null, n: t.matches.length + 1 };
      pushLive();
      if (location.hash !== '#/live') location.hash = '#/live'; else render();
    },
    'live-from-tour'(d) {
      if (S.live && !confirm('Уже идёт другой матч. Отменить его?')) return;
      S.live = null;
      const t = S.data.tours.find((x) => x.id === d.tour);
      const n = LG.nextPair(t);
      if (n && n.pair) ACT.start({ tour: t.id, a: n.pair[0], b: n.pair[1] });
      else { pushLive(); location.hash = '#/live'; }
    },
    'edit-match'(d) {
      if (S.live && !S.live.matchId && !confirm('Сейчас идёт матч. Отменить его и открыть старый?')) return;
      if (S.live && !S.live.matchId) api('PUT', '/api/live', { live: null }).catch(() => {});
      const t = S.data.tours.find((x) => x.id === d.tour);
      const i = t.matches.findIndex((m) => m.id === d.match);
      const m = t.matches[i];
      S.live = { tourId: t.id, a: m.a, b: m.b, events: clone(m.events || []), acc: 0, run: null, len: m.len || 420, matchId: m.id, n: i + 1 };
      store.set('fl-live', S.live);
      location.hash = '#/live';
      render();
    },
    clock() {
      const L = S.live;
      if (L.run) { L.acc += Date.now() - L.run; L.run = null; } else L.run = Date.now();
      pushLive(); render();
    },
    len(d) { S.live.len = Number(d.v); S.data.matchLen = Number(d.v); pushLive(); render(); },
    goal(d) {
      S.goal = { team: d.team, scorer: undefined, assist: null, own: false, ms: S.live.matchId ? null : elapsed(S.live) };
      openModal(goalModal);
    },
    'g-scorer'(d) { S.goal.scorer = d.v || null; if (S.goal.assist === S.goal.scorer) S.goal.assist = null; refreshModal(); },
    'g-assist'(d) { S.goal.assist = d.v || null; refreshModal(); },
    'g-own'() { S.goal.own = !S.goal.own; S.goal.scorer = undefined; S.goal.assist = null; refreshModal(); },
    'g-save'() {
      const g = S.goal;
      if (g.scorer === undefined && !g.own) g.scorer = null;
      S.live.events.push({ team: g.team, scorer: g.scorer || null, assist: g.own ? null : g.assist, own: g.own, ms: g.ms });
      S.goal = null;
      closeModal(); pushLive(); render();
    },
    'undo-goal'() { S.live.events.pop(); pushLive(); render(); },
    async finish() {
      const L = S.live;
      const match = { id: L.matchId || uid(), a: L.a, b: L.b, len: L.len, events: L.events };
      const ok = await save((D) => {
        const t = D.tours.find((x) => x.id === L.tourId);
        if (!t) throw new Error('Тур не найден');
        const i = t.matches.findIndex((m) => m.id === match.id);
        if (i >= 0) t.matches[i] = match; else t.matches.push(match);
      }, L.matchId ? 'Матч сохранён' : 'Матч записан');
      if (!ok) return;
      const tourId = L.tourId, edited = !!L.matchId;
      S.live = null;
      pushLive();
      if (edited) location.hash = '#/tour/' + enc(tourId); else render();
    },
    'cancel-live'() {
      if (!S.live.matchId && S.live.events.length && !confirm('Отменить матч? Голы не сохранятся.')) return;
      const back = S.live.matchId ? '#/tour/' + enc(S.live.tourId) : null;
      S.live = null; pushLive();
      if (back) location.hash = back; else render();
    },
    async 'delete-match'() {
      if (!confirm('Удалить этот матч?')) return;
      const L = S.live;
      if (await save((D) => { const t = D.tours.find((x) => x.id === L.tourId); t.matches = t.matches.filter((m) => m.id !== L.matchId); }, 'Матч удалён')) {
        const back = '#/tour/' + enc(L.tourId);
        S.live = null; store.del('fl-live'); location.hash = back;
      }
    },

    // игроки
    async 'toggle-gk'(d) {
      await save((D) => { const p = D.players.find((x) => x.name === d.name); if (p) p.gk = !p.gk; }, null);
      render();
    },
    async 'delete-player'(d) {
      if (!confirm(`Удалить игрока «${d.name}»?`)) return;
      if (await save((D) => { D.players = D.players.filter((p) => p.name !== d.name); }, 'Игрок удалён')) location.hash = '#/players';
    },

    // черновик тура
    'draft-k'(d) { S.draft.k = Number(d.v); S.draft.teams = null; render(); },
    'draft-toggle'(d) {
      const D = S.draft;
      D.selected = D.selected.includes(d.name) ? D.selected.filter((n) => n !== d.name) : [...D.selected, d.name];
      if (D.teams) {
        Object.keys(D.teams).forEach((k) => { D.teams[k] = D.teams[k].filter((n) => D.selected.includes(n)); });
        if (D.selected.includes(d.name)) {
          const k = Object.keys(D.teams).sort((x, y) => D.teams[x].length - D.teams[y].length)[0];
          D.teams[k].push(d.name);
        }
      }
      render();
    },
    'draft-balance'() {
      const D = S.draft;
      D.teams = LG.balanceTeams(D.selected, D.k, ratingFor, isGk).teams;
      render();
    },
    'draft-move'(d) {
      const T = S.draft.teams, keys = Object.keys(T);
      const from = keys.find((k) => T[k].includes(d.name));
      const to = keys[(keys.indexOf(from) + 1) % keys.length];
      T[from] = T[from].filter((n) => n !== d.name);
      T[to].push(d.name);
      render();
    },
    async 'draft-save'() {
      const D = S.draft;
      if (Object.values(D.teams).some((l) => !l.length)) { toast('В каждой команде должен быть хотя бы один игрок', 'error'); return; }
      const id = D.tourId || 't' + D.date + '-' + uid();
      const ok = await save((L) => {
        D.selected.forEach((n) => { if (!L.players.some((p) => p.name === n)) L.players.push({ name: n, gk: false }); });
        if (D.tourId) {
          const t = L.tours.find((x) => x.id === D.tourId);
          t.teams = clone(D.teams); t.date = D.date;
        } else {
          L.tours.push({ id, date: D.date, teams: clone(D.teams), matches: [] });
        }
      }, D.tourId ? 'Составы сохранены' : 'Тур создан');
      if (ok) { S.draft = null; location.hash = '#/tour/' + enc(id); }
    },

    // данные
    export() {
      const blob = new Blob([JSON.stringify(S.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `league-${todayStr()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async demo() {
      if (await save((L) => { const demo = LG.demoLeague(todayStr()); Object.assign(L, demo); }, 'Демо-данные загружены')) location.hash = '#/';
    },
  };

  const FORMS = {
    async login(f) {
      const pwd = f.password.value;
      try {
        S.pwd = pwd;
        await api('POST', '/api/login', { password: pwd });
        store.set('fl-pwd', pwd);
        toast('Вы вошли как организатор');
        render();
      } catch (e) { S.pwd = null; toast(e.message, 'error'); }
    },
    async league(f) {
      await save((L) => {
        L.name = f.name.value.trim() || 'Лига';
        L.season = f.season.value.trim();
        L.teamNames = {};
        LG.TEAM_KEYS.forEach((k) => { L.teamNames[k] = f['team-' + k].value.trim() || LG.DEFAULT_TEAM_NAMES[k]; });
      }, 'Сохранено');
      render();
    },
    async rename(f) {
      const from = f.dataset.name, to = f.to.value.trim();
      if (!to || to === from) return;
      let next;
      try { next = LG.renamePlayer(S.data, from, to); } catch (e) { toast(e.message, 'error'); return; }
      if (S.live) { toast('Сначала завершите текущий матч', 'error'); return; }
      if (await save((L) => { Object.assign(L, next); }, 'Игрок переименован')) location.hash = playerHref(to);
    },
    'add-player'(f) {
      const name = f.name.value.trim();
      if (!name) return;
      const D = S.draft;
      if (!D.selected.includes(name)) D.selected.push(name);
      if (D.teams) {
        const k = Object.keys(D.teams).sort((x, y) => D.teams[x].length - D.teams[y].length)[0];
        D.teams[k].push(name);
      }
      render();
      const input = document.querySelector('[data-form="add-player"] input');
      if (input) input.focus();
    },
  };

  const INPUTS = {
    search(el) {
      S.search = el.value;
      const pos = el.selectionStart;
      render();
      const n = document.querySelector('[data-input="search"]');
      n.focus(); n.setSelectionRange(pos, pos);
    },
    'draft-date'(el) { if (el.value) S.draft.date = el.value; },
    import(el) {
      const file = el.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        let data;
        try { data = JSON.parse(reader.result); } catch (e) { toast('Файл не похож на копию лиги', 'error'); return; }
        if (!Array.isArray(data.players) || !Array.isArray(data.tours)) { toast('В файле нет игроков и туров', 'error'); return; }
        if (!confirm('Заменить все данные лиги содержимым файла?')) return;
        if (await save((L) => { Object.keys(L).forEach((k) => delete L[k]); Object.assign(L, data); }, 'Данные загружены')) render();
      };
      reader.readAsText(file);
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset, el); }
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    const fn = FORMS[f.dataset.form];
    if (fn) fn(f);
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input]');
    if (el && el.type !== 'file' && INPUTS[el.dataset.input]) INPUTS[el.dataset.input](el);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-input]');
    if (el && el.type === 'file') INPUTS[el.dataset.input](el);
  });
  $('#backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalOpen()) closeModal(); });
  window.addEventListener('hashchange', render);

  /* ---------- Часы и обновления ---------- */
  setInterval(() => {
    if (!S.live || S.live.matchId) return;
    document.querySelectorAll('[data-clock]').forEach((el) => {
      el.textContent = clockText(S.live);
      el.classList.toggle('over', elapsed(S.live) > (S.live.len || 420) * 1000);
    });
  }, 1000);

  let polling = false;
  async function poll() {
    if (polling || document.hidden) return;
    polling = true;
    try {
      const r = await api('GET', '/api/live');
      if (r.version !== S.version) {
        await load();
        if (!modalOpen() && !/^#\/(new|roster)/.test(location.hash)) render();
      } else if (!isEditor() && JSON.stringify(r.live) !== JSON.stringify(S.live)) {
        S.live = r.live;
        if (!modalOpen()) render();
      }
    } catch (e) { /* сеть пропала — попробуем позже */ }
    polling = false;
  }
  let pollTimer = null;
  function schedulePoll() {
    clearTimeout(pollTimer);
    const fast = S.live || location.hash.startsWith('#/live');
    pollTimer = setTimeout(async () => { await poll(); schedulePoll(); }, fast ? 4000 : 30000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); schedulePoll(); } });

  /* ---------- Старт ---------- */
  (async function boot() {
    try {
      await load();
      render();
    } catch (e) {
      view.innerHTML = `<div class="section">${empty('📡', 'Не получилось загрузить лигу', 'Проверьте интернет и обновите страницу.')}</div>`;
    }
    schedulePoll();
  })();
})();
