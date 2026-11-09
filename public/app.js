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
  const fix1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  // Оттенок аватара по имени (0–359), чтобы у каждого игрока был свой цвет
  const hueFor = (s) => {
    let h = 2166136261;
    for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    h ^= h >>> 15;
    return (h >>> 0) % 360;
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const isGk = (name) => !!(S.data.players.find((p) => p.name === name) || {}).gk;

  const tn = (k) => LG.teamName(S.data, k);
  const avatar = (name, size) => `<span class="ava ${size || ''}" style="--h:${hueFor(name)}">${esc(initials(name))}</span>`;
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
  const TINTS = { R: 'rgba(255,69,58,.55)', B: 'rgba(10,132,255,.6)', G: 'rgba(48,209,88,.5)', Y: 'rgba(255,214,10,.42)' };
  const DEFAULT_TINT = 'rgba(48,209,88,.42)';
  let tint = [DEFAULT_TINT, 'transparent'];
  const setTint = (a, b) => { tint = [a || DEFAULT_TINT, b || 'transparent']; };

  // Футболка в цвете команды
  const kit = (k, size) => `<svg class="kit ${size || ''}" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M10.6 4.2 4 7.8l2.6 6.1 3-1.3V28h12.8V12.6l3 1.3L28 7.8l-6.6-3.6c-1 1.9-3 3.1-5.4 3.1s-4.4-1.2-5.4-3.1z" fill="var(--${k})"/>
    <path d="M10.6 4.2 4 7.8l2.6 6.1 3-1.3V28h12.8V12.6l3 1.3L28 7.8l-6.6-3.6c-1 1.9-3 3.1-5.4 3.1s-4.4-1.2-5.4-3.1z" fill="url(#kit-shade)"/>
    <path d="M10.6 4.2c1 1.9 3 3.1 5.4 3.1s4.4-1.2 5.4-3.1" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/></svg>`;
  const gkTag = (name) => (isGk(name) ? '<span class="gk" title="Вратарь">ВР</span>' : '');
  const head = (title, sub, right) => `<header class="head"><h1 class="title">${title}${sub ? `<small>${sub}</small>` : ''}</h1>${right || ''}</header>`;
  const mainRight = () => (isEditor()
    ? `<a class="glass-btn round" href="#/settings" aria-label="Настройки">${icon('gear')}</a>`
    : `<a class="glass-btn" href="#/settings">${icon('lock')}Войти</a>`);
  const backRow = (href, right) => `<div class="back-row"><a class="glass-btn round" href="${href}" aria-label="Назад">${icon('back')}</a>${right || ''}</div>`;
  const empty = (ic, title, text, action) => `<div class="empty">${ic ? icon(ic) : ''}<b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}${action || ''}</div>`;
  const panelHead = (title, right) => `<div class="panel-head left"><span>${title}</span>${right || ''}</div>`;
  const moreLink = (href, label) => `<a class="link" href="${href}">${label}${icon('chev')}</a>`;

  function periodSegments(inPanel) {
    const months = LG.monthsOf(S.data);
    if (months.length < 2) return '';
    const seg = (v, label) => `<button class="seg" data-act="period" data-v="${v}" aria-pressed="${S.period === v}">${esc(label)}</button>`;
    return `<div class="segments ${inPanel ? 'inner' : 'bar'}">${seg('all', 'Всё время')}${months.map((m) => seg(m, fmtMonth(m))).join('')}</div>`;
  }

  function eventText(e) {
    if (e.own) return `${esc(e.scorer || '?')} <span class="dim">(авт.)</span>`;
    return `${esc(e.scorer || 'Без автора')}${e.assist ? ` <span class="dim">(${esc(e.assist)})</span>` : ''}`;
  }
  const minute = (e) => (e.ms != null ? `${Math.floor(e.ms / 60000) + 1}′` : '');

  function gameHtml(t, m, n, editable, compact) {
    const s = LG.matchScore(m);
    const evA = (m.events || []).filter((e) => e.team === m.a);
    const evB = (m.events || []).filter((e) => e.team === m.b);
    const scorers = evA.length || evB.length
      ? `<div class="scorers"><div>${evA.map(eventText).join('<br>')}</div><div class="b">${evB.map(eventText).join('<br>')}</div></div>` : '';
    return `<div class="game ${editable ? 'editable' : ''} ${compact ? 'compact' : ''}" ${editable ? `data-act="edit-match" data-tour="${esc(t.id)}" data-match="${esc(m.id)}" title="Изменить матч"` : ''}>
      <div class="team a">${kit(m.a, compact ? '' : 'l')}<span>${esc(tn(m.a))}</span></div>
      <div class="mid"><span class="score ${s.a < s.b ? 'lose' : ''}">${s.a}</span><span class="state">${compact ? ':' : `Матч<b>${n}</b>`}</span><span class="score ${s.b < s.a ? 'lose' : ''}">${s.b}</span></div>
      <div class="team b">${kit(m.b, compact ? '' : 'l')}<span>${esc(tn(m.b))}</span></div>
      ${scorers}
    </div>`;
  }

  const liveScore = (L) => LG.matchScore({ a: L.a, b: L.b, events: L.events });
  const elapsed = (L) => (L.acc || 0) + (L.run ? Date.now() - L.run : 0);
  function clockText(L) {
    const left = (L.len || 420) * 1000 - elapsed(L);
    const a = Math.abs(left);
    return (left < 0 ? '+' : '') + Math.floor(a / 60000) + ':' + pad(Math.floor((a % 60000) / 1000));
  }

  function liveStrip() {
    const L = S.live;
    if (!L || L.matchId) return '';
    const s = liveScore(L);
    return `<a class="panel live-strip" href="#/live"><span><span class="live-dot"></span>Идёт матч</span>
      ${kit(L.a)} <span class="dim">—</span> ${kit(L.b)}<span class="sc">${s.a}:${s.b}</span></a>`;
  }

  /* ---------- Таблица ---------- */
  // Итог тура: команды по местам. full — с названиями (главная), иначе только футболки и очки
  function tourSummary(t, info, full) {
    if (full) {
      return `<div class="places-grid">${info.standings.map((s, i) => `<div class="pl ${i === 0 && s.games ? 'first' : ''}">${kit(s.key, 'l')}<span class="nm">${esc(tn(s.key))}</span><b>${s.pts}</b></div>`).join('')}</div>`;
    }
    return `<div class="places-row">${info.standings.map((s, i) => `<span class="pl ${i === 0 && s.games ? 'first' : ''}" title="${esc(tn(s.key))}">${kit(s.key)}<b>${s.pts}</b></span>`).join('')}</div>`;
  }

  function vTable() {
    const st = stats();
    const all = allStats();
    let html = head(esc(S.data.name || 'Лига'),
      [S.data.season ? esc(S.data.season) : '', nWord(all.tours.length, 'тур', 'тура', 'туров')].filter(Boolean).join(' · '), mainRight());

    if (!all.tours.length) {
      return html + `<section class="panel">${empty('cal', 'Пока нет ни одного тура',
        isEditor() ? 'Создайте первый тур: выберите игроков, и сайт сам подберёт равные составы.' : 'Организатор ещё не внёс игры.',
        isEditor() ? `<a class="btn btn-white" href="#/new">${icon('plus')}Новый тур</a>` : '')}</section>`;
    }

    html += liveStrip();

    // Последний тур
    const last = all.tours[all.tours.length - 1];
    const info = all.tourInfo[last.id];
    html += `<a class="panel tour-card" href="#/tour/${enc(last.id)}">
      <div class="panel-head left"><span>Последний тур</span><span class="link">${fmtDate(last.date)}${icon('chev')}</span></div>
      <div class="panel-body">${tourSummary(last, info, true)}</div>
      ${info.mvp ? `<div class="sep"></div><div class="mvp">${avatar(info.mvp.name)}
        <div class="who"><span><svg class="star"><use href="#i-star"/></svg> MVP тура</span><b>${esc(info.mvp.name)}</b></div>
        <div class="big"><b>${info.mvp.score}</b><span>${plural(info.mvp.score, 'балл', 'балла', 'баллов')}</span></div></div>` : ''}
    </a>`;

    // Таблица
    html += `<section class="panel">${panelHead('Таблица')}${periodSegments(true)}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th class="name">Игрок</th><th>И</th><th>В</th><th>Н</th><th>П</th><th>+/−</th><th>О</th></tr></thead><tbody>
      ${st.list.map((p) => {
        let mv = '';
        if (p.prevPos != null && p.prevPos !== p.pos) mv = p.prevPos > p.pos ? `<span class="mv up">▲${p.prevPos - p.pos}</span>` : `<span class="mv down">▼${p.pos - p.prevPos}</span>`;
        return `<tr><td>${p.pos}${mv}</td>
          <td class="name"><a href="${playerHref(p.name)}">${avatar(p.name, 's')}<span class="t">${esc(p.name)}</span>${gkTag(p.name)}</a></td>
          <td>${p.games}</td><td>${p.w}</td><td>${p.d}</td><td>${p.l}</td><td>${p.gd > 0 ? '+' : ''}${p.gd}</td><td class="pts">${p.pts}</td></tr>`;
      }).join('')}
      </tbody></table></div>
      <p class="caption">Очки игрока — очки его команды в матчах, где он играл</p></section>`;

    if (S.period === 'all') {
      const mm = LG.monthMVPs(S.data, todayStr());
      if (mm.length) {
        html += `<section class="panel">${panelHead('MVP месяца')}<ul class="list">${mm.map((x) => `<li><a class="item" href="${playerHref(x.player.name)}">${avatar(x.player.name)}
          <span class="main"><span class="nm">${esc(x.player.name)}</span><span class="sub">${esc(fmtMonth(x.month))}</span></span>
          <span class="val"><b>${x.score}</b><span>${plural(x.score, 'балл', 'балла', 'баллов')}</span></span></a></li>`).join('')}</ul></section>`;
      }
    }
    return html;
  }

  /* ---------- Туры ---------- */
  function vTours() {
    const st = allStats();
    let html = head('Туры', st.tours.length ? nWord(st.tours.length, 'тур', 'тура', 'туров') : '',
      isEditor() ? `<a class="glass-btn" href="#/new">${icon('plus')}Тур</a>` : mainRight());
    html += liveStrip();
    if (!st.tours.length) {
      return html + `<section class="panel">${empty('cal', 'Туров пока нет', isEditor() ? 'Нажмите «Тур», чтобы собрать составы.' : 'Организатор ещё не внёс игры.')}</section>`;
    }
    html += `<section class="panel">${[...st.tours].reverse().map((t) => {
      const info = st.tourInfo[t.id];
      return `<a class="tour-row" href="#/tour/${enc(t.id)}">
        <div class="top"><span class="d">${fmtDate(t.date)}</span>${info.mvp ? `<span class="m"><svg class="star"><use href="#i-star"/></svg>${esc(info.mvp.name)}</span>` : ''}</div>
        ${tourSummary(t, info)}
      </a>`;
    }).join('')}</section>`;
    return html;
  }

  function vTour(id) {
    const t = S.data.tours.find((x) => x.id === id);
    if (!t) return backRow('#/tours') + `<section class="panel" style="margin-top:16px">${empty('cal', 'Тур не найден', 'Возможно, его удалили.')}</section>`;
    const info = allStats().tourInfo[t.id];
    const ed = isEditor();
    const winner = info.standings[0];
    if (winner && winner.games) setTint(TINTS[winner.key], info.standings[1] && TINTS[info.standings[1].key].replace(/[\d.]+\)$/, '.25)'));

    let html = backRow('#/tours') + head(fmtDate(t.date), info.mvp ? `MVP — ${esc(info.mvp.name)}` : fmtWeekday(t.date));
    if (ed) {
      html += `<div class="btn-row" style="margin:0 0 12px">
        <button class="btn btn-white" data-act="live-from-tour" data-tour="${esc(t.id)}">${icon('play')}Матч</button>
        <a class="btn btn-glass" href="#/roster/${enc(t.id)}">${icon('edit')}Составы</a></div>`;
    }

    html += `<section class="panel">${panelHead('Таблица тура')}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th class="name">Команда</th><th>И</th><th>В</th><th>Н</th><th>П</th><th>Мячи</th><th>О</th></tr></thead><tbody>
      ${info.standings.map((s, i) => `<tr><td>${i + 1}</td><td class="name"><span class="n">${kit(s.key)}<span class="t">${esc(tn(s.key))}</span></span></td>
        <td>${s.games}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td><td>${s.gf}:${s.ga}</td><td class="pts">${s.pts}</td></tr>`).join('')}
      </tbody></table></div><div style="height:8px"></div></section>`;

    html += `<section class="panel">${panelHead(`Матчи <span class="count">${t.matches.length}</span>`)}
      ${t.matches.length ? `<div class="panel-body" style="padding-top:0">${t.matches.map((m, i) => gameHtml(t, m, i + 1, ed, true)).join('')}</div>`
        : empty('', 'Матчей ещё не было', ed ? 'Нажмите «Матч», чтобы начать первый.' : '')}</section>`;

    if (info.players.length && t.matches.length) {
      html += `<section class="panel">${panelHead('Лучшие в туре')}<ul class="list">
        ${info.players.slice(0, 5).map((p, i) => `<li><a class="item" href="${playerHref(p.name)}">
          <span class="rank">${i === 0 ? '<svg class="star"><use href="#i-star"/></svg>' : i + 1}</span>${avatar(p.name)}
          <span class="main"><span class="nm">${esc(p.name)}${gkTag(p.name)}</span><span class="sub">${kit(p.key)} ${[p.goals ? nWord(p.goals, 'гол', 'гола', 'голов') : '', p.assists ? nWord(p.assists, 'пас', 'паса', 'пасов') : '', nWord(p.w, 'победа', 'победы', 'побед')].filter(Boolean).join(' · ')}</span></span>
          <span class="val"><b>${p.score}</b><span>${plural(p.score, 'балл', 'балла', 'баллов')}</span></span></a></li>`).join('')}
        </ul><p class="caption">Гол и пас — 2 балла, победа — 2, ничья и сухой матч — 1</p></section>`;
    }

    html += `<section class="panel">${panelHead('Составы')}${Object.entries(t.teams).map(([k, names]) => {
      const place = info.standings.findIndex((s) => s.key === k) + 1;
      return `<div class="roster"><h3>${kit(k)}${esc(tn(k))}<span class="muted">${place ? place + '-е' : ''}</span></h3>
        <div class="chips">${names.map((n) => `<a class="chip" href="${playerHref(n)}">${esc(n)}${gkTag(n)}</a>`).join('')}</div></div>`;
    }).join('')}</section>`;

    if (ed) html += `<button class="btn btn-danger block" style="margin-top:12px" data-act="delete-tour" data-tour="${esc(t.id)}">${icon('trash')}Удалить тур</button>`;
    return html;
  }

  /* ---------- Матч (лайв) ---------- */
  function currentTour() {
    const ts = LG.sortedTours(S.data);
    return ts[ts.length - 1] || null;
  }

  function vLive() {
    const L = S.live;
    const ed = isEditor();

    if (L) {
      const t = S.data.tours.find((x) => x.id === L.tourId);
      if (!t) {
        if (ed) { S.live = null; pushLive(); }
        return head('Матч') + `<section class="panel">${empty('', 'Тур этого матча удалён', '')}</section>`;
      }
      setTint(TINTS[L.a], TINTS[L.b]);
      const s = liveScore(L);
      const editing = !!L.matchId;
      const over = elapsed(L) > (L.len || 420) * 1000;
      let html = editing ? backRow('#/tour/' + enc(t.id)) : '';
      html += `<section class="match-hero" style="${editing ? '' : 'padding-top:max(26px, calc(env(safe-area-inset-top) + 16px))'}">
        <div class="meta">${editing ? 'Изменение матча' : (L.run ? '<span class="live-dot"></span>LIVE' : 'Пауза')} · Матч ${L.n || t.matches.length + 1} · ${fmtDate(t.date)}</div>
        <div class="row">
          <div class="side">${kit(L.a, 'xl')}${esc(tn(L.a))}</div>
          <div class="score"><span class="${s.a < s.b ? 'dim' : ''}">${s.a}</span><i>:</i><span class="${s.b < s.a ? 'dim' : ''}">${s.b}</span></div>
          <div class="side">${kit(L.b, 'xl')}${esc(tn(L.b))}</div>
        </div>
        ${editing ? '' : `<div class="clock ${over ? 'over' : ''}" data-clock>${clockText(L)}</div>`}
      </section>`;

      if (L.events.length) {
        let ra = 0, rb = 0;
        html += `<section class="panel">${panelHead('Голы')}<div class="timeline">${L.events.map((e) => {
          if (e.team === L.a) ra++; else rb++;
          const who = `<div class="who ${e.team === L.a ? 'b' : 'a'}"><b>${eventText(e)}</b><span>${ra}:${rb}</span></div>`;
          return `<div class="tl">${e.team === L.a ? who + `<div class="min">${minute(e) || '⚽'}</div><div></div>` : `<div></div><div class="min">${minute(e) || '⚽'}</div>` + who}</div>`;
        }).join('')}</div></section>`;
      }

      if (ed) {
        html += `<section class="panel"><div class="controls">
          <button class="btn btn-glass" data-act="goal" data-team="${L.a}">${kit(L.a)}Гол</button>
          <button class="btn btn-glass" data-act="goal" data-team="${L.b}">${kit(L.b)}Гол</button>
          ${editing ? '' : `<button class="btn btn-glass" data-act="clock">${icon(L.run ? 'pause' : 'play')}${L.run ? 'Пауза' : (elapsed(L) ? 'Дальше' : 'Старт')}</button>`}
          <button class="btn btn-glass ${editing ? 'full' : ''}" data-act="undo-goal" ${L.events.length ? '' : 'disabled'}>${icon('undo')}Убрать гол</button>
          <button class="btn btn-white full" data-act="finish">${icon('check')}${editing ? 'Сохранить матч' : 'Завершить матч'}</button>
        </div>
        ${editing ? '' : `<div class="sep"></div><div class="segments" style="padding-bottom:12px">${[5, 7, 8, 10, 12].map((m) => `<button class="seg" data-act="len" data-v="${m * 60}" aria-pressed="${(L.len || 420) === m * 60}">${m} мин</button>`).join('')}</div>`}
        </section>
        <div class="btn-row" style="margin-top:12px">
          ${editing ? `<button class="btn btn-danger sm" data-act="delete-match">${icon('trash')}Удалить</button>` : ''}
          <button class="btn btn-glass sm" data-act="cancel-live">${editing ? 'Не сохранять' : 'Отменить матч'}</button></div>`;
      }

      if (!editing && Object.keys(t.teams).length > 2) {
        const n = LG.nextPair({ teams: t.teams }, [...t.matches, { a: L.a, b: L.b, events: L.events }]);
        if (n) {
          html += `<p class="caption" style="margin-top:16px">Если счёт не изменится, дальше играют
            ${n.pair ? `${kit(n.pair[0])} ${esc(tn(n.pair[0]))} и ${esc(tn(n.pair[1]))} ${kit(n.pair[1])}` : `${esc(tn(n.waiting))} с одной из команд — ничья, выберет организатор`}</p>`;
        }
      }
      return html;
    }

    const t = currentTour();
    let html = head('Матч', t ? `Тур ${fmtDate(t.date)}` : '', mainRight());
    if (!ed) {
      html += `<section class="panel">${empty('ball', 'Сейчас матч не идёт', 'Когда организатор начнёт матч, здесь появятся счёт, таймер и голы.')}</section>`;
      if (t && t.matches.length) {
        const i = t.matches.length - 1;
        html += `<section class="panel">${panelHead('Последний матч', moreLink('#/tour/' + enc(t.id), 'Весь тур'))}<div class="panel-body" style="padding-top:0">${gameHtml(t, t.matches[i], i + 1, false)}</div></section>`;
      }
      return html;
    }
    if (!t) {
      return html + `<section class="panel">${empty('cal', 'Сначала создайте тур', 'В туре задаются составы команд, после этого можно вести матчи.',
        `<a class="btn btn-white" href="#/new">${icon('plus')}Новый тур</a>`)}</section>`;
    }

    const keys = Object.keys(t.teams);
    const n = LG.nextPair(t);
    if (t.date < todayStr()) html += `<p class="hint" style="margin:-4px 4px 12px">Это прошедший тур. Для новой игры <a href="#/new" style="text-decoration:underline">создайте тур</a>.</p>`;
    if (n && n.pair) {
      setTint(TINTS[n.pair[0]], TINTS[n.pair[1]]);
      html += `<section class="panel">${panelHead(`Следующий · матч ${t.matches.length + 1}`)}
        <div class="panel-body"><div class="game"><div class="team">${kit(n.pair[0], 'l')}<span>${esc(tn(n.pair[0]))}</span></div>
          <div class="mid"><span></span><span class="state">против</span><span></span></div>
          <div class="team">${kit(n.pair[1], 'l')}<span>${esc(tn(n.pair[1]))}</span></div></div>
        <button class="btn btn-white block" data-act="start" data-tour="${esc(t.id)}" data-a="${n.pair[0]}" data-b="${n.pair[1]}">${icon('play')}Начать матч</button></div></section>`;
    } else if (n && n.draw) {
      html += `<section class="panel">${panelHead('Прошлый матч — ничья')}<div class="panel-body">
        <p class="hint" style="margin-bottom:12px">Кто остаётся играть с командой «${esc(tn(n.waiting))}»?</p>
        <div class="btn-row">${n.draw.map((k) => `<button class="btn btn-glass" data-act="start" data-tour="${esc(t.id)}" data-a="${k}" data-b="${n.waiting}">${kit(k)}${esc(tn(k))}</button>`).join('')}</div></div></section>`;
    }
    if (keys.length > 2) {
      const pairs = [];
      keys.forEach((a, i) => keys.slice(i + 1).forEach((b) => pairs.push([a, b])));
      html += `<section class="panel">${panelHead('Другая пара')}<div class="panel-body"><div class="chips">${pairs.map(([a, b]) => `<button class="chip" data-act="start" data-tour="${esc(t.id)}" data-a="${a}" data-b="${b}">${kit(a)}${esc(tn(a))} — ${esc(tn(b))}${kit(b)}</button>`).join('')}</div></div></section>`;
    }
    if (t.matches.length) {
      html += `<section class="panel">${panelHead(`Сыграно <span class="muted">${t.matches.length}</span>`)}<div class="panel-body" style="padding-top:0">${t.matches.map((m, i) => gameHtml(t, m, i + 1, true, true)).reverse().join('')}</div></section>`;
    }
    return html;
  }

  function goalModal() {
    const L = S.live, g = S.goal;
    const t = S.data.tours.find((x) => x.id === L.tourId);
    const other = g.team === L.a ? L.b : L.a;
    const scorers = g.own ? (t.teams[other] || []) : (t.teams[g.team] || []);
    const assists = (t.teams[g.team] || []).filter((n) => n !== g.scorer);
    const chip = (act, v, label, on) => `<button class="chip ${on ? 'on' : ''}" data-act="${act}" data-v="${esc(v)}">${label}</button>`;
    return `<div class="modal-head"><button class="link-btn" data-act="close-modal">Отмена</button><h2>${kit(g.team)}Гол · ${esc(tn(g.team))}</h2><span></span></div>
      <div class="group"><h3>${g.own ? `Кто срезал в свои ворота (${esc(tn(other))})` : 'Кто забил'}</h3><div class="chips">
        ${scorers.map((n) => chip('g-scorer', n, esc(n), g.scorer === n)).join('')}
        ${g.own ? '' : chip('g-scorer', '', 'Не знаю', g.scorer === null)}</div></div>
      ${g.own ? '' : `<div class="group"><h3>Голевой пас</h3><div class="chips">
        ${chip('g-assist', '', 'Без паса', !g.assist)}
        ${assists.map((n) => chip('g-assist', n, esc(n), g.assist === n)).join('')}</div></div>`}
      <div class="group"><div class="chips">${chip('g-own', '', 'Автогол', g.own)}</div></div>
      <div class="group"><button class="btn btn-white block" data-act="g-save" ${g.own && !g.scorer ? 'disabled' : ''}>${icon('check')}Засчитать гол</button></div>`;
  }

  /* ---------- Игроки ---------- */
  function vPlayers() {
    const st = allStats();
    const sorts = { rating: ['Рейтинг', (p) => p.rating - (p.smallSample ? 100 : 0)], pts: ['Очки', (p) => p.pts], goals: ['Голы', (p) => p.goals * 1000 + p.assists], assists: ['Пасы', (p) => p.assists * 1000 + p.goals], games: ['Матчи', (p) => p.games] };
    const [, f] = sorts[S.playerSort] || sorts.rating;
    const q = S.search.trim().toLowerCase();
    const list = [...st.list].filter((p) => !q || p.name.toLowerCase().includes(q)).sort((a, b) => f(b) - f(a) || a.name.localeCompare(b.name, 'ru'));
    const idle = S.data.players.filter((p) => !st.byName[p.name] && (!q || p.name.toLowerCase().includes(q)));
    const valOf = {
      rating: (p) => `<span class="rating ${p.smallSample ? 'dim' : p.rating >= 85 ? 'hi' : ''}">${p.rating}</span>`,
      pts: (p) => `<b>${p.pts}</b>`, goals: (p) => `<b>${p.goals}</b>`, assists: (p) => `<b>${p.assists}</b>`, games: (p) => `<b>${p.games}</b>`,
    }[S.playerSort] || ((p) => `<b>${p.rating}</b>`);

    let html = head('Игроки', nWord(S.data.players.length, 'игрок', 'игрока', 'игроков'), mainRight());
    html += `<label class="input search">${icon('search')}<input type="search" data-input="search" value="${esc(S.search)}" placeholder="Найти игрока" aria-label="Поиск игрока"></label>
      <div class="segments bar">${Object.entries(sorts).map(([k, [label]]) => `<button class="seg" data-act="psort" data-v="${k}" aria-pressed="${S.playerSort === k}">${label}</button>`).join('')}</div>
      <section class="panel"><ul class="list" id="player-list">`;
    if (!list.length && !idle.length) html += `<li>${empty('search', q ? 'Никого не нашлось' : 'Игроков пока нет', q ? '' : 'Игроки появятся, когда организатор создаст тур.')}</li>`;
    html += list.map((p) => `<li><a class="item" href="${playerHref(p.name)}">${avatar(p.name)}
        <span class="main"><span class="nm">${esc(p.name)}${gkTag(p.name)}</span><span class="sub">${nWord(p.games, 'матч', 'матча', 'матчей')} · ${p.goals} г · ${p.assists} п</span></span>
        <span class="val">${valOf(p)}</span></a></li>`).join('');
    html += idle.map((p) => `<li><a class="item" href="${playerHref(p.name)}">${avatar(p.name)}<span class="main"><span class="nm">${esc(p.name)}</span><span class="sub">ещё не играл</span></span></a></li>`).join('');
    return html + `</ul>${S.playerSort === 'rating' ? '<p class="caption" style="padding-top:8px">Рейтинг 50–99 считается по атаке, защите, голам, пасам и победам. Серый — мало матчей</p>' : ''}</section>`;
  }

  function radarSvg(r, h) {
    const axes = [['Атака', r.attack], ['Защита', r.defense], ['Голы', r.goals], ['Пасы', r.passes], ['Победы', r.wins], ['Очки', r.points]];
    const cx = 165, cy = 128, R = 88;
    const pt = (i, v) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
      return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
    };
    const ring = (v) => axes.map((_, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
    const pts = axes.map(([, v], i) => pt(i, Math.max(0.04, v / 100)));
    return `<svg class="radar" viewBox="0 0 330 262" style="--h:${h}" role="img" aria-label="Профиль игрока: ${axes.map(([k, v]) => `${k} ${v}`).join(', ')}">
      ${[0.25, 0.5, 0.75, 1].map((v) => `<polygon class="grid" points="${ring(v)}"/>`).join('')}
      ${axes.map((_, i) => { const [x, y] = pt(i, 1); return `<line class="grid" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('')}
      <polygon class="area" points="${pts.map((p) => p.map((x) => x.toFixed(1)).join(',')).join(' ')}"/>
      ${pts.map(([x, y]) => `<circle class="pt" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`).join('')}
      ${axes.map(([k, v], i) => {
        const [x, y] = pt(i, 1.2);
        const anchor = Math.abs(x - cx) < 5 ? 'middle' : x > cx ? 'start' : 'end';
        return `<text x="${x.toFixed(1)}" y="${(y + (y < cy ? -2 : 9)).toFixed(1)}" text-anchor="${anchor}">${k} <tspan class="pct">${v}</tspan></text>`;
      }).join('')}
    </svg>`;
  }

  function sparkSvg(ranks, total) {
    const pts = ranks.map((r, i) => [i, r]).filter(([, r]) => r != null);
    if (pts.length < 2) return '';
    const W = 320, H = 64, P = 7;
    const maxR = Math.max(total, ...pts.map(([, r]) => r));
    const x = (i) => P + (i / (ranks.length - 1)) * (W - 2 * P);
    const y = (r) => P + ((r - 1) / Math.max(1, maxR - 1)) * (H - 2 * P);
    const d = pts.map(([i, r], j) => `${j ? 'L' : 'M'}${x(i).toFixed(1)},${y(r).toFixed(1)}`).join(' ');
    const area = `${d} L${x(pts[pts.length - 1][0]).toFixed(1)},${H} L${x(pts[0][0]).toFixed(1)},${H} Z`;
    const [li, lr] = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Место в таблице по турам, сейчас ${lr}">
      <defs><linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <path class="a" d="${area}"/><path class="l" d="${d}"/><circle cx="${x(li).toFixed(1)}" cy="${y(lr).toFixed(1)}" r="4"/></svg>`;
  }

  function vPlayer(name) {
    const st = allStats();
    const p = st.byName[name];
    const known = S.data.players.find((x) => x.name === name);
    if (!p && !known) return backRow('#/players') + `<section class="panel" style="margin-top:16px">${empty('users', 'Игрок не найден', '')}</section>`;
    const ed = isEditor();
    const h = hueFor(name);
    setTint(`hsl(${h} 70% 45% / .55)`, `hsl(${(h + 40) % 360} 70% 40% / .3)`);

    let html = backRow('#/players') + `<section style="display:grid;justify-items:center;gap:12px;text-align:center;padding:8px 0 22px">
      ${avatar(name, 'xl')}
      <h1 class="title">${esc(name)}${gkTag(name)}</h1>
      ${p ? `<div class="hero-pills"><span><b>${p.pos}</b> место</span><span><b>${p.rating}</b> рейтинг</span><span><b>${fix1(p.ppg)}</b> очк/матч</span></div>` : '<p class="hint">Ещё не играл</p>'}</section>`;

    if (p) {
      const tiles = [['Матчи', p.games], ['Очки', p.pts], ['Побед', Math.round(p.winPct) + '%'], ['Голы', p.goals], ['Пасы', p.assists], ['Сухие', p.cs]];
      html += `<section class="panel"><div class="stat-grid">${tiles.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('')}</div></section>
        <section class="panel">${panelHead('Профиль')}<div class="panel-body">${radarSvg(p.radar, h)}</div>
        <p class="caption">Сколько процентов игроков хуже${p.smallSample ? ' · пока мало матчей' : ''}</p></section>`;

      const hist = p.history.slice(-10).reverse();
      const spark = sparkSvg(p.rankAfter || [], st.list.length);
      html += `<section class="panel">${panelHead('Форма', '<span class="muted" style="font-size:13px;font-weight:500">место в турах</span>')}
        <div class="form-row">${hist.map((x) => `<a class="${x.place === 1 ? 'p1' : x.place === x.teams ? 'plast' : ''}" href="#/tour/${enc(x.tourId)}" title="${fmtDate(x.date)}: ${x.place}-е место, голы ${x.goals}, пасы ${x.assists}">${x.place}</a>`).join('')}</div>
        ${spark ? `<div class="sep" style="margin-top:12px"></div>${panelHead('Место в таблице')}<div class="panel-body">${spark}</div>` : '<div style="height:10px"></div>'}
      </section>`;

      const partners = st.pairs.filter((x) => (x.a === name || x.b === name) && x.games >= 3)
        .map((x) => ({ ...x, other: x.a === name ? x.b : x.a })).sort((a, b) => b.ppg - a.ppg || b.games - a.games).slice(0, 3);
      if (partners.length) {
        html += `<section class="panel">${panelHead('Лучшие партнёры')}<ul class="list">${partners.map((x) => `<li><a class="item" href="${playerHref(x.other)}">${avatar(x.other)}
          <span class="main"><span class="nm">${esc(x.other)}</span><span class="sub">${nWord(x.games, 'матч', 'матча', 'матчей')} вместе · ${x.w}-${x.d}-${x.l}</span></span>
          <span class="val"><b>${fix1(x.ppg)}</b><span>очк/матч</span></span></a></li>`).join('')}</ul></section>`;
      }
      // связка интересна, только если повторялась
      const feeds = st.links.filter((l) => l.to === name && l.count >= 2).slice(0, 3);
      const gives = st.links.filter((l) => l.from === name && l.count >= 2).slice(0, 3);
      const linkList = (arr, key, label) => `<li><div class="item" style="padding-bottom:4px"><span class="sub">${label}</span></div></li>${arr.map((l) => `<li><a class="item" href="${playerHref(l[key])}">${avatar(l[key], 's')}<span class="main"><span class="nm">${esc(l[key])}</span></span><span class="val"><b style="font-size:16px">${l.count}</b></span></a></li>`).join('')}`;
      if (feeds.length || gives.length) {
        html += `<section class="panel">${panelHead('Голевые передачи')}<ul class="list">${feeds.length ? linkList(feeds, 'from', 'Чаще всего пасуют ему') : ''}${gives.length ? linkList(gives, 'to', 'Он чаще всего пасует') : ''}</ul></section>`;
      }
    } else {
      html += `<section class="panel">${empty('', 'Матчей пока нет', 'Статистика появится после первого тура с этим игроком.')}</section>`;
    }

    if (ed && known) {
      html += `<section class="panel">${panelHead('Для организатора')}
        <form class="form-body" data-form="rename" data-name="${esc(name)}"><div class="field"><label for="rn">Имя</label>
          <div class="input"><input id="rn" name="to" value="${esc(name)}" maxlength="40" autocomplete="off"></div></div>
          <div class="btn-row"><button class="btn btn-white" type="submit">Переименовать</button>
          <button class="btn btn-glass" type="button" data-act="toggle-gk" data-name="${esc(name)}">${isGk(name) ? 'Не вратарь' : 'Вратарь'}</button></div>
          ${p ? '' : `<button class="btn btn-danger block" type="button" data-act="delete-player" data-name="${esc(name)}">${icon('trash')}Удалить игрока</button>`}
        </form></section>`;
    }
    return html;
  }

  /* ---------- Статистика ---------- */
  function vStats() {
    const st = stats();
    let html = head('Лидеры', '', mainRight());
    if (!st.list.length) return html + `<section class="panel">${empty('chart', 'Пока нечего считать', 'Статистика появится после первых матчей.')}</section>`;
    html += periodSegments();

    const block = (key, title, items, row, note) => {
      if (!items.length) return '';
      const open = S.expanded[key];
      const shown = open ? items : items.slice(0, 5);
      return `<section class="panel">${panelHead(title)}<ul class="list">${shown.map(row).join('')}</ul>
        ${items.length > 5 ? `<button class="more" data-act="expand" data-key="${key}">${open ? 'Свернуть' : `Показать всех · ${items.length}`}${icon('chev')}</button>` : ''}
        ${note ? `<p class="caption" style="padding-top:${items.length > 5 ? 0 : 6}px">${note}</p>` : ''}</section>`;
    };
    const prow = (val, label, sub) => (p, i) => `<li><a class="item" href="${playerHref(p.name)}"><span class="rank">${i + 1}</span>${avatar(p.name)}
      <span class="main"><span class="nm">${esc(p.name)}${gkTag(p.name)}</span><span class="sub">${sub(p)}</span></span>
      <span class="val"><b>${val(p)}</b>${label(p) ? `<span>${label(p)}</span>` : ''}</span></a></li>`;
    const sortBy = (f, filter) => [...st.list].filter(filter || ((p) => f(p) > 0)).sort((a, b) => f(b) - f(a) || a.games - b.games);

    html += block('goals', 'Бомбардиры', sortBy((p) => p.goals), prow((p) => p.goals, () => '', (p) => `${fix1(p.goalsPg)} за матч`));
    html += block('assists', 'Ассистенты', sortBy((p) => p.assists), prow((p) => p.assists, () => '', (p) => `${fix1(p.assistsPg)} за матч`));
    html += block('cs', 'Сухие матчи', sortBy((p) => p.cs), prow((p) => p.cs, () => '', (p) => `${Math.round(p.csPct)}% матчей`));
    html += block('ppg', 'Очки за матч', sortBy((p) => p.ppg, (p) => !p.smallSample), prow((p) => fix1(p.ppg), () => '', (p) => `${p.w}-${p.d}-${p.l}`),
      `От ${nWord(st.minGames, 'матча', 'матчей', 'матчей')}`);

    const minPair = Math.max(3, Math.round(st.minGames / 2));
    const pairs = st.pairs.filter((x) => x.games >= minPair).sort((a, b) => b.ppg - a.ppg || b.games - a.games);
    html += block('pairs', 'Лучшие связки', pairs, (x, i) => `<li><div class="item"><span class="rank">${i + 1}</span>
      <span style="display:flex">${avatar(x.a, 's')}<span style="margin-left:-6px">${avatar(x.b, 's')}</span></span>
      <span class="main"><span class="nm">${esc(x.a)} и ${esc(x.b)}</span><span class="sub">${nWord(x.games, 'матч', 'матча', 'матчей')} · ${x.w}-${x.d}-${x.l}</span></span>
      <span class="val"><b>${fix1(x.ppg)}</b><span>очк/матч</span></span></div></li>`, `Очки за матч вместе, от ${nWord(minPair, 'матча', 'матчей', 'матчей')}`);
    html += block('links', 'Пас — гол', st.links, (l, i) => `<li><div class="item"><span class="rank">${i + 1}</span>
      <span class="main"><span class="nm">${esc(l.from)} <span class="dim">→</span> ${esc(l.to)}</span></span>
      <span class="val"><b>${l.count}</b></span></div></li>`);
    return html;
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
    let html = backRow(tourId ? '#/tour/' + enc(tourId) : '#/tours') + head(tourId ? 'Составы' : 'Новый тур', tourId ? fmtDate(D.date) : 'Отметьте, кто пришёл, и сайт поделит игроков на равные команды');

    html += `<section class="panel"><div class="form-body" style="padding-top:14px">
      <div class="field"><label for="tdate">Дата</label><div class="input">${icon('cal')}<input type="date" id="tdate" data-input="draft-date" value="${esc(D.date)}"></div></div>
      <div class="field"><span class="label">Команд</span><div class="segments" style="padding:0;background:var(--fill);border-radius:99px;padding:3px">${[2, 3, 4].map((k) => `<button class="seg" data-act="draft-k" data-v="${k}" aria-pressed="${D.k === k}">${k}</button>`).join('')}</div></div>
      <div class="field"><span class="label">Кто играет · ${D.selected.length}</span>
        <div class="chips">${names.map((n) => `<button class="chip ${D.selected.includes(n) ? 'on' : ''}" data-act="draft-toggle" data-name="${esc(n)}">${esc(n)}${isGk(n) ? ' <span class="muted">ВР</span>' : ''}</button>`).join('')}</div>
        <form data-form="add-player" style="display:flex;gap:8px;margin-top:10px"><div class="input" style="flex:1"><input name="name" placeholder="Новый игрок" maxlength="40" autocomplete="off" aria-label="Имя нового игрока"></div><button class="btn btn-glass" type="submit" aria-label="Добавить">${icon('plus')}</button></form>
      </div>
      <button class="btn btn-white block" data-act="draft-balance" ${D.selected.length < D.k * 2 ? 'disabled' : ''}>${icon('shuffle')}${D.teams ? 'Подобрать заново' : 'Подобрать составы'}</button>
      ${D.selected.length < D.k * 2 ? `<p class="hint" style="margin-top:-8px;text-align:center">Нужно хотя бы ${D.k * 2} игроков.</p>` : ''}
    </div></section>`;

    if (D.teams) {
      html += `<section class="panel">${panelHead('Составы', '<span class="muted" style="font-size:13px;font-weight:500">нажмите на игрока, чтобы перевести</span>')}
        ${Object.entries(D.teams).map(([k, list]) => {
          const avg = list.length ? Math.round(list.reduce((s, n) => s + ratingFor(n), 0) / list.length) : 0;
          return `<div class="roster"><h3>${kit(k)}${esc(tn(k))}<span class="muted">${nWord(list.length, 'игрок', 'игрока', 'игроков')} · рейтинг ${avg}</span></h3>
            <div class="chips">${list.map((n) => `<button class="chip" data-act="draft-move" data-name="${esc(n)}">${esc(n)}${isGk(n) ? ' <span class="muted">ВР</span>' : ''} <span class="muted">${Math.round(ratingFor(n))}</span></button>`).join('') || '<span class="muted">пусто</span>'}</div></div>`;
        }).join('')}
        <div class="panel-body" style="padding-top:8px"><button class="btn btn-white block" data-act="draft-save">${icon('check')}${tourId ? 'Сохранить составы' : 'Создать тур'}</button></div></section>`;
    }
    return html;
  }

  /* ---------- Настройки ---------- */
  function vSettings() {
    let html = backRow('#/');
    if (!isEditor()) {
      html += head('Вход', 'Для организатора: туры, матчи и правка статистики. Остальным вход не нужен.');
      html += `<section class="panel">${S.editable
        ? `<form class="form-body" data-form="login" style="padding-top:16px"><div class="field"><label for="pw">Пароль</label><div class="input">${icon('lock')}<input id="pw" name="password" type="password" autocomplete="current-password" required></div></div>
          <button class="btn btn-white block" type="submit">Войти</button></form>`
        : '<p class="caption" style="padding:16px">Редактирование выключено: на сервере не задан пароль (переменная ADMIN_PASSWORD).</p>'}</section>`;
      return html;
    }
    const D = S.data;
    html += head('Настройки');
    html += `<section class="panel">${panelHead('Лига')}<form class="form-body" data-form="league">
      <div class="field"><label for="ln">Название</label><div class="input"><input id="ln" name="name" value="${esc(D.name)}" maxlength="40" required></div></div>
      <div class="field"><label for="ls">Сезон</label><div class="input"><input id="ls" name="season" value="${esc(D.season || '')}" maxlength="40" placeholder="Например, Осень 2026"></div></div>
      <div class="field"><span class="label">Команды</span>${LG.TEAM_KEYS.map((k) => `<div class="input">${kit(k)}<input name="team-${k}" value="${esc(tn(k))}" maxlength="24" aria-label="Команда ${k}"></div>`).join('')}</div>
      <button class="btn btn-white block" type="submit">Сохранить</button></form></section>
      <section class="panel">${panelHead('Вратари')}<p class="caption" style="text-align:left;padding:0 16px 10px">При подборе составов вратари попадают в разные команды.</p>
      <div class="panel-body"><div class="chips">${D.players.map((p) => `<button class="chip ${p.gk ? 'on' : ''}" data-act="toggle-gk" data-name="${esc(p.name)}">${esc(p.name)}</button>`).join('') || '<span class="muted">Игроков пока нет</span>'}</div></div></section>
      <section class="panel">${panelHead('Данные')}<div class="panel-body"><div class="btn-row">
        <button class="btn btn-glass" data-act="export">${icon('download')}Скачать копию</button>
        <label class="btn btn-glass">${icon('upload')}Загрузить<input type="file" accept="application/json,.json" data-input="import" hidden></label></div>
        ${D.tours.length ? '' : `<button class="btn btn-white block" style="margin-top:8px" data-act="demo">Заполнить демо-данными</button><p class="hint" style="margin-top:8px">Добавит 16 игроков и 8 туров, чтобы посмотреть, как выглядит сайт.</p>`}
      </div></section>
      <button class="btn btn-glass block" style="margin-top:12px" data-act="logout">Выйти</button>`;
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
    setTint();
    for (const [re, fn, t] of routes) {
      const m = path.match(re);
      if (m) { html = fn(...m.slice(1).map(decodeURIComponent)); tab = t; break; }
    }
    if (html === null) { html = vTable(); tab = 'table'; }
    const y = window.scrollY;
    view.innerHTML = html;
    const app = $('#app');
    app.style.setProperty('--tint', tint[0]);
    app.style.setProperty('--tint-2', tint[1]);
    if (path !== lastPath) { view.classList.remove('view-enter'); void view.offsetWidth; view.classList.add('view-enter'); }
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
