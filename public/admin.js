(() => {
  'use strict';

  const SITE = window.SITE;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TOKEN_KEY = 'sn_admin_token';

  const state = { token: '', user: null, view: 'matches', matches: [], sel: null, filter: 'live', offset: 0, ev: { type: 'goal', team: 'home' } };
  try { state.token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* storage blocked */ }
  const setToken = (t) => {
    state.token = t;
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
  };
  const ago = (t) => {
    if (!t) return 'never';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const SPORT_LABEL = Object.fromEntries(Object.entries(SITE.sports).map(([k, v]) => [k, v.label]));
  const STATUS_TEXT = {
    NS: 'Not started', '1H': '1st half', HT: 'Half time', '2H': '2nd half', ET: 'Extra time', BT: 'ET break', P: 'Penalties',
    FT: 'Full time', AET: 'After extra time', PEN: 'After penalties', PST: 'Postponed', CANC: 'Cancelled', SUSP: 'Suspended', INT: 'Interrupted', ABD: 'Abandoned',
  };
  const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT']);
  const DONE = new Set(['FT', 'AET', 'PEN', 'ABD', 'CANC']);
  const CAP = { '1H': 45, '2H': 90, 'ET': 120 };
  const EV_LABEL = { goal: 'Goal', pen: 'Penalty goal', og: 'Own goal', miss: 'Missed penalty', yc: 'Yellow card', rc: 'Red card', sub: 'Substitution' };
  const EV_ICON = { goal: 'goal', pen: 'goal', og: 'goal', miss: 'miss', yc: 'yc', rc: 'rc', sub: 'sub' };

  // ---------- helpers ----------
  function toast(msg, err = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.className = 'toast' + (err ? ' err' : ''); }, 2200);
  }

  async function api(method, path, body) {
    const r = await fetch('/api/admin/' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== 'login') { logout(); throw new Error(data.error || 'Please log in again'); }
    if (!r.ok) throw new Error(data.error || 'Request failed');
    if (data.now) state.offset = data.now - Date.now();
    return data;
  }

  function minuteOf(m) {
    if (!m.clock?.startedAt) return null;
    const e = m.clock.base + Math.floor((Date.now() + state.offset - m.clock.startedAt) / 60000) + 1;
    const cap = CAP[m.status];
    return cap && e > cap ? { elapsed: cap, extra: e - cap } : { elapsed: e, extra: null };
  }
  const fmtMin = (t) => t ? `${t.elapsed}${t.extra ? '+' + t.extra : ''}'` : '';
  const isAuto = (m) => (m.autoMode ? m.autoMode !== 'off' : !m.id || m.status === 'NS');

  function shortStatus(m) {
    if (m.status === 'NS') return new Date(m.kickoff).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    if (m.liveLabel && LIVE.has(m.status)) return m.liveLabel;
    if (['1H', '2H', 'ET'].includes(m.status)) return fmtMin(minuteOf(m)) || 'Live';
    return { HT: 'HT', BT: 'ET HT', P: 'Pens', PST: 'Postp.', CANC: 'Canc.', PEN: 'Pen', SUSP: 'Susp.', INT: 'Int.', ABD: 'Aband.' }[m.status] || m.status;
  }

  function localInput(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const current = () => state.matches.find((m) => m.id === state.sel);
  function upsert(m) {
    const i = state.matches.findIndex((x) => x.id === m.id);
    if (i >= 0) state.matches[i] = m; else state.matches.push(m);
  }

  // ---------- auth ----------
  function logout() {
    setToken('');
    state.user = null;
    renderLogin();
  }

  function renderLogin() {
    $('#topActions').hidden = true;
    $('#adminNav').hidden = true;
    $('#app').innerHTML = `
      <div class="login"><form class="card" id="loginForm">
        <h1>Admin sign in</h1>
        <p>Add your own matches and update scores live on ${esc(SITE.name)}.</p>
        <label class="f"><span>Username</span><input name="username" autocomplete="username" required autofocus></label>
        <label class="f" style="margin-top:12px"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
        <div class="actions"><button class="btn" type="submit" style="width:100%">Sign in</button></div>
      </form></div>`;
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        const { token, user } = await api('POST', 'login', { username: e.target.username.value, password: e.target.password.value });
        setToken(token);
        state.user = user;
        state.view = 'matches';
        await boot();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    });
  }

  // ---------- list ----------
  function filtered() {
    const f = state.filter;
    return state.matches.filter((m) =>
      f === 'all' ? true : f === 'live' ? LIVE.has(m.status) : f === 'upcoming' ? ['NS', 'PST'].includes(m.status) : DONE.has(m.status))
      .sort((a, b) => f === 'done' ? new Date(b.kickoff) - new Date(a.kickoff) : new Date(a.kickoff) - new Date(b.kickoff));
  }

  function renderList() {
    const counts = {
      live: state.matches.filter((m) => LIVE.has(m.status)).length,
      upcoming: state.matches.filter((m) => ['NS', 'PST'].includes(m.status)).length,
      done: state.matches.filter((m) => DONE.has(m.status)).length,
      all: state.matches.length,
    };
    const list = filtered();
    $('#listPanel').innerHTML = `
      <div class="list-head"><b>Your matches</b><button class="btn sm" data-new>+ New match</button></div>
      <div class="chips">${[['live', 'Live'], ['upcoming', 'Upcoming'], ['done', 'Finished'], ['all', 'All']].map(([k, l]) =>
        `<button class="chip ${state.filter === k ? 'on' : ''}" data-filter="${k}">${l} ${counts[k]}</button>`).join('')}</div>
      <div class="mlist">${list.length ? list.map((m) => `
        <div class="mi ${m.id === state.sel ? 'on' : ''} ${LIVE.has(m.status) ? 'live' : ''}" data-sel="${m.id}">
          <div class="st" data-clock="${m.id}">${esc(shortStatus(m))}</div>
          <div class="nm"><div>${esc(m.home.name)}</div><div>${esc(m.away.name)}</div>
            <small>${esc(SPORT_LABEL[m.sport] || m.sport)} · ${esc(m.competition)} · ${new Date(m.kickoff).toLocaleDateString([], { day: 'numeric', month: 'short' })}</small></div>
          <div class="sc">${m.status === 'NS' ? '' : `${m.score.home}<br>${m.score.away}`}</div>
        </div>`).join('') : `<div class="none">No matches here yet.</div>`}</div>`;
  }

  // ---------- editor ----------
  function renderEditor() {
    const ed = $('#editor');
    if (state.sel === 'new') { ed.innerHTML = detailsHTML(null); bindDetails(null); return; }
    const m = current();
    if (!m) {
      ed.innerHTML = `<div class="sect"><div class="none">Pick a match on the left, or create a new one.<br><br><button class="btn" data-new>+ New match</button></div></div>`;
      return;
    }
    ed.innerHTML = `<div id="liveSect"></div><div id="evSect"></div>${detailsHTML(m)}`;
    renderLive();
    renderEvents();
    bindDetails(m);
  }

  function statusButtons(m) {
    const s = m.status;
    const endStatus = s === 'ET' || s === 'BT' ? 'AET' : s === 'P' ? 'PEN' : 'FT';
    const btn = (st, label, cls = 'ghost') => `<button class="btn sm ${cls} ${s === st ? 'on' : ''}" data-status="${st}">${label}</button>`;
    if (m.sport !== 'football') {
      return btn('1H', 'Start / live', s === 'NS' ? 'live' : 'ghost') + btn('HT', 'Break') + btn('2H', 'Resume 2nd half') +
        btn('FT', 'Finished', LIVE.has(s) ? '' : 'ghost') + btn('PST', 'Postponed') + btn('CANC', 'Cancelled') + btn('NS', 'Not started');
    }
    return btn('1H', 'Kick off', s === 'NS' ? 'live' : 'ghost') + btn('HT', 'Half time') + btn('2H', 'Start 2nd half') +
      btn('ET', 'Extra time') + btn('P', 'Penalties') + btn(endStatus, 'Full time', LIVE.has(s) ? '' : 'ghost') +
      btn('PST', 'Postponed') + btn('CANC', 'Cancelled') + btn('NS', 'Not started');
  }

  function autoNote(m) {
    if (!isAuto(m)) return '';
    const at = new Date(m.kickoff).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const plan = m.sport === 'football'
      ? `Kicks off ${esc(at)}, half time after 45+${m.autoAdded1 ?? 2}', 15-minute break, full time after 90+${m.autoAdded2 ?? 4}'.`
      : `Goes live at ${esc(at)} and is marked finished 3½ hours later.`;
    return `<div class="auto-note"><b>Automatic clock.</b> ${plan} Add goals and cards as they happen. Pressing any status button below switches this match to manual.</div>`;
  }

  function renderLive() {
    const m = current();
    const el = $('#liveSect');
    if (!m || !el) return;
    const live = LIVE.has(m.status);
    const logo = (t) => {
      const src = t.logo || (t.flag ? window.FLAG_URL(t.flag) : '');
      return src ? `<img src="${esc(src)}" alt="" onerror="this.style.visibility='hidden'">` : '';
    };
    const side = (k) => `<div>${logo(m[k])}<div class="tn">${esc(m[k].name)}</div>
      <div class="score-ctl"><button data-score="${k}" data-d="-1" title="Remove a goal without an event">&minus;</button><button data-score="${k}" data-d="1" title="Add a goal without an event">+</button></div></div>`;
    el.innerHTML = `
      <section class="sect">
        <div class="sect-h"><span>Live control</span><span>${esc(STATUS_TEXT[m.status] || m.status)}</span></div>
        <div class="board">
          ${side('home')}
          <div><div class="big">${m.score.home} - ${m.score.away}</div>
            <div class="clock ${live ? 'live' : ''}" data-clock="${m.id}">${esc(shortStatus(m))}</div>
            ${m.pens ? `<div class="hint">Pens ${m.pens.home} - ${m.pens.away}</div>` : ''}</div>
          ${side('away')}
        </div>
        ${autoNote(m)}
        <div class="status-row">${statusButtons(m)}</div>
        <form class="inline" id="minuteForm">
          <label class="f narrow"><span>Set minute</span><input type="number" name="minute" min="1" max="200" placeholder="${esc(minuteOf(m)?.elapsed ?? '')}"></label>
          <button class="btn sm ghost" type="submit">Set clock</button>
          <label class="f" style="flex:1;min-width:160px"><span>Custom live text (optional, e.g. "Q3 5:21")</span><input name="liveLabel" maxlength="20" value="${esc(m.liveLabel || '')}"></label>
          <button class="btn sm ghost" type="button" id="saveLabel">Save text</button>
        </form>
        <div class="hint" style="padding:0 16px 16px">The clock runs by itself once the match is live. The site updates the moment you press a button.</div>
      </section>`;
    $('#minuteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = e.target.minute.value;
      if (!v) return toast('Type a minute first', true);
      await act({ action: 'minute', minute: +v }, `Clock set to ${v}'`);
    });
    $('#saveLabel').addEventListener('click', async () => {
      try {
        const { match } = await api('PUT', `matches/${m.id}`, { liveLabel: $('#minuteForm').liveLabel.value });
        upsert(match); renderList(); renderLive(); toast('Saved');
      } catch (err) { toast(err.message, true); }
    });
  }

  function renderEvents() {
    const m = current();
    const el = $('#evSect');
    if (!m || !el) return;
    const t = state.ev.type;
    const second = t === 'sub' ? 'Player coming on' : ['goal', 'pen'].includes(t) ? 'Assist (optional)' : '';
    const firstLabel = t === 'sub' ? 'Player going off' : t === 'og' ? 'Player (own goal)' : 'Player';
    const evs = (m.events || []).slice().sort((a, b) => (b.elapsed - a.elapsed) || ((b.extra || 0) - (a.extra || 0)));
    el.innerHTML = `
      <section class="sect">
        <div class="sect-h"><span>Add goal, card or substitution</span><span>${minuteOf(m) ? `Now: ${esc(fmtMin(minuteOf(m)))}` : 'Not live'}</span></div>
        <form class="sect-b" id="evForm">
          <div class="grid">
            <label class="f"><span>Event</span><select name="type">${Object.entries(EV_LABEL).map(([k, l]) => `<option value="${k}" ${k === t ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <div class="f"><span>${t === 'og' ? 'Goal counts for' : 'Team'}</span><div class="seg">
              <button type="button" data-team="home" class="${state.ev.team === 'home' ? 'on' : ''}">${esc(m.home.name)}</button>
              <button type="button" data-team="away" class="${state.ev.team === 'away' ? 'on' : ''}">${esc(m.away.name)}</button></div></div>
            <label class="f"><span>${firstLabel}</span><input name="player" maxlength="80"></label>
            ${second ? `<label class="f"><span>${second}</span><input name="assist" maxlength="80"></label>` : '<div></div>'}
            <label class="f"><span>Minute (leave empty to use the live clock)</span><input type="number" name="minute" min="0" max="200" placeholder="${esc(minuteOf(m)?.elapsed ?? '')}"></label>
            <label class="f"><span>Added time (e.g. 2 for 45+2)</span><input type="number" name="extra" min="0" max="30"></label>
          </div>
          <div class="actions"><span class="hint">${['goal', 'pen', 'og'].includes(t) ? 'Adding a goal also adds 1 to the score.' : ''}</span>
            <button class="btn" type="submit">Add ${esc(EV_LABEL[t].toLowerCase())}</button></div>
        </form>
        <div class="evs">${evs.map((e) => `
          <div class="ev"><span class="min">${esc(fmtMin(e))}</span><span class="ico ${EV_ICON[e.type]}"></span>
            <div><b>${esc(e.type === 'sub' ? `On: ${e.assist || '?'}` : e.player || EV_LABEL[e.type])}</b>
              <small>${esc(EV_LABEL[e.type])}${e.type === 'sub' && e.player ? ` · Off: ${e.player}` : ''}${e.type !== 'sub' && e.assist ? ` · Assist: ${e.assist}` : ''} · <span class="side">${esc(m[e.team].name)}</span></small></div>
            <button class="x" data-delev="${e.id}" title="Delete event">&times;</button></div>`).join('')}
        </div>
      </section>`;
    const form = $('#evForm');
    form.type.addEventListener('change', () => { state.ev.type = form.type.value; renderEvents(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        type: state.ev.type, team: state.ev.team,
        player: form.player.value, assist: form.assist?.value || '',
        minute: form.minute.value, extra: form.extra.value,
      };
      try {
        const { match } = await api('POST', `matches/${m.id}/events`, body);
        upsert(match); renderList(); renderLive(); renderEvents();
        toast(`${EV_LABEL[body.type]} added`);
      } catch (err) { toast(err.message, true); }
    });
  }

  const flagImg = (code) => code ? `<img class="flag-prev" src="${esc(window.FLAG_URL(code, 40))}" alt="">` : '<span class="flag-prev"></span>';
  function flagPicker(name, label, value, hint) {
    return `<label class="f"><span>${label}</span>
      <div class="flag-pick">${flagImg(value)}<select name="${name}" data-flag>
        <option value="">${hint}</option>
        ${window.FLAGS.map(([c, n]) => `<option value="${c}" ${c === value ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select></div></label>`;
  }

  function detailsHTML(m) {
    const d = m || {
      sport: 'football', competition: '', country: '', competitionLogo: '', competitionFlag: '', round: '', venue: '', referee: '',
      kickoff: new Date(Math.ceil(Date.now() / 9e5) * 9e5).toISOString(),
      home: { name: '', logo: '', flag: '' }, away: { name: '', logo: '', flag: '' }, pens: null,
    };
    const inp = (name, label, val, extra = '') => `<label class="f ${extra}"><span>${label}</span><input name="${name}" value="${esc(val)}" maxlength="400"></label>`;
    return `
      <section class="sect">
        <div class="sect-h"><span>${m ? 'Match details' : 'New match'}</span></div>
        <form class="sect-b" id="detForm">
          <div class="grid">
            <label class="f"><span>Sport</span><select name="sport">${Object.entries(SPORT_LABEL).map(([k, l]) => `<option value="${k}" ${k === d.sport ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
            <label class="f"><span>Kick-off (your local time)</span><input type="datetime-local" name="kickoff" value="${localInput(d.kickoff)}" required></label>
            ${inp('home_name', 'Home team', d.home.name)}
            ${inp('away_name', 'Away team', d.away.name)}
            ${inp('home_logo', 'Home logo URL (optional)', d.home.logo)}
            ${inp('away_logo', 'Away logo URL (optional)', d.away.logo)}
            ${flagPicker('home_flag', 'Home flag (shown when there is no logo)', d.home.flag || '', 'No flag')}
            ${flagPicker('away_flag', 'Away flag (shown when there is no logo)', d.away.flag || '', 'No flag')}
            ${inp('competition', 'Competition', d.competition)}
            ${flagPicker('competitionFlag', 'Country flag for the competition', d.competitionFlag || '', 'No flag')}
            ${inp('country', 'Country / region name', d.country)}
            ${inp('round', 'Round (optional)', d.round)}
            ${inp('competitionLogo', 'Competition logo URL (optional)', d.competitionLogo)}
            <label class="f full"><span>Match clock</span><select name="autoMode">
              <option value="auto" ${isAuto(d) ? 'selected' : ''}>Automatic: starts at kick-off, half time, 2nd half and full time by itself</option>
              <option value="off" ${isAuto(d) ? '' : 'selected'}>Manual: I press Kick off, Half time and Full time myself</option>
            </select></label>
            <label class="f" data-auto-full><span>Added time, 1st half (minutes)</span><input type="number" name="autoAdded1" min="0" max="15" value="${esc(d.autoAdded1 ?? 2)}"></label>
            <label class="f" data-auto-full><span>Added time, 2nd half (minutes)</span><input type="number" name="autoAdded2" min="0" max="15" value="${esc(d.autoAdded2 ?? 4)}"></label>
            ${inp('venue', 'Venue (optional)', d.venue)}
            ${inp('referee', 'Referee (optional)', d.referee)}
            ${m ? `
            <label class="f"><span>Penalties: home (shoot-out only)</span><input type="number" name="pens_home" min="0" value="${esc(d.pens?.home ?? '')}"></label>
            <label class="f"><span>Penalties: away</span><input type="number" name="pens_away" min="0" value="${esc(d.pens?.away ?? '')}"></label>` : ''}
          </div>
          <div class="actions">
            ${m ? '<button class="btn danger" type="button" id="delMatch">Delete match</button>' : '<span></span>'}
            <button class="btn" type="submit">${m ? 'Save details' : 'Create match'}</button>
          </div>
        </form>
      </section>`;
  }

  function bindDetails(m) {
    const form = $('#detForm');
    const syncAuto = () => form.querySelectorAll('[data-auto-full]').forEach((el) => { el.hidden = form.autoMode.value !== 'auto' || form.sport.value !== 'football'; });
    form.autoMode.addEventListener('change', syncAuto);
    form.sport.addEventListener('change', syncAuto);
    syncAuto();
    form.querySelectorAll('[data-flag]').forEach((sel) => sel.addEventListener('change', () => {
      sel.previousElementSibling.outerHTML = flagImg(sel.value);
      if (sel.name === 'competitionFlag' && sel.value && !form.country.value.trim()) {
        form.country.value = sel.options[sel.selectedIndex].text;
      }
    }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = (n) => form[n]?.value ?? '';
      if (!v('home_name').trim() || !v('away_name').trim()) return toast('Enter both team names', true);
      const body = {
        sport: v('sport'), kickoff: new Date(v('kickoff')).toISOString(),
        home: { name: v('home_name'), logo: v('home_logo'), flag: v('home_flag') },
        away: { name: v('away_name'), logo: v('away_logo'), flag: v('away_flag') },
        competition: v('competition') || 'Friendly', competitionFlag: v('competitionFlag'), country: v('country'), round: v('round'),
        competitionLogo: v('competitionLogo'), venue: v('venue'), referee: v('referee'),
        autoMode: v('autoMode'), autoAdded1: v('autoAdded1'), autoAdded2: v('autoAdded2'),
      };
      if (m) body.pens = { home: v('pens_home'), away: v('pens_away') };
      try {
        const { match } = m ? await api('PUT', `matches/${m.id}`, body) : await api('POST', 'matches', body);
        upsert(match);
        state.sel = match.id;
        if (!m) state.filter = 'upcoming';
        renderList(); renderEditor();
        toast(m ? 'Details saved' : 'Match created');
      } catch (err) { toast(err.message, true); }
    });
    $('#delMatch')?.addEventListener('click', async () => {
      if (!confirm(`Delete ${m.home.name} vs ${m.away.name}? This cannot be undone.`)) return;
      try {
        await api('DELETE', `matches/${m.id}`);
        state.matches = state.matches.filter((x) => x.id !== m.id);
        state.sel = null;
        renderList(); renderEditor();
        toast('Match deleted');
      } catch (err) { toast(err.message, true); }
    });
  }

  async function act(body, msg) {
    const m = current();
    try {
      const { match } = await api('POST', `matches/${m.id}/action`, body);
      upsert(match); renderList(); renderLive(); renderEvents();
      if (msg) toast(msg);
    } catch (err) { toast(err.message, true); }
  }

  // ---------- events ----------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-sel]');
    if (!t) return;
    if (t.dataset.new !== undefined) { state.sel = 'new'; renderList(); renderEditor(); return; }
    if (t.dataset.filter) { state.filter = t.dataset.filter; renderList(); return; }
    if (t.dataset.sel) { state.sel = t.dataset.sel; renderList(); renderEditor(); return; }
    if (t.dataset.status) return act({ action: 'status', status: t.dataset.status }, STATUS_TEXT[t.dataset.status]);
    if (t.dataset.score) return act({ action: 'score', team: t.dataset.score, delta: +t.dataset.d });
    if (t.dataset.team) { state.ev.team = t.dataset.team; t.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === t)); return; }
    if (t.dataset.resetpw) {
      const pw = prompt(`New password for @${t.dataset.uname} (at least 8 characters):`);
      if (!pw) return;
      try { await api('PUT', `users/${t.dataset.resetpw}`, { password: pw }); toast('Password reset. Their other sessions are signed out.'); } catch (err) { toast(err.message, true); }
      return;
    }
    if (t.dataset.deluser) {
      if (!confirm(`Remove admin @${t.dataset.uname}? They will be signed out immediately.`)) return;
      try { await api('DELETE', `users/${t.dataset.deluser}`); toast('Admin removed'); renderUsers(); } catch (err) { toast(err.message, true); }
      return;
    }
    if (t.dataset.delev) {
      const m = current();
      try {
        const { match } = await api('DELETE', `matches/${m.id}/events/${t.dataset.delev}`);
        upsert(match); renderList(); renderLive(); renderEvents();
        toast('Event removed');
      } catch (err) { toast(err.message, true); }
    }
  });
  $('#logout').addEventListener('click', logout);

  // Pick up automatic kick-offs / half time / full time without touching forms being typed in.
  setInterval(async () => {
    if (document.hidden || state.view !== 'matches' || !state.user || state.sel === 'new') return;
    try {
      const before = current()?.status;
      const { matches } = await api('GET', 'matches');
      state.matches = matches;
      renderList();
      const now = current();
      if (now && now.status !== before) { renderLive(); toast(`${now.home.name} v ${now.away.name}: ${STATUS_TEXT[now.status] || now.status}`); }
    } catch { /* offline; next tick */ }
  }, 20000);

  setInterval(() => {
    for (const el of document.querySelectorAll('[data-clock]')) {
      const m = state.matches.find((x) => x.id === el.dataset.clock);
      if (m) el.textContent = shortStatus(m);
    }
  }, 1000);

  // ---------- admin accounts (owner only) ----------
  async function renderUsers() {
    const app = $('#app');
    app.innerHTML = `<div class="page"><div class="sect"><div class="none">Loading…</div></div></div>`;
    let users;
    try { ({ users } = await api('GET', 'users')); } catch (err) { toast(err.message, true); return; }
    app.innerHTML = `
      <div class="page">
        <section class="sect">
          <div class="sect-h"><span>Admin accounts</span><span>${users.length}</span></div>
          <div class="ulist">${users.map((u) => `
            <div class="urow">
              <div class="av">${esc((u.name || u.username).slice(0, 1).toUpperCase())}</div>
              <div class="ui"><b>${esc(u.name || u.username)}</b>${u.id === state.user.id ? ' <span class="you">you</span>' : ''}
                <small>@${esc(u.username)} · last sign-in ${esc(ago(u.last_login))}</small></div>
              <select data-role="${u.id}" ${u.id === state.user.id ? 'disabled' : ''}>
                <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Editor</option>
                <option value="owner" ${u.role === 'owner' ? 'selected' : ''}>Owner</option>
              </select>
              <button class="btn sm ghost" data-resetpw="${u.id}" data-uname="${esc(u.username)}">Reset password</button>
              ${u.id === state.user.id ? '<span></span>' : `<button class="btn sm danger" data-deluser="${u.id}" data-uname="${esc(u.username)}">Remove</button>`}
            </div>`).join('')}
          </div>
          <div class="hint" style="padding:12px 16px 16px">Owners can add and remove admins. Editors can only manage matches.</div>
        </section>
        <section class="sect">
          <div class="sect-h"><span>Add an admin</span></div>
          <form class="sect-b" id="userForm">
            <div class="grid">
              <label class="f"><span>Username</span><input name="username" required minlength="3" maxlength="40" autocomplete="off" pattern="[A-Za-z0-9._\\-]+"></label>
              <label class="f"><span>Display name</span><input name="name" maxlength="60"></label>
              <label class="f"><span>Password (at least 8 characters)</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
              <label class="f"><span>Role</span><select name="role"><option value="editor">Editor: matches only</option><option value="owner">Owner: matches and admins</option></select></label>
            </div>
            <div class="actions"><span class="hint">Share the username and password with the person yourself; they can change the password after signing in.</span><button class="btn" type="submit">Add admin</button></div>
          </form>
        </section>
      </div>`;
    $('#userForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api('POST', 'users', { username: f.username.value, name: f.name.value, password: f.password.value, role: f.role.value });
        toast(`Added ${f.username.value}`);
        renderUsers();
      } catch (err) { toast(err.message, true); }
    });
    app.querySelectorAll('[data-role]').forEach((sel) => sel.addEventListener('change', async () => {
      try { await api('PUT', `users/${sel.dataset.role}`, { role: sel.value }); toast('Role updated'); } catch (err) { toast(err.message, true); renderUsers(); }
    }));
  }

  async function renderActivity() {
    const app = $('#app');
    app.innerHTML = `<div class="page"><div class="sect"><div class="none">Loading…</div></div></div>`;
    let activity;
    try { ({ activity } = await api('GET', 'activity')); } catch (err) { toast(err.message, true); return; }
    app.innerHTML = `
      <div class="page"><section class="sect">
        <div class="sect-h"><span>Recent activity</span><span>last ${activity.length}</span></div>
        ${activity.length ? activity.map((a) => `
          <div class="arow"><span class="at">${esc(new Date(a.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }))}</span>
            <b>@${esc(a.username)}</b><span>${esc(a.summary)}</span></div>`).join('') : '<div class="none">Nothing yet.</div>'}
      </section></div>`;
  }

  function renderAccount() {
    const u = state.user;
    $('#app').innerHTML = `
      <div class="page"><section class="sect">
        <div class="sect-h"><span>My account</span><span>${esc(u.role)}</span></div>
        <div class="sect-b"><div class="hint" style="margin:0 0 14px">Signed in as <b>@${esc(u.username)}</b>${u.name ? ` (${esc(u.name)})` : ''}.</div>
        <form id="pwForm"><div class="grid">
          <label class="f full"><span>Current password</span><input type="password" name="current" required autocomplete="current-password"></label>
          <label class="f"><span>New password (at least 8 characters)</span><input type="password" name="next" required minlength="8" autocomplete="new-password"></label>
          <label class="f"><span>Repeat new password</span><input type="password" name="again" required minlength="8" autocomplete="new-password"></label>
        </div>
        <div class="actions"><span class="hint">Changing your password signs you out on other devices.</span><button class="btn" type="submit">Change password</button></div>
        </form></div>
      </section></div>`;
    $('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.next.value !== f.again.value) return toast('The new passwords do not match', true);
      try {
        const { token, user } = await api('POST', 'me/password', { current: f.current.value, next: f.next.value });
        setToken(token);
        state.user = user;
        f.reset();
        toast('Password changed');
      } catch (err) { toast(err.message, true); }
    });
  }

  function renderNav() {
    const owner = state.user?.role === 'owner';
    const items = [['matches', 'Matches'], owner && ['users', 'Admins'], ['activity', 'Activity'], ['account', 'My account']].filter(Boolean);
    const nav = $('#adminNav');
    nav.hidden = false;
    nav.innerHTML = items.map(([k, l]) => `<a href="#${k}" class="${state.view === k ? 'on' : ''}" data-view="${k}">${l}</a>`).join('');
    $('#whoami').textContent = state.user ? `@${state.user.username}` : '';
  }

  async function show(view) {
    if (view === 'users' && state.user?.role !== 'owner') view = 'matches';
    state.view = view;
    renderNav();
    if (view === 'users') return renderUsers();
    if (view === 'activity') return renderActivity();
    if (view === 'account') return renderAccount();
    const { matches } = await api('GET', 'matches');
    state.matches = matches;
    if (!matches.some((m) => LIVE.has(m.status))) state.filter = matches.some((m) => ['NS', 'PST'].includes(m.status)) ? 'upcoming' : 'all';
    $('#app').innerHTML = `<div class="adm"><aside class="sect list-panel" id="listPanel"></aside><div id="editor"></div></div>`;
    renderList();
    renderEditor();
  }

  // ---------- boot ----------
  async function boot() {
    if (!state.user) ({ user: state.user } = await api('GET', 'me'));
    $('#topActions').hidden = false;
    const v = location.hash.slice(1);
    await show(['matches', 'users', 'activity', 'account'].includes(v) ? v : 'matches');
  }

  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (state.user && v && v !== state.view) show(v);
  });

  document.querySelectorAll('[data-brand]').forEach((el) => { el.textContent = SITE.name; });
  document.title = `Admin | ${SITE.name}`;
  if (state.token) boot().catch(() => renderLogin()); else renderLogin();
})();
