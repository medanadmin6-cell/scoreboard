(() => {
  'use strict';

  const SITE = window.SITE;
  let SITE_API = 'https://site.api.espn.com/apis/site/v2/sports';
  let V2_API = 'https://site.api.espn.com/apis/v2/sports';
  const SPORT_KEYS = Object.keys(SITE.sports);
  let FOOTBALL_SRC = 'espn';

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- data ----------
  const cache = new Map();
  async function getJSON(url, ttl = 20000) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const v = await r.json();
      cache.set(url, { t: Date.now(), v });
      return v;
    } catch (e) {
      if (hit) return hit.v;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const fromYmd = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayStr = () => ymd(new Date());
  const ET_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const espnDay = (t) => ET_FMT.format(t).replace(/\D/g, '');
  const timeStr = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const shortDate = (d) => d.toLocaleDateString([], { day: 'numeric', month: 'short' });

  function sportOf(key) { return SITE.sports[key] || SITE.sports[SPORT_KEYS[0]]; }
  function leagueCfg(sportKey, slug) {
    return sportOf(sportKey).leagues.find((l) => l.slug === slug) || { slug, name: slug, country: '' };
  }

  function teamOf(c) {
    const t = c.team || {};
    const score = typeof c.score === 'object' ? c.score?.displayValue : c.score;
    return {
      id: String(t.id ?? ''),
      name: t.displayName || t.name || 'TBD',
      short: t.shortDisplayName || t.displayName || 'TBD',
      logo: t.logo || t.logos?.[0]?.href || '',
      score: score ?? '',
      winner: !!c.winner,
      pens: c.shootoutScore,
      linescores: c.linescores || [],
    };
  }

  function normalize(ev, sportKey, league, comp = ev.competitions?.[0]) {
    const cs = comp?.competitors || [];
    const home = cs.find((x) => x.homeAway === 'home') || cs[0] || {};
    const away = cs.find((x) => x.homeAway === 'away') || cs[1] || {};
    const status = comp?.status || ev.status || {};
    const m = {
      id: String(ev.id),
      sport: sportKey,
      league,
      date: new Date(ev.date || comp?.date),
      state: status.type?.state || 'pre',
      statusName: status.type?.name || '',
      clock: status.displayClock || '',
      short: status.type?.shortDetail || '',
      detail: status.type?.detail || '',
      home: teamOf(home),
      away: teamOf(away),
      details: comp?.details || [],
    };
    for (const side of ['home', 'away']) {
      m[side].reds = m.details.filter((d) => d.redCard && String(d.team?.id) === m[side].id).length;
    }
    return m;
  }

  function statusLabel(m) {
    if (m.customLabel && m.state === 'in') return m.customLabel;
    if (m.afs) return afLabel(m);
    const n = m.statusName;
    if (/POSTPONED/.test(n)) return 'Postp.';
    if (/CANCEL/.test(n)) return 'Canc.';
    if (/ABANDON/.test(n)) return 'Aband.';
    if (/SUSPENDED/.test(n)) return 'Susp.';
    if (/DELAYED/.test(n)) return 'Delayed';
    if (m.state === 'pre') return timeStr(m.date);
    if (m.state === 'in') {
      if (m.sport !== 'football') return m.short || 'Live';
      if (/HALFTIME/.test(n)) return 'HT';
      return m.clock || m.short || 'Live';
    }
    if (m.sport === 'football') return m.short || 'FT';
    return (m.short || 'FT').replace(/^Final/, 'FT');
  }

  const isLive = (m) => m.state === 'in';
  const hasScore = (m) => m.state !== 'pre' && m.home.score !== '' && !/POSTPONED|CANCEL/.test(m.statusName);

  async function leagueDay(sportKey, slug, day) {
    const sp = sportOf(sportKey);
    // ESPN days are US Eastern and it rejects date ranges, so fetch each Eastern day that
    // overlaps the visitor's local day and merge.
    const start = fromYmd(day);
    const end = new Date(addDays(start, 1).getTime() - 1);
    const dates = [...new Set([espnDay(start), espnDay(end)])];
    const pages = await Promise.all(dates.map((ds) => getJSON(`${SITE_API}/${sp.espn}/${slug}/scoreboard?dates=${ds}&limit=300`)));
    const seen = new Set();
    const data = {
      leagues: pages[0]?.leagues,
      events: pages.flatMap((p) => p.events || []).filter((e) => !seen.has(e.id) && seen.add(e.id)),
    };
    const cfg = leagueCfg(sportKey, slug);
    const league = {
      slug,
      name: cfg.name || data.leagues?.[0]?.name || slug,
      country: cfg.country,
      logo: data.leagues?.[0]?.logos?.[0]?.href || '',
    };
    return (data.events || [])
      .map((e) => normalize(e, sportKey, league))
      .filter((m) => ymd(m.date) === day);
  }

  async function sportDay(sportKey, day) {
    const sp = sportOf(sportKey);
    const results = await Promise.allSettled(sp.leagues.map((l) => leagueDay(sportKey, l.slug, day)));
    const groups = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.length) {
        groups.push({ league: r.value[0].league, order: i, matches: r.value.sort((a, b) => a.date - b.date) });
      }
    });
    const failed = results.filter((r) => r.status === 'rejected').length;
    return { groups, failed, total: results.length };
  }

  // ---------- favourites ----------
  const FAV_KEY = 'sn_favs_v1';
  function loadFavs() { try { return JSON.parse(localStorage.getItem(FAV_KEY)) || {}; } catch { return {}; } }
  function saveFavs(f) { try { localStorage.setItem(FAV_KEY, JSON.stringify(f)); } catch { /* storage blocked */ } }
  let favs = loadFavs();
  const favId = (m) => `${m.sport}|${m.league.slug}|${m.id}`;

  // ---------- routing ----------
  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    const q = Object.fromEntries(new URLSearchParams(qs || ''));
    if (parts[0] === 'm') return { view: 'match', sport: parts[1], league: parts[2], id: parts[3], tab: q.tab || 'summary' };
    if (parts[0] === 'l') return { view: 'league', sport: parts[1], league: parts[2], tab: q.tab || 'matches', d: q.d || todayStr() };
    if (parts[0] === 'fav') return { view: 'fav', sport: q.s || SPORT_KEYS[0] };
    const sport = SITE.sports[parts[0]] ? parts[0] : SPORT_KEYS[0];
    return { view: 'list', sport, d: q.d || todayStr(), live: q.live === '1' };
  }

  let route = parseRoute();
  let renderToken = 0;
  let searchTerm = '';

  // ---------- shared UI ----------
  const STAR = '<svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/></svg>';
  const img = (src, alt = '') => src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" onerror="this.style.visibility='hidden'">` : '<img alt="" style="visibility:hidden">';

  function renderSports() {
    const active = route.sport;
    $('#sports').innerHTML = SPORT_KEYS.map((k) =>
      `<a href="#/${k}" class="${k === active && route.view !== 'fav' ? 'on' : ''}">${esc(SITE.sports[k].label)}</a>`
    ).join('') + `<a href="#/fav?s=${esc(active)}" class="${route.view === 'fav' ? 'on' : ''}">Favourites</a>`;
  }

  function renderSideLeft() {
    const sp = sportOf(route.sport);
    $('#sideLeft').innerHTML = `
      <div class="panel">
        <div class="panel-h">${esc(sp.label)} competitions</div>
        <div class="comp-list">
          ${sp.leagues.map((l) => {
            const id = route.sport === 'football' && FOOTBALL_SRC === 'af' && l.af ? String(l.af) : l.slug;
            return `
            <a href="#/l/${esc(route.sport)}/${esc(id)}" class="${route.view === 'league' && route.league === id ? 'on' : ''}">
              <b>${esc(l.name)}</b><small>${esc(l.country)}</small>
            </a>`;
          }).join('')}
        </div>
      </div>`;
  }

  function featuredHTML(m) {
    if (!m) return '';
    const live = isLive(m);
    return `
      <div class="panel">
        <div class="panel-h">Featured match</div>
        <a class="feat ${live ? 'live' : ''}" href="${matchHref(m)}">
          <div class="fl">${esc(m.league.name)}</div>
          <div class="fx">
            <div>${img(m.home.logo)}<div class="fn">${esc(m.home.short)}</div></div>
            <div><div class="fs">${hasScore(m) ? `${esc(m.home.score)} - ${esc(m.away.score)}` : esc(timeStr(m.date))}</div>
              <div class="fst">${live ? esc(statusLabel(m)) : m.state === 'pre' ? esc(shortDate(m.date)) : esc(statusLabel(m))}</div></div>
            <div>${img(m.away.logo)}<div class="fn">${esc(m.away.short)}</div></div>
          </div>
        </a>
      </div>`;
  }

  function renderSideRight(groups) {
    const all = (groups || []).flatMap((g) => g.matches);
    const major = all.filter((m) => !(m.league.pin < 0));
    const pick = major.find(isLive) || major.find((m) => m.state === 'pre') || major[0] || all.find(isLive) || all[0];
    $('#sideRight').innerHTML = `
      ${featuredHTML(pick)}
      <div class="panel" id="miniTable"></div>
      <div class="panel promo">
        <b>${esc(SITE.name)}</b>
        Every goal, every result, in real time. Tap the star on any match to follow it in Favourites.
      </div>`;
    const sp = sportOf(route.sport);
    const top = sp.leagues[0];
    if (route.sport === 'football') loadMiniTable(route.sport, top.slug, top.name);
    else $('#miniTable').remove();
  }

  async function loadMiniTable(sportKey, slug, name) {
    const el = $('#miniTable');
    try {
      const top = sportOf(sportKey).leagues[0];
      let groups;
      if (FOOTBALL_SRC === 'af' && top.af) {
        const info = await afLeagueInfo(top.af);
        groups = await afStandings(top.af, info.season);
      } else {
        groups = await standings(sportKey, slug);
      }
      const rows = groups[0]?.entries.slice(0, 8) || [];
      if (!rows.length || !document.body.contains(el)) return el?.remove();
      el.innerHTML = `<div class="panel-h">${esc(name)} table</div>
        <table class="mini-table">${rows.map((r, i) => `
          <tr><td>${esc(r.rank || i + 1)}</td><td>${esc(r.team.shortDisplayName || r.team.displayName)}</td><td>${esc(r.s.points ?? '')}</td></tr>`).join('')}
        </table>`;
    } catch { el?.remove(); }
  }

  const matchHref = (m) => `#/m/${m.sport}/${m.league.slug}/${m.id}`;

  function rowHTML(m) {
    const live = isLive(m);
    const scored = hasScore(m);
    const post = m.state === 'post';
    const cls = (side) => {
      if (!post || !scored) return '';
      const other = side === 'home' ? 'away' : 'home';
      if (m[side].winner) return 'win';
      if (m[other].winner) return 'lose';
      return '';
    };
    const reds = (t) => t.reds ? '<i class="rc"></i>'.repeat(Math.min(t.reds, 3)) : '';
    const pens = m.home.pens != null && m.away.pens != null;
    return `
      <a class="row ${live ? 'live' : ''}" href="${matchHref(m)}">
        <div class="st">${esc(statusLabel(m))}</div>
        <div class="tm">
          <div class="t ${cls('home')}">${img(m.home.logo)}<span>${esc(m.home.name)}</span>${reds(m.home)}</div>
          <div class="t ${cls('away')}">${img(m.away.logo)}<span>${esc(m.away.name)}</span>${reds(m.away)}</div>
        </div>
        <div class="sc">
          ${scored ? `<span>${esc(m.home.score)}${pens ? ` <small>(${esc(m.home.pens)})</small>` : ''}</span><span>${esc(m.away.score)}${pens ? ` <small>(${esc(m.away.pens)})</small>` : ''}</span>` : ''}
        </div>
        <button class="fav ${favs[favId(m)] ? 'on' : ''}" data-fav="${esc(favId(m))}" data-date="${m.date.toISOString()}" aria-label="Favourite">${STAR}</button>
      </a>`;
  }

  const openGroups = new Set();
  const groupIndex = new Map();
  const gidOf = (g) => String(g.league.id ?? g.league.slug);

  function groupHTML(g, opts = {}) {
    const { more = true, collapsible = false, open = true } = opts;
    const gid = gidOf(g);
    const hasTable = g.league.standings !== false;
    const head = `${img(g.league.logo)}<div class="ln"><b>${esc(g.league.name)}</b><small>${esc(g.league.country)}</small></div>`;
    const moreLink = more && g.league.slug !== 'custom' ? `<a class="more" href="#/l/${esc(g.matches[0].sport)}/${esc(gid)}${hasTable ? '?tab=table' : ''}">${hasTable ? 'Table' : 'Fixtures'} &rsaquo;</a>` : '';
    if (!collapsible) {
      return `<section class="league"><div class="league-h">${head}${moreLink}</div>${g.matches.map(rowHTML).join('')}</section>`;
    }
    groupIndex.set(gid, g);
    const liveN = g.matches.filter(isLive).length;
    return `
      <details class="league" data-gid="${esc(gid)}" ${open ? 'open' : ''}>
        <summary class="league-h">${head}${liveN ? `<span class="lc">${liveN} live</span>` : ''}<span class="cnt">${g.matches.length}</span><span class="chev"></span></summary>
        <div class="gbody">${open ? g.matches.map(rowHTML).join('') + (moreLink ? `<div class="league-more">${moreLink}</div>` : '') : ''}</div>
      </details>`;
  }

  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.gid) return;
    const gid = d.dataset.gid;
    if (d.open) {
      openGroups.add(gid);
      const g = groupIndex.get(gid);
      const body = d.querySelector('.gbody');
      if (g && body && !body.children.length) {
        body.innerHTML = g.matches.map(rowHTML).join('') +
          `<div class="league-more"><a class="more" href="#/l/${esc(g.matches[0].sport)}/${esc(gid)}${g.league.standings !== false ? '?tab=table' : ''}">${g.league.standings !== false ? 'Table' : 'Fixtures'} &rsaquo;</a></div>`;
      }
    } else {
      openGroups.delete(gid);
    }
  }, true);

  function skeleton(n = 2) {
    return Array.from({ length: n }, () => `
      <section class="league"><div class="league-h"><div class="ln"><b>&nbsp;</b><small>&nbsp;</small></div></div>
      <div class="skel"></div><div class="skel"></div><div class="skel"></div></section>`).join('');
  }

  function dateBarHTML(base, day, live, liveCount) {
    const t = todayStr();
    const center = fromYmd(day);
    const days = [];
    for (let i = -3; i <= 3; i++) days.push(addDays(center, i));
    const label = (d) => {
      const s = ymd(d);
      if (s === t) return 'Today';
      if (s === ymd(addDays(new Date(), -1))) return 'Yesterday';
      if (s === ymd(addDays(new Date(), 1))) return 'Tomorrow';
      return d.toLocaleDateString([], { weekday: 'short' });
    };
    const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
    return `
      <div class="datebar">
        <a class="livepill ${live ? 'on' : ''}" href="${base}?live=${live ? '0' : '1'}"><i></i>LIVE${liveCount ? ` <em>${liveCount}</em>` : ''}</a>
        <div class="days">${days.map((d) => `
          <a class="day ${!live && ymd(d) === day ? 'on' : ''}" href="${base}?d=${ymd(d)}"><b>${label(d)}</b><span>${shortDate(d)}</span></a>`).join('')}
        </div>
        <label class="cal" title="Pick a date">
          <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
          <input type="date" value="${iso}" data-base="${base}">
        </label>
      </div>`;
  }

  function applySearch(groups) {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return groups;
    return groups.map((g) => {
      if (g.league.name.toLowerCase().includes(q) || g.league.country.toLowerCase().includes(q)) return g;
      const matches = g.matches.filter((m) => (m.home.name + ' ' + m.away.name).toLowerCase().includes(q));
      return matches.length ? { ...g, matches } : null;
    }).filter(Boolean);
  }

  // ---------- views ----------
  let lastGroups = null;
  let lastExt = null;

  async function viewList(token, silent) {
    const main = $('#main');
    const { sport, live } = route;
    const day = live ? todayStr() : route.d;
    const base = `#/${sport}`;
    if (!silent) {
      main.innerHTML = dateBarHTML(base, day, live, 0) + skeleton(3);
      renderSideRight([]);
    }
    const customP = customDay(sport, day).catch(() => []);
    const extKey = `${sport}|${day}`;
    const extP = (async () => {
      let r = null;
      if (sport === 'football' && FOOTBALL_SRC === 'af') r = await afDay(day).catch(() => null);
      return r || await sportDay(sport, day);
    })().catch(() => null);
    // On background refreshes, don't let a slow external feed hold back admin-entered matches.
    const previous = () => (lastExt?.key === extKey ? lastExt.res : null);
    let ext = silent
      ? await Promise.race([extP, new Promise((r) => setTimeout(() => r(previous()), 3000))])
      : await extP;
    if (ext && lastExt?.res !== ext) lastExt = { key: extKey, res: ext };
    if (!ext && lastExt?.key === extKey) ext = lastExt.res;
    const customGroups = await customP;
    let res = null;
    if (ext) res = { ...ext, groups: [...customGroups, ...ext.groups] };
    else if (customGroups.length) res = { groups: customGroups, failed: 0, total: 1 };
    if (!res) {
      if (token !== renderToken) return;
      main.innerHTML = dateBarHTML(base, day, live, 0) + `<div class="empty"><b>Could not load scores</b>Check your connection. We will retry automatically.</div>`;
      return;
    }
    if (token !== renderToken) return;
    lastGroups = res.groups;
    const liveCount = res.groups.reduce((n, g) => n + g.matches.filter(isLive).length, 0);
    let groups = res.src === 'af' ? res.groups.slice() : res.groups.slice().sort((a, b) => {
      const la = a.matches.some(isLive) ? 0 : 1, lb = b.matches.some(isLive) ? 0 : 1;
      return la - lb || a.order - b.order;
    });
    if (live) groups = groups.map((g) => ({ ...g, matches: g.matches.filter(isLive) })).filter((g) => g.matches.length);
    groups = applySearch(groups);

    let body;
    if (groups.length && res.src === 'af') {
      const pinned = groups.filter((g) => g.league.pin >= 0);
      const rest = groups.filter((g) => g.league.pin < 0);
      const forceOpen = live || !!searchTerm.trim();
      groupIndex.clear();
      body = pinned.map((g) => groupHTML(g)).join('') +
        (rest.length ? `<div class="sec-h">All competitions <span>${rest.length}</span></div>` +
          rest.map((g) => groupHTML(g, { collapsible: true, open: forceOpen || openGroups.has(gidOf(g)) })).join('') : '');
    } else if (groups.length) body = groups.map((g) => groupHTML(g)).join('');
    else if (res.failed === res.total) body = `<div class="empty"><b>Could not load scores</b>The data feed is not responding. Retrying shortly.</div>`;
    else if (searchTerm) body = `<div class="empty"><b>No matches found</b>Nothing matches "${esc(searchTerm)}" on this day.</div>`;
    else if (live) body = `<div class="empty"><b>No live matches right now</b>Check today's fixtures for upcoming kick-offs.</div>`;
    else body = `<div class="empty"><b>No matches on this day</b>Try another date from the bar above.</div>`;

    main.innerHTML = dateBarHTML(base, day, live, liveCount) + body;
    const strip = $('.datebar .days'), on = $('.datebar .day.on');
    if (strip && on) strip.scrollLeft = on.offsetLeft - strip.offsetLeft - (strip.clientWidth - on.clientWidth) / 2;
    if (!silent) renderSideRight(res.groups);
    document.title = `${liveCount ? `(${liveCount}) ` : ''}${sportOf(sport).label} Live Scores | ${SITE.name}`;
  }

  async function viewFav(token) {
    const main = $('#main');
    const ids = Object.keys(favs);
    if (!ids.length) {
      main.innerHTML = `<div class="empty"><b>No favourites yet</b>Tap the star next to any match to follow it here.</div>`;
      renderSideRight([]);
      return;
    }
    main.innerHTML = skeleton(1);
    const results = await Promise.allSettled(ids.slice(0, 40).map(async (fid) => {
      const [sportKey, slug, id] = fid.split('|');
      if (slug === 'af') return (await afFixture(id)).match;
      if (slug === 'custom') return (await customFixture(id)).match;
      const s = await summary(sportKey, slug, id);
      return s.match;
    }));
    if (token !== renderToken) return;
    const bySlug = new Map();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const m = r.value;
      const k = m.sport + gidOf(m);
      if (!bySlug.has(k)) bySlug.set(k, { league: m.league, matches: [] });
      bySlug.get(k).matches.push(m);
    }
    const groups = [...bySlug.values()].map((g) => ({ ...g, matches: g.matches.sort((a, b) => a.date - b.date) }));
    main.innerHTML = `<div class="panel-h" style="padding-left:4px">Your favourite matches</div>` +
      (groups.length ? applySearch(groups).map((g) => groupHTML(g)).join('') : `<div class="empty"><b>Could not load favourites</b>Retrying shortly.</div>`);
    renderSideRight(groups);
    document.title = `Favourites | ${SITE.name}`;
  }

  async function summary(sportKey, slug, id) {
    const sp = sportOf(sportKey);
    const s = await getJSON(`${SITE_API}/${sp.espn}/${slug}/summary?event=${id}`, 15000);
    const comp = s.header?.competitions?.[0];
    const cfg = leagueCfg(sportKey, slug);
    const league = {
      slug,
      name: cfg.name || s.header?.league?.name || slug,
      country: cfg.country,
      logo: s.header?.league?.logos?.[0]?.href || '',
    };
    const match = normalize({ id, date: comp?.date }, sportKey, league, comp);
    return { s, match };
  }

  function scorersHTML(m, s) {
    const evs = (s.keyEvents || []).filter((e) => e.scoringPlay);
    if (!evs.length) return '';
    const side = (tid) => evs.filter((e) => String(e.team?.id) === tid).map((e) => {
      const who = e.participants?.[0]?.athlete?.displayName || e.shortText || 'Goal';
      const og = /own goal/i.test(e.type?.text || e.text || '') ? ' (OG)' : /penalty/i.test(e.type?.text || '') ? ' (P)' : '';
      return `${esc(who)}${og} ${esc(e.clock?.displayValue || '')}`;
    }).join('<br>');
    return `<div class="scorers"><div>${side(m.home.id)}</div><div>${side(m.away.id)}</div></div>`;
  }

  async function viewMatch(token, silent) {
    const main = $('#main');
    if (!silent) main.innerHTML = skeleton(1);
    let data;
    try {
      data = await summary(route.sport, route.league, route.id);
    } catch {
      if (token !== renderToken) return;
      main.innerHTML = `<a class="back" href="#/${esc(route.sport)}">&lsaquo; Back</a><div class="empty"><b>Match not available</b>We could not load this match. Try again shortly.</div>`;
      return;
    }
    if (token !== renderToken) return;
    const { s, match: m } = data;
    const live = isLive(m);
    const isFootball = m.sport === 'football';
    const tabs = [['summary', 'Summary']];
    if (s.boxscore?.teams?.some((t) => t.statistics?.length)) tabs.push(['stats', 'Stats']);
    if (s.rosters?.some((r) => r.roster?.length)) tabs.push(['lineups', 'Line-ups']);
    if (s.standings?.groups?.length) tabs.push(['table', 'Table']);
    if (s.seasonseries?.some((x) => x.events?.length) || s.lastFiveGames?.some((x) => x.events?.length)) tabs.push(['h2h', 'H2H']);
    const tab = tabs.some((t) => t[0] === route.tab) ? route.tab : 'summary';

    let body = '';
    if (tab === 'summary') body = summaryTab(m, s, isFootball);
    if (tab === 'stats') body = statsTab(s, m);
    if (tab === 'lineups') body = lineupsTab(s, m);
    if (tab === 'table') body = standingsCard(normStandingGroups(s.standings.groups), m.sport, [m.home.id, m.away.id]);
    if (tab === 'h2h') body = h2hTab(s, m);

    const stt = m.state === 'pre' ? shortDate(m.date) : live ? statusLabel(m) : (m.detail || statusLabel(m));
    main.innerHTML = matchHeaderHTML(m, tabs, tab, isFootball ? scorersHTML(m, s) : '', stt) + body;
    document.title = `${m.home.short} ${hasScore(m) ? m.home.score + '-' + m.away.score : 'vs'} ${m.away.short} | ${SITE.name}`;
    if (!silent) renderSideRight(lastGroups);
  }

  function matchHeaderHTML(m, tabs, tab, extra, stt) {
    const live = isLive(m);
    const kick = m.date.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const href = (t) => `#/m/${m.sport}/${m.league.slug}/${m.id}?tab=${t}`;
    return `
      <a class="back" href="#/${esc(m.sport)}">&lsaquo; ${esc(sportOf(m.sport).label)}</a>
      <section class="mh ${live ? 'live' : ''}">
        <div class="comp">${m.league.slug === 'custom'
          ? esc((m.league.country ? m.league.country + ' · ' : '') + m.league.name)
          : `<a href="#/l/${esc(m.sport)}/${esc(gidOf(m))}">${esc(m.league.country ? m.league.country + ' · ' : '')}${esc(m.league.name)}</a>`} &middot; ${esc(kick)}</div>
        <div class="vs">
          <div>${img(m.home.logo)}<div class="nm">${esc(m.home.name)}</div></div>
          <div>
            <div class="score">${hasScore(m) ? `${esc(m.home.score)} - ${esc(m.away.score)}` : esc(timeStr(m.date))}</div>
            ${m.home.pens != null && m.away.pens != null ? `<div class="stt">Pens ${esc(m.home.pens)} - ${esc(m.away.pens)}</div>` : ''}
            <div class="stt">${esc(stt)}</div>
          </div>
          <div>${img(m.away.logo)}<div class="nm">${esc(m.away.name)}</div></div>
        </div>
        ${extra}
        <nav class="tabs">${tabs.map(([k, l]) => `<a href="${href(k)}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
      </section>`;
  }

  function eventIcon(e) {
    const t = (e.type?.text || e.type?.type || '').toLowerCase();
    if (e.scoringPlay || t.includes('goal')) return 'goal';
    if (t.includes('red') || t.includes('second yellow')) return 'rc';
    if (t.includes('yellow')) return 'yc';
    if (t.includes('substitution')) return 'sub';
    return '';
  }

  function summaryTab(m, s, isFootball) {
    let out = '';
    if (isFootball) {
      const evs = (s.keyEvents || []).filter((e) => eventIcon(e) || /halftime|half time|end regular|full time/i.test(e.type?.text || ''));
      if (evs.length) {
        out += `<div class="card"><div class="card-h">Key events</div>` + evs.map((e) => {
          const type = e.type?.text || '';
          if (!eventIcon(e)) return `<div class="tl-sep">${/half/i.test(type) ? 'Half time' : 'Full time'}</div>`;
          const names = (e.participants || []).map((p) => p.athlete?.displayName).filter(Boolean);
          const ic = eventIcon(e);
          let main = names[0] || e.shortText || type;
          let sub = '';
          if (ic === 'sub') { main = names[0] ? `In: ${names[0]}` : (e.shortText || 'Substitution'); sub = names[1] ? `Out: ${names[1]}` : ''; }
          else if (ic === 'goal' && names[1]) sub = `Assist: ${names[1]}`;
          else if (ic === 'goal' && /penalty/i.test(type)) sub = 'Penalty';
          else if (ic === 'goal' && /own/i.test(type)) sub = 'Own goal';
          const ev = `<span class="tl-ev"><span class="ico ${ic}"></span><span>${esc(main)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></span>`;
          const isHome = String(e.team?.id) === m.home.id;
          return `<div class="tl-row"><div class="h">${isHome ? ev : ''}</div><div class="min">${esc(e.clock?.displayValue || '')}</div><div>${isHome ? '' : ev}</div></div>`;
        }).join('') + `</div>`;
      }
    } else {
      const hl = m.home.linescores, al = m.away.linescores;
      if (hl.length && al.length) {
        const n = Math.max(hl.length, al.length);
        const per = m.sport === 'hockey' || m.sport === 'baseball' ? (m.sport === 'baseball' ? '' : 'P') : 'Q';
        const head = Array.from({ length: n }, (_, i) => `<th>${per}${i + 1}</th>`).join('');
        const line = (t) => `<tr><td>${esc(t.short)}</td>${Array.from({ length: n }, (_, i) => `<td>${esc(t.linescores[i]?.displayValue ?? '-')}</td>`).join('')}<td>${esc(t.score)}</td></tr>`;
        out += `<div class="card"><div class="card-h">Scoring</div><div class="table-wrap"><table class="ls-table"><tr><th></th>${head}<th>T</th></tr>${line(m.home)}${line(m.away)}</table></div></div>`;
      }
      const leaders = s.leaders || [];
      if (leaders.length) {
        out += `<div class="card"><div class="card-h">Top performers</div><div class="info">` + leaders.flatMap((tl) =>
          (tl.leaders || []).slice(0, 3).map((cat) => {
            const l = cat.leaders?.[0];
            return l ? `<div><small>${esc(tl.team?.abbreviation || '')} &middot; ${esc(cat.displayName)}</small>${esc(l.athlete?.displayName)} <span class="muted">${esc(l.displayValue)}</span></div>` : '';
          })).join('') + `</div></div>`;
      }
    }
    const gi = s.gameInfo || {};
    const venue = gi.venue?.fullName;
    const city = gi.venue?.address?.city;
    const ref = gi.officials?.[0]?.displayName || gi.officials?.[0]?.fullName;
    const items = [
      ['Kick-off', m.date.toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false })],
      venue && ['Venue', venue + (city ? `, ${city}` : '')],
      gi.attendance && ['Attendance', Number(gi.attendance).toLocaleString()],
      ref && ['Referee', ref],
    ].filter(Boolean);
    out += `<div class="card"><div class="card-h">Match info</div><div class="info">${items.map(([k, v]) => `<div><small>${k}</small>${esc(v)}</div>`).join('')}</div></div>`;
    if (m.state === 'pre' && !isFootball) return out;
    if (m.state === 'pre' && isFootball && !(s.keyEvents || []).length) {
      out = `<div class="card"><div class="err">The match has not started yet. Events will appear here live.</div></div>` + out;
    }
    return out;
  }

  function statsTab(s, m) {
    const teams = s.boxscore.teams;
    const home = teams.find((t) => String(t.team?.id) === m.home.id) || teams[0];
    const away = teams.find((t) => t !== home) || teams[1];
    const amap = new Map((away?.statistics || []).map((x) => [x.name, x]));
    const rows = (home?.statistics || []).map((h) => {
      const a = amap.get(h.name);
      if (!a) return '';
      const hv = parseFloat(h.displayValue), av = parseFloat(a.displayValue);
      const label = h.label || h.abbreviation || h.name;
      let bars = '';
      if (!isNaN(hv) && !isNaN(av) && hv + av > 0) {
        const hp = (hv / (hv + av)) * 100, ap = 100 - hp;
        bars = `<div class="bars"><div><i class="${hv >= av ? 'lead' : ''}" style="width:${hp}%"></i></div><div><i class="${av >= hv ? 'lead' : ''}" style="width:${ap}%"></i></div></div>`;
      }
      return `<div class="stat"><div class="sl"><span>${esc(h.displayValue)}</span><span>${esc(label)}</span><span>${esc(a.displayValue)}</span></div>${bars}</div>`;
    }).join('');
    return `<div class="card"><div class="card-h">Match stats</div>${rows || '<div class="err">No stats yet.</div>'}</div>`;
  }

  function lineupsTab(s, m) {
    const rosters = s.rosters;
    const home = rosters.find((r) => r.homeAway === 'home') || rosters[0];
    const away = rosters.find((r) => r !== home) || rosters[1];
    const col = (r) => {
      if (!r) return '<div></div>';
      const list = r.roster || [];
      const pl = (p) => `
        <div class="pl"><span class="no">${esc(p.jersey ?? '')}</span>
          <span class="pn">${esc(p.athlete?.displayName || '')}
            ${p.subbedOut ? '<span class="sub-out">&#9660;</span>' : ''}${p.subbedIn && !p.starter ? '<span class="sub-in">&#9650;</span>' : ''}</span>
          <span class="pp">${esc(p.position?.abbreviation || '')}</span></div>`;
      const starters = list.filter((p) => p.starter);
      const subs = list.filter((p) => !p.starter);
      return `<div>
        <div class="lu-h"><span>${esc(r.team?.displayName || '')}</span><small>${esc(r.formation || '')}</small></div>
        ${starters.map(pl).join('')}
        ${subs.length ? `<div class="card-h">Substitutes</div>${subs.map(pl).join('')}` : ''}
      </div>`;
    };
    return `<div class="card"><div class="lineups">${col(home)}${col(away)}</div></div>`;
  }

  const fmtDay = (d) => d ? new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' }) : '';

  function h2hTab(s, m) {
    let out = '';
    const meetings = (s.seasonseries || []).flatMap((ss) => ss.events || [])
      .filter((e) => String(e.id) !== m.id)
      .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
    if (meetings.length) {
      out += `<div class="card"><div class="card-h">Head to head</div>` + meetings.map((e) => {
        const cs = e.competitors || [];
        const h = cs.find((c) => c.homeAway === 'home') || cs[0] || {};
        const a = cs.find((c) => c.homeAway === 'away') || cs[1] || {};
        const sc = (c) => typeof c.score === 'object' ? c.score?.displayValue : c.score;
        return `<div class="h2h-row"><span class="d">${esc(fmtDay(e.date))}</span><span class="r">${esc(h.team?.displayName || '')}</span><b>${esc(sc(h) ?? '')} - ${esc(sc(a) ?? '')}</b><span>${esc(a.team?.displayName || '')}</span></div>`;
      }).join('') + `</div>`;
    }
    for (const tf of s.lastFiveGames || []) {
      const evs = tf.events || [];
      if (!evs.length) continue;
      const me = tf.team?.displayName || '';
      out += `<div class="card"><div class="card-h">${esc(me)} &middot; last ${evs.length} matches</div>` + evs.map((e) => {
        const home = e.atVs === '@' ? (e.opponent?.displayName || '') : me;
        const away = e.atVs === '@' ? me : (e.opponent?.displayName || '');
        const res = e.gameResult || '';
        const col = res === 'W' ? 'var(--accent)' : res === 'L' ? 'var(--live)' : 'var(--muted)';
        return `<div class="h2h-row"><span class="d">${esc(fmtDay(e.gameDate))}</span><span class="r">${esc(home)}</span><b style="box-shadow:inset 0 -2px ${col}">${esc(e.homeTeamScore ?? '')} - ${esc(e.awayTeamScore ?? '')}</b><span>${esc(away)}</span></div>`;
      }).join('') + `</div>`;
    }
    return out || `<div class="card"><div class="err">No previous meetings found.</div></div>`;
  }

  // ---------- standings ----------
  function normEntries(entries) {
    return (entries || []).map((e) => {
      const s = {};
      for (const st of e.stats || []) s[st.name] = st.displayValue ?? st.value;
      return { team: e.team || {}, s, rank: s.rank, note: e.note };
    }).sort((a, b) => (+a.s.rank || 0) - (+b.s.rank || 0) || 0);
  }

  function normStandingGroups(groups) {
    return (groups || []).map((g) => ({ name: g.header || g.name || '', entries: normEntries(g.standings?.entries) }));
  }

  async function standings(sportKey, slug) {
    const sp = sportOf(sportKey);
    const data = await getJSON(`${V2_API}/${sp.espn}/${slug}/standings`, 120000);
    const out = [];
    const walk = (node) => {
      if (node.standings?.entries?.length) out.push({ name: node.name || node.abbreviation || '', entries: normEntries(node.standings.entries) });
      (node.children || []).forEach(walk);
    };
    walk(data);
    return out;
  }

  function standingsCard(groups, sportKey, highlight = []) {
    if (!groups.length) return `<div class="card"><div class="err">No table available for this competition.</div></div>`;
    const football = sportKey === 'football';
    const cols = football
      ? [['P', 'gamesPlayed'], ['W', 'wins'], ['D', 'ties'], ['L', 'losses'], ['GD', 'pointDifferential'], ['Pts', 'points'], ['Form', 'form']]
      : [['W', 'wins'], ['L', 'losses'], ['PCT', 'winPercent'], ['GB', 'gamesBehind'], ['STRK', 'streak']];
    const notes = new Map();
    const tables = groups.map((g) => {
      const used = cols.filter(([, k]) => g.entries.some((e) => e.s[k] != null));
      return `<div class="card">${g.name && groups.length > 1 ? `<div class="card-h">${esc(g.name)}</div>` : ''}
        <div class="table-wrap"><table class="st">
          <tr><th>#</th><th class="tn">Team</th>${used.map(([l]) => `<th>${l}</th>`).join('')}</tr>
          ${g.entries.map((e, i) => {
            if (e.note?.color && e.note?.description) notes.set(e.note.description, e.note.color);
            const q = e.note?.color ? `--q:${esc(e.note.color.startsWith('#') ? e.note.color : '#' + e.note.color)}` : '';
            return `<tr class="${highlight.includes(String(e.team.id)) ? 'hl' : ''}">
              <td class="pos" style="${q}">${esc(e.rank || i + 1)}</td>
              <td class="tn"><span style="display:inline-flex;align-items:center;gap:8px">${img(e.team.logos?.[0]?.href)}${esc(e.team.shortDisplayName || e.team.displayName)}</span></td>
              ${used.map(([l, k]) => k === 'form'
                ? `<td class="form">${String(e.s.form || '').slice(-5).split('').map((c) => `<i class="f${esc(c)}">${esc(c)}</i>`).join('')}</td>`
                : `<td class="${l === 'Pts' ? 'pts' : ''}">${esc(e.s[k] ?? '-')}</td>`).join('')}
            </tr>`;
          }).join('')}
        </table></div></div>`;
    }).join('');
    const legend = notes.size ? `<div class="card"><div class="legend">${[...notes].map(([d, c]) => `<span><i style="background:${esc(c.startsWith('#') ? c : '#' + c)}"></i>${esc(d)}</span>`).join('')}</div></div>` : '';
    return tables + legend;
  }

  async function viewLeague(token, silent) {
    const main = $('#main');
    const { sport, league: slug, tab } = route;
    const cfg = leagueCfg(sport, slug);
    const base = `#/l/${sport}/${slug}`;
    const head = (logo) => `
      <a class="back" href="#/${esc(sport)}">&lsaquo; ${esc(sportOf(sport).label)}</a>
      <div class="lg-head">${logo ? img(logo) : ''}<div><h1>${esc(cfg.name)}</h1><div class="muted">${esc(cfg.country)}</div></div>
        <nav class="tabs">
          <a href="${base}?tab=matches&d=${route.d}" class="${tab === 'matches' ? 'on' : ''}">Matches</a>
          <a href="${base}?tab=table" class="${tab === 'table' ? 'on' : ''}">Table</a>
        </nav></div>`;
    if (!silent) main.innerHTML = head('') + skeleton(1);
    document.title = `${cfg.name} | ${SITE.name}`;
    try {
      if (tab === 'table') {
        const groups = await standings(sport, slug);
        if (token !== renderToken) return;
        main.innerHTML = head('') + standingsCard(groups, sport);
      } else {
        const matches = await leagueDay(sport, slug, route.d);
        if (token !== renderToken) return;
        const bar = dateBarHTML(`${base}`, route.d, false, 0).replace(/\?d=/g, '?tab=matches&d=').replace(/<a class="livepill[\s\S]*?<\/a>/, '');
        const logo = matches[0]?.league.logo;
        main.innerHTML = head(logo) + bar + (matches.length
          ? groupHTML({ league: matches[0].league, matches: matches.sort((a, b) => a.date - b.date) }, false)
          : `<div class="empty"><b>No ${esc(cfg.name)} matches on this day</b>Pick another date above.</div>`);
      }
    } catch {
      if (token !== renderToken) return;
      main.innerHTML = head('') + `<div class="empty"><b>Could not load this competition</b>Retrying shortly.</div>`;
    }
    if (!silent) renderSideRight(lastGroups);
  }

  // ---------- API-Football (served through /api/af on our own server) ----------
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  const afApi = (p, ttl = 15000) => getJSON('/api/af/' + p, ttl);
  const AF_PIN = new Map(SITE.sports.football.leagues.filter((l) => l.af).map((l, i) => [l.af, i]));
  const AF_PRE = new Set(['TBD', 'NS', 'PST', 'CANC']);
  const AF_POST = new Set(['FT', 'AET', 'PEN', 'ABD', 'AWD', 'WO']);
  const isoDay = (day) => `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  const afMin = (t) => `${t?.elapsed ?? ''}${t?.extra ? '+' + t.extra : ''}'`;

  function afNormalize(f) {
    const st = f.fixture.status || {};
    const lg = f.league || {};
    const pinCfg = SITE.sports.football.leagues.find((l) => l.af === lg.id);
    const league = {
      slug: 'af', id: lg.id, name: pinCfg?.name || lg.name, country: lg.country === 'World' ? 'International' : (lg.country || ''),
      logo: lg.logo, season: lg.season, round: lg.round, standings: lg.standings !== false,
      pin: AF_PIN.has(lg.id) ? AF_PIN.get(lg.id) : -1,
    };
    const team = (t, g, pen) => ({
      id: String(t?.id ?? ''), name: t?.name || 'TBD', short: t?.name || 'TBD', logo: t?.logo || '',
      score: g == null ? '' : String(g), winner: t?.winner === true, pens: pen == null ? undefined : pen,
      linescores: [], reds: 0,
    });
    const m = {
      id: String(f.fixture.id), sport: 'football', league,
      date: new Date(f.fixture.date),
      state: AF_PRE.has(st.short) ? 'pre' : AF_POST.has(st.short) ? 'post' : 'in',
      statusName: st.short || '', afs: st, details: [],
      home: team(f.teams?.home, f.goals?.home, f.score?.penalty?.home),
      away: team(f.teams?.away, f.goals?.away, f.score?.penalty?.away),
    };
    for (const e of f.events || []) {
      if (e.type === 'Card' && /red|second yellow/i.test(e.detail || '')) {
        const side = String(e.team?.id) === m.home.id ? 'home' : 'away';
        m[side].reds++;
      }
    }
    return m;
  }

  function afLabel(m) {
    const st = m.afs;
    switch (st.short) {
      case 'NS': return timeStr(m.date);
      case 'TBD': return 'TBD';
      case '1H': case '2H': case 'ET': return afMin(st);
      case 'HT': return 'HT';
      case 'BT': return 'ET HT';
      case 'P': return 'Pens';
      case 'LIVE': return 'Live';
      case 'INT': return 'Int.';
      case 'SUSP': return 'Susp.';
      case 'PST': return 'Postp.';
      case 'CANC': return 'Canc.';
      case 'ABD': return 'Aband.';
      case 'AWD': return 'Awd.';
      case 'WO': return 'W/O';
      case 'PEN': return 'Pen';
      default: return st.short || '';
    }
  }

  async function afDay(day) {
    const today = day === todayStr();
    const [d, live] = await Promise.all([
      afApi(`fixtures?date=${isoDay(day)}&timezone=${encodeURIComponent(TZ)}`, today ? 20000 : 600000),
      today ? afApi(`fixtures?live=all&timezone=${encodeURIComponent(TZ)}`, 10000).catch(() => null) : null,
    ]);
    const byId = new Map((d.response || []).map((f) => [f.fixture.id, f]));
    for (const f of live?.response || []) if (byId.has(f.fixture.id)) byId.set(f.fixture.id, f);
    const groups = new Map();
    for (const f of byId.values()) {
      const m = afNormalize(f);
      const k = m.league.id;
      if (!groups.has(k)) groups.set(k, { league: m.league, matches: [] });
      groups.get(k).matches.push(m);
    }
    const list = [...groups.values()];
    list.forEach((g) => g.matches.sort((a, b) => a.date - b.date || a.home.name.localeCompare(b.home.name)));
    list.sort((a, b) => {
      const pa = a.league.pin, pb = b.league.pin;
      if (pa >= 0 || pb >= 0) return (pa < 0 ? 1e4 : pa) - (pb < 0 ? 1e4 : pb);
      return a.league.country.localeCompare(b.league.country) || a.league.name.localeCompare(b.league.name);
    });
    list.forEach((g, i) => { g.order = i; });
    return { src: 'af', groups: list, failed: 0, total: 1 };
  }

  async function afFixture(id) {
    const d = await afApi(`fixtures?id=${encodeURIComponent(id)}&timezone=${encodeURIComponent(TZ)}`, 15000);
    const f = d.response?.[0];
    if (!f) throw new Error('not found');
    return { f, match: afNormalize(f) };
  }

  async function afLeagueInfo(id) {
    let d = await afApi(`leagues?id=${encodeURIComponent(id)}&current=true`, 6 * 3600e3);
    let r = d.response?.[0];
    if (!r) { d = await afApi(`leagues?id=${encodeURIComponent(id)}`, 6 * 3600e3); r = d.response?.[0]; }
    if (!r) throw new Error('league not found');
    const seasons = r.seasons || [];
    const cur = seasons.find((s) => s.current) || seasons[seasons.length - 1];
    return { name: r.league?.name, logo: r.league?.logo, country: r.country?.name, season: cur?.year, standings: cur?.coverage?.standings !== false };
  }

  function noteColor(desc) {
    if (/relegation/i.test(desc)) return '#ff3b3b';
    if (/champions league/i.test(desc)) return '#2f7cf6';
    if (/europa league/i.test(desc)) return '#ff8a00';
    if (/conference/i.test(desc)) return '#00b3a4';
    if (/promotion|qualif|next round|play.?off|final/i.test(desc)) return '#00d26a';
    return '#8b9399';
  }

  async function afStandings(id, season) {
    const d = await afApi(`standings?league=${encodeURIComponent(id)}&season=${encodeURIComponent(season)}`, 600000);
    const lg = d.response?.[0]?.league;
    if (!lg) return [];
    return (lg.standings || []).map((arr) => ({
      name: arr[0]?.group || '',
      entries: arr.map((e) => ({
        team: { id: String(e.team.id), displayName: e.team.name, shortDisplayName: e.team.name, logos: [{ href: e.team.logo }] },
        rank: e.rank,
        s: {
          gamesPlayed: e.all?.played, wins: e.all?.win, ties: e.all?.draw, losses: e.all?.lose,
          pointDifferential: e.goalsDiff > 0 ? '+' + e.goalsDiff : e.goalsDiff, points: e.points, form: e.form,
        },
        note: e.description ? { description: e.description, color: noteColor(e.description) } : null,
      })),
    }));
  }

  function afIcon(e) {
    if (e.type === 'Goal') return e.detail === 'Missed Penalty' ? 'miss' : 'goal';
    if (e.type === 'Card') return /red|second/i.test(e.detail || '') ? 'rc' : 'yc';
    if (e.type === 'subst') return 'sub';
    if (e.type === 'Var') return 'var';
    return '';
  }

  // Substitution events list the outgoing player as `player` and the incoming one as `assist`,
  // but the feed has been inconsistent, so confirm against the starting XI.
  function afSubPair(e, starters) {
    if (starters.has(e.assist?.id) && !starters.has(e.player?.id)) return { out: e.assist, in: e.player };
    return { out: e.player, in: e.assist };
  }

  const afEvents = (f) => (f.events || []).slice().sort((a, b) =>
    (a.time.elapsed - b.time.elapsed) || ((a.time.extra || 0) - (b.time.extra || 0)));
  const afStarters = (f) => new Set((f.lineups || []).flatMap((l) => (l.startXI || []).map((p) => p.player.id)));

  function afScorersHTML(f, m) {
    const goals = afEvents(f).filter((e) => e.type === 'Goal' && e.detail !== 'Missed Penalty');
    if (!goals.length) return '';
    const side = (tid) => goals.filter((e) => String(e.team?.id) === tid).map((e) => {
      const tag = e.detail === 'Own Goal' ? ' (OG)' : e.detail === 'Penalty' ? ' (P)' : '';
      return `${esc(e.player?.name || 'Goal')}${tag} ${esc(afMin(e.time))}`;
    }).join('<br>');
    return `<div class="scorers"><div>${side(m.home.id)}</div><div>${side(m.away.id)}</div></div>`;
  }

  function afSummaryTab(f, m) {
    const evs = afEvents(f);
    const starters = afStarters(f);
    const ht = f.score?.halftime;
    const sep = (t) => `<div class="tl-sep">${esc(t)}</div>`;
    let out = '';
    if (evs.length) {
      let rows = '';
      let htDone = false;
      for (const e of evs) {
        if (!htDone && e.time.elapsed > 45) { rows += sep(`Half time ${ht?.home ?? ''} - ${ht?.away ?? ''}`); htDone = true; }
        const ic = afIcon(e);
        if (!ic) continue;
        let main = e.player?.name || '', sub = '';
        if (ic === 'goal') sub = e.detail === 'Own Goal' ? 'Own goal' : e.detail === 'Penalty' ? 'Penalty' : (e.assist?.name ? `Assist: ${e.assist.name}` : '');
        if (ic === 'miss') sub = 'Missed penalty';
        if (ic === 'yc' || ic === 'rc') sub = e.comments || (ic === 'rc' ? e.detail : '');
        if (ic === 'sub') { const p = afSubPair(e, starters); main = `In: ${p.in?.name || ''}`; sub = `Out: ${p.out?.name || ''}`; }
        if (ic === 'var') { main = e.detail || 'VAR'; sub = e.player?.name || ''; }
        const ev = `<span class="tl-ev"><span class="ico ${ic}"></span><span>${esc(main)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></span>`;
        const isHome = String(e.team?.id) === m.home.id;
        rows += `<div class="tl-row"><div class="h">${isHome ? ev : ''}</div><div class="min">${esc(afMin(e.time))}</div><div>${isHome ? '' : ev}</div></div>`;
      }
      if (!htDone && ht?.home != null && m.statusName !== '1H') rows += sep(`Half time ${ht.home} - ${ht.away}`);
      if (m.state === 'post') rows += sep(`${afLabel(m) === 'FT' ? 'Full time' : afLabel(m)} ${m.home.score} - ${m.away.score}`);
      out += `<div class="card"><div class="card-h">Key events</div>${rows}</div>`;
    } else if (m.state === 'pre') {
      out += `<div class="card"><div class="err">The match has not started yet. Goals, cards and substitutions will appear here live.</div></div>`;
    }
    const fx = f.fixture || {};
    const items = [
      ['Kick-off', m.date.toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false })],
      f.league?.round && ['Round', f.league.round],
      fx.venue?.name && ['Venue', fx.venue.name + (fx.venue.city ? `, ${fx.venue.city}` : '')],
      fx.referee && ['Referee', fx.referee],
    ].filter(Boolean);
    out += `<div class="card"><div class="card-h">Match info</div><div class="info">${items.map(([k, v]) => `<div><small>${k}</small>${esc(v)}</div>`).join('')}</div></div>`;
    return out;
  }

  function statRow(label, hd, ad) {
    const hv = parseFloat(hd), av = parseFloat(ad);
    let bars = '';
    if (!isNaN(hv) && !isNaN(av) && hv + av > 0) {
      const hp = (hv / (hv + av)) * 100;
      bars = `<div class="bars"><div><i class="${hv >= av ? 'lead' : ''}" style="width:${hp}%"></i></div><div><i class="${av >= hv ? 'lead' : ''}" style="width:${100 - hp}%"></i></div></div>`;
    }
    return `<div class="stat"><div class="sl"><span>${esc(hd)}</span><span>${esc(label)}</span><span>${esc(ad)}</span></div>${bars}</div>`;
  }

  const AF_STAT_LABEL = {
    expected_goals: 'Expected goals (xG)', goals_prevented: 'Goals prevented',
    'Shots insidebox': 'Shots inside box', 'Shots outsidebox': 'Shots outside box',
    'Total passes': 'Passes', 'Passes accurate': 'Accurate passes', 'Passes %': 'Pass accuracy',
  };
  const AF_STAT_FIRST = ['Ball Possession', 'expected_goals', 'Total Shots', 'Shots on Goal'];

  function afStatsTab(f, m) {
    const H = f.statistics.find((s) => String(s.team?.id) === m.home.id) || f.statistics[0];
    const A = f.statistics.find((s) => s !== H) || f.statistics[1];
    const amap = new Map((A?.statistics || []).map((x) => [x.type, x.value]));
    const list = (H?.statistics || []).slice().sort((a, b) => {
      const ia = AF_STAT_FIRST.indexOf(a.type), ib = AF_STAT_FIRST.indexOf(b.type);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const rows = list.map((x) => {
      const hv = x.value, av = amap.get(x.type);
      if (hv == null && av == null) return '';
      return statRow(AF_STAT_LABEL[x.type] || x.type, hv ?? 0, av ?? 0);
    }).join('');
    return `<div class="card"><div class="card-h">Match stats</div>${rows || '<div class="err">No stats yet.</div>'}</div>`;
  }

  function afLineupsTab(f, m) {
    const L = f.lineups;
    const H = L.find((l) => String(l.team?.id) === m.home.id) || L[0];
    const A = L.find((l) => l !== H) || L[1];
    const starters = afStarters(f);
    const goals = new Map(), cards = new Map(), off = new Set(), on = new Set();
    for (const e of f.events || []) {
      const ic = afIcon(e);
      if (ic === 'goal' && e.detail !== 'Own Goal') goals.set(e.player?.id, (goals.get(e.player?.id) || 0) + 1);
      if (ic === 'yc' && !cards.has(e.player?.id)) cards.set(e.player?.id, 'yc');
      if (ic === 'rc') cards.set(e.player?.id, 'rc');
      if (ic === 'sub') { const p = afSubPair(e, starters); off.add(p.out?.id); on.add(p.in?.id); }
    }
    const marks = (id) => '<i class="mk goal"></i>'.repeat(Math.min(goals.get(id) || 0, 3)) +
      (cards.get(id) ? `<i class="mk ${cards.get(id)}"></i>` : '') + (off.has(id) ? '<i class="mk off"></i>' : '') + (on.has(id) ? '<i class="mk on"></i>' : '');
    const hex = (c, d) => (c && /^[0-9a-f]{6}$/i.test(c) ? '#' + c : d);
    const lum = (h) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const readable = (bg, fg) => {
      const [a, b] = [lum(bg), lum(fg)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05) >= 3 ? fg : (lum(bg) > 0.4 ? '#111111' : '#ffffff');
    };

    const pitchSide = (l, flip) => {
      const rows = new Map();
      for (const { player: p } of l?.startXI || []) {
        const [r, c] = String(p.grid || '').split(':').map(Number);
        if (!r || !c) return null;
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r).push({ p, c });
      }
      if (!rows.size) return null;
      const bg = hex(l.team?.colors?.player?.primary, flip ? '#e8e8e8' : '#00d26a');
      const fg = readable(bg, hex(l.team?.colors?.player?.number, flip ? '#111111' : '#00170b'));
      let keys = [...rows.keys()].sort((a, b) => a - b);
      if (flip) keys = keys.reverse();
      return keys.map((r) => {
        let ps = rows.get(r).sort((a, b) => a.c - b.c);
        if (flip) ps = ps.reverse();
        return `<div class="prow">${ps.map(({ p }) => `
          <div class="pp"><span class="shirt" style="background:${bg};color:${fg}">${esc(p.number ?? '')}<span class="mks">${marks(p.id)}</span></span>
          <span class="pnm">${esc(p.name)}</span></div>`).join('')}</div>`;
      }).join('');
    };

    const top = pitchSide(H, false), bottom = pitchSide(A, true);
    const pitch = top && bottom ? `
      <div class="card pitch-card">
        <div class="pitch-h"><span>${esc(H.team?.name)}</span><small>${esc(H.formation || '')}</small></div>
        <div class="pitch"><div class="half">${top}</div><div class="half">${bottom}</div></div>
        <div class="pitch-h"><span>${esc(A.team?.name)}</span><small>${esc(A.formation || '')}</small></div>
      </div>` : '';

    const pl = (p) => `<div class="pl"><span class="no">${esc(p.number ?? '')}</span><span class="pn">${esc(p.name)} ${marks(p.id)}</span><span class="pp">${esc(p.pos || '')}</span></div>`;
    const col = (l) => !l ? '<div></div>' : `<div>
      <div class="lu-h"><span>${esc(l.team?.name || '')}</span><small>${esc(l.formation || '')}</small></div>
      ${pitch ? '' : (l.startXI || []).map((x) => pl(x.player)).join('')}
      ${(l.substitutes || []).length ? `<div class="card-h">Substitutes</div>${l.substitutes.map((x) => pl(x.player)).join('')}` : ''}
      ${l.coach?.name ? `<div class="card-h">Coach</div><div class="pl"><span class="no"></span><span class="pn">${esc(l.coach.name)}</span></div>` : ''}
    </div>`;
    return pitch + `<div class="card"><div class="lineups">${col(H)}${col(A)}</div></div>`;
  }

  function afH2H(list, m) {
    const games = (list || []).filter((f) => String(f.fixture.id) !== m.id)
      .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date)).slice(0, 10);
    if (!games.length) return `<div class="card"><div class="err">No previous meetings found.</div></div>`;
    let hw = 0, aw = 0, dr = 0;
    for (const g of games) {
      if (g.goals.home == null) continue;
      const winner = g.teams.home.winner ? g.teams.home.id : g.teams.away.winner ? g.teams.away.id : null;
      if (winner == null) dr++; else if (String(winner) === m.home.id) hw++; else aw++;
    }
    return `
      <div class="card"><div class="h2h-sum">
        <div><b>${hw}</b><small>${esc(m.home.short)} wins</small></div>
        <div><b>${dr}</b><small>Draws</small></div>
        <div><b>${aw}</b><small>${esc(m.away.short)} wins</small></div>
      </div></div>
      <div class="card"><div class="card-h">Previous meetings</div>${games.map((g) => `
        <a class="h2h-row" href="#/m/football/af/${g.fixture.id}"><span class="d">${esc(fmtDay(g.fixture.date))}</span>
        <span class="r">${esc(g.teams.home.name)}</span><b>${esc(g.goals.home ?? '')} - ${esc(g.goals.away ?? '')}</b><span>${esc(g.teams.away.name)}</span></a>`).join('')}
      </div>`;
  }

  async function viewAfMatch(token, silent) {
    const main = $('#main');
    if (!silent) main.innerHTML = skeleton(1);
    let data;
    try {
      data = await afFixture(route.id);
    } catch {
      if (token !== renderToken) return;
      main.innerHTML = `<a class="back" href="#/football">&lsaquo; Back</a><div class="empty"><b>Match not available</b>We could not load this match. Try again shortly.</div>`;
      return;
    }
    if (token !== renderToken) return;
    const { f, match: m } = data;
    const tabs = [['summary', 'Summary']];
    if (f.statistics?.length) tabs.push(['stats', 'Stats']);
    if (f.lineups?.length) tabs.push(['lineups', 'Line-ups']);
    if (m.league.standings) tabs.push(['table', 'Table']);
    tabs.push(['h2h', 'H2H']);
    const tab = tabs.some((t) => t[0] === route.tab) ? route.tab : 'summary';
    let body = '';
    try {
      if (tab === 'summary') body = afSummaryTab(f, m);
      if (tab === 'stats') body = afStatsTab(f, m);
      if (tab === 'lineups') body = afLineupsTab(f, m);
      if (tab === 'table') body = standingsCard(await afStandings(m.league.id, m.league.season), 'football', [m.home.id, m.away.id]);
      if (tab === 'h2h') {
        const d = await afApi(`fixtures/headtohead?h2h=${m.home.id}-${m.away.id}&last=11&timezone=${encodeURIComponent(TZ)}`, 3600e3);
        body = afH2H(d.response, m);
      }
    } catch {
      body = `<div class="card"><div class="err">This section could not be loaded. Retrying shortly.</div></div>`;
    }
    if (token !== renderToken) return;
    const stt = m.state === 'pre' ? shortDate(m.date) : m.afs.short === 'FT' ? 'Full time' : afLabel(m);
    main.innerHTML = matchHeaderHTML(m, tabs, tab, afScorersHTML(f, m), stt) + body;
    document.title = `${m.home.short} ${hasScore(m) ? m.home.score + '-' + m.away.score : 'vs'} ${m.away.short} | ${SITE.name}`;
    if (!silent) renderSideRight(lastGroups);
  }

  async function viewAfLeague(token, silent) {
    const main = $('#main');
    const { league: id, tab } = route;
    const base = `#/l/football/${id}`;
    const pinCfg = SITE.sports.football.leagues.find((l) => String(l.af) === id);
    const head = (info) => `
      <a class="back" href="#/football">&lsaquo; Football</a>
      <div class="lg-head">${info?.logo ? img(info.logo) : ''}<div><h1>${esc(pinCfg?.name || info?.name || 'Competition')}</h1>
        <div class="muted">${esc(pinCfg?.country || info?.country || '')}${info?.season ? ` &middot; ${esc(info.season)}${/^\d{4}$/.test(String(info.season)) ? '/' + String(+info.season + 1).slice(2) : ''}` : ''}</div></div>
        <nav class="tabs">
          <a href="${base}?tab=matches&d=${route.d}" class="${tab === 'matches' ? 'on' : ''}">Matches</a>
          <a href="${base}?tab=table" class="${tab === 'table' ? 'on' : ''}">Table</a>
        </nav></div>`;
    if (!silent) main.innerHTML = head(null) + skeleton(1);
    try {
      const info = await afLeagueInfo(id);
      document.title = `${pinCfg?.name || info.name} | ${SITE.name}`;
      if (tab === 'table') {
        const groups = await afStandings(id, info.season);
        if (token !== renderToken) return;
        main.innerHTML = head(info) + standingsCard(groups, 'football');
      } else {
        const day = await afDay(route.d);
        if (token !== renderToken) return;
        const g = day.groups.find((x) => String(x.league.id) === id);
        const bar = dateBarHTML(base, route.d, false, 0).replace(/\?d=/g, '?tab=matches&d=').replace(/<a class="livepill[\s\S]*?<\/a>/, '');
        main.innerHTML = head(info) + bar + (g ? groupHTML(g, { more: false })
          : `<div class="empty"><b>No matches on this day</b>Pick another date above, or open the Table tab.</div>`);
      }
    } catch {
      if (token !== renderToken) return;
      main.innerHTML = head(null) + `<div class="empty"><b>Could not load this competition</b>Retrying shortly.</div>`;
    }
    if (!silent) renderSideRight(lastGroups);
  }

  // ---------- matches added in the admin panel ----------
  let serverOffset = 0;
  const CUSTOM_CAP = { '1H': 45, '2H': 90, 'ET': 120 };

  function customMinute(c) {
    if (!c.clock?.startedAt) return null;
    const elapsed = c.clock.base + Math.floor((Date.now() + serverOffset - c.clock.startedAt) / 60000) + 1;
    const cap = CUSTOM_CAP[c.status];
    return cap && elapsed > cap ? { elapsed: cap, extra: elapsed - cap } : { elapsed, extra: null };
  }

  function badge(name) {
    const initials = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="hsl(${h},55%,42%)"/><text x="20" y="25" font-family="Arial" font-size="15" font-weight="700" fill="#fff" text-anchor="middle">${initials.replace(/[<&]/g, '')}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  const flagUrl = (code) => (code && window.FLAG_URL ? window.FLAG_URL(code) : '');
  const CE_TYPE = { goal: 'Goal', pen: 'Goal', og: 'Goal', miss: 'Goal', yc: 'Card', rc: 'Card', sub: 'subst' };
  const CE_DETAIL = { goal: 'Normal Goal', pen: 'Penalty', og: 'Own Goal', miss: 'Missed Penalty', yc: 'Yellow Card', rc: 'Red Card', sub: 'Substitution' };

  function customToAf(c) {
    const min = customMinute(c);
    const started = !['NS', 'PST', 'CANC'].includes(c.status);
    const done = ['FT', 'AET', 'PEN'].includes(c.status);
    const hs = c.score?.home ?? 0, as = c.score?.away ?? 0;
    const events = (c.events || []).map((e) => ({
      time: { elapsed: e.elapsed, extra: e.extra },
      team: { id: e.team === 'away' ? 'a' : 'h' },
      player: { name: e.player || '' }, assist: { name: e.assist || null },
      type: CE_TYPE[e.type], detail: CE_DETAIL[e.type], comments: e.note || null,
    }));
    let ht = { home: null, away: null };
    if (started && c.status !== '1H') {
      const first = events.filter((e) => e.type === 'Goal' && e.detail !== 'Missed Penalty' && e.time.elapsed <= 45);
      ht = { home: first.filter((e) => e.team.id === 'h').length, away: first.filter((e) => e.team.id === 'a').length };
    }
    let hw = null, aw = null;
    if (done) {
      if (hs !== as) { hw = hs > as; aw = as > hs; }
      else if (c.pens && c.pens.home !== c.pens.away) { hw = c.pens.home > c.pens.away; aw = !hw; }
    }
    return {
      fixture: {
        id: c.id, date: c.kickoff,
        status: { short: c.status, elapsed: min?.elapsed ?? null, extra: min?.extra ?? null },
        venue: { name: c.venue || null, city: null }, referee: c.referee || null,
      },
      league: {
        id: `custom:${c.sport}:${c.competition}`, name: c.competition, country: c.country || '',
        logo: c.competitionLogo || flagUrl(c.competitionFlag), round: c.round || null, standings: false,
      },
      teams: {
        home: { id: 'h', name: c.home?.name, logo: c.home?.logo || flagUrl(c.home?.flag) || badge(c.home?.name), winner: hw },
        away: { id: 'a', name: c.away?.name, logo: c.away?.logo || flagUrl(c.away?.flag) || badge(c.away?.name), winner: aw },
      },
      goals: started ? { home: hs, away: as } : { home: null, away: null },
      score: { halftime: ht, penalty: c.pens || { home: null, away: null } },
      events,
    };
  }

  function customMatch(c) {
    const m = afNormalize(customToAf(c));
    m.id = c.id;
    m.sport = c.sport;
    m.league.slug = 'custom';
    m.league.pin = 0;
    m.league.standings = false;
    if (c.liveLabel) m.customLabel = c.liveLabel;
    return m;
  }

  async function customDay(sport, day) {
    const d = fromYmd(day);
    const data = await getJSON(`/api/custom?from=${addDays(d, -1).toISOString()}&to=${addDays(d, 2).toISOString()}`, 5000);
    serverOffset = (data.now || Date.now()) - Date.now();
    const groups = new Map();
    for (const c of data.matches || []) {
      if (c.sport !== sport) continue;
      const m = customMatch(c);
      if (ymd(m.date) !== day) continue;
      const k = m.league.id;
      if (!groups.has(k)) groups.set(k, { league: m.league, order: -1, matches: [] });
      groups.get(k).matches.push(m);
    }
    const list = [...groups.values()];
    list.forEach((g) => g.matches.sort((a, b) => a.date - b.date));
    return list;
  }

  async function customFixture(id) {
    const d = await getJSON(`/api/custom/${encodeURIComponent(id)}`, 3000);
    serverOffset = (d.now || Date.now()) - Date.now();
    return { f: customToAf(d.match), match: customMatch(d.match) };
  }

  async function viewCustomMatch(token, silent) {
    const main = $('#main');
    if (!silent) main.innerHTML = skeleton(1);
    let data;
    try {
      data = await customFixture(route.id);
    } catch {
      if (token !== renderToken) return;
      main.innerHTML = `<a class="back" href="#/${esc(route.sport)}">&lsaquo; Back</a><div class="empty"><b>Match not available</b>This match may have been removed.</div>`;
      return;
    }
    if (token !== renderToken) return;
    const { f, match: m } = data;
    const stt = m.state === 'pre' ? shortDate(m.date) : m.afs.short === 'FT' ? 'Full time' : statusLabel(m);
    main.innerHTML = matchHeaderHTML(m, [['summary', 'Summary']], 'summary', afScorersHTML(f, m), stt) + afSummaryTab(f, m);
    document.title = `${m.home.short} ${hasScore(m) ? m.home.score + '-' + m.away.score : 'vs'} ${m.away.short} | ${SITE.name}`;
    if (!silent) renderSideRight(lastGroups);
  }

  // Admin edits show up within a few seconds: poll a tiny "version" endpoint and re-render on change.
  function watchCustom() {
    let last = null;
    const check = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch('/api/custom/version', { cache: 'no-store' });
        if (!r.ok) return;
        const { v } = await r.json();
        if (last !== null && v !== last) {
          for (const k of [...cache.keys()]) if (k.startsWith('/api/custom')) cache.delete(k);
          if (route.view !== 'league') render(true);
        }
        last = v;
      } catch { /* offline; try again next tick */ }
    };
    check();
    setInterval(check, 5000);
    document.addEventListener('visibilitychange', check);
  }

  // ---------- render loop ----------
  async function render(silent = false) {
    const token = ++renderToken;
    renderSports();
    renderSideLeft();
    if (!silent) window.scrollTo(0, 0);
    if (route.view === 'match' && route.league === 'af') return viewAfMatch(token, silent);
    if (route.view === 'match' && route.league === 'custom') return viewCustomMatch(token, silent);
    if (route.view === 'match') return viewMatch(token, silent);
    if (route.view === 'league' && route.sport === 'football' && /^\d+$/.test(route.league || '')) return viewAfLeague(token, silent);
    if (route.view === 'league') return viewLeague(token, silent);
    if (route.view === 'fav') return viewFav(token);
    return viewList(token, silent);
  }

  window.addEventListener('hashchange', () => { route = parseRoute(); render(); });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fav]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const id = b.dataset.fav;
    if (favs[id]) delete favs[id]; else favs[id] = { added: Date.now(), date: b.dataset.date };
    saveFavs(favs);
    b.classList.toggle('on', !!favs[id]);
    if (route.view === 'fav') render(true);
  });

  document.addEventListener('change', (e) => {
    const inp = e.target.closest('.cal input');
    if (!inp || !inp.value) return;
    const d = inp.value.replace(/-/g, '');
    const base = inp.dataset.base;
    location.hash = base.startsWith('#/l/') ? `${base}?tab=matches&d=${d}` : `${base}?d=${d}`;
  });

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTerm = e.target.value;
      if (route.view === 'list' || route.view === 'fav') render(true);
    }, 200);
  });

  setInterval(() => {
    if (document.hidden) return;
    const r = route;
    const isToday = r.view === 'list' && (r.live || r.d === todayStr());
    if (isToday || r.view === 'match' || r.view === 'fav' || (r.view === 'league' && r.tab === 'matches')) render(true);
  }, SITE.refreshMs);

  // ---------- boot ----------
  document.querySelectorAll('[data-brand]').forEach((el) => { el.textContent = SITE.name; });
  document.querySelectorAll('[data-tagline]').forEach((el) => { el.textContent = SITE.tagline; });
  $('#year').textContent = new Date().getFullYear();
  fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => {
      if (c?.football === 'af') FOOTBALL_SRC = 'af';
      if (c?.custom) watchCustom();
      if (c) { SITE_API = '/api/espn/site'; V2_API = '/api/espn/v2'; }
    })
    .catch(() => {})
    .finally(() => render());
})();
