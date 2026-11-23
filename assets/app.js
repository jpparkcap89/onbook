/* 한 책 읽기 포털 — 화면과 라우팅
   해시: #home · #author · #admin · #gabi · #gabi-3 · #gabi-wall */
(() => {
  'use strict';
  const CFG = window.ONEBOOK_CONFIG || {};
  const API = (CFG.apiUrl || '').trim();
  const MAXLEN = 2000;
  const $ = s => document.querySelector(s);
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem('onebook.' + k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('onebook.' + k, JSON.stringify(v)); } catch (e) {} },
    sget(k) { try { return sessionStorage.getItem('onebook.' + k) || ''; } catch (e) { return ''; } },
    sset(k, v) { try { v ? sessionStorage.setItem('onebook.' + k, v) : sessionStorage.removeItem('onebook.' + k); } catch (e) {} }
  };

  let DATA = null;
  const overrides = {};

  /* ---------- API ---------- */
  async function apiGet(action, params = {}) {
    if (!API) throw new Error('NO_API');
    const q = new URLSearchParams({ action, ...params });
    const r = await fetch(API + '?' + q.toString());
    return r.json();
  }
  async function apiPost(action, body = {}) {
    if (!API) throw new Error('NO_API');
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...body }) });
    return r.json();
  }
  const apiMsg = e => e && e.message === 'NO_API' ? '아직 제출 서버가 연결되지 않았습니다. 선생님께 알려 주세요.' : '서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';

  /* ---------- 데이터 ---------- */
  const book = id => DATA.books.find(b => b.id === id);
  function lessonOf(b, n) {
    const base = b.lessons[n - 1];
    const o = (overrides[b.id] || {})[n];
    return o ? { ...base, ...o } : base;
  }
  async function loadOverrides(b) {
    if (!API || overrides[b.id]) return;
    overrides[b.id] = {};
    try {
      const r = await apiGet('lessons', { bookId: b.id });
      if (r && r.ok && r.lessons) {
        r.lessons.forEach(o => { overrides[b.id][o.lesson] = o.fields; });
        if (Object.keys(overrides[b.id]).length) route(true);
      }
    } catch (e) { /* 덮어쓰기는 선택 기능 */ }
  }

  /* ---------- 공통 조각 ---------- */
  function nav(cur) {
    const items = [['home', '홈'], ...DATA.books.map(b => [b.id, b.grade]), ['author', '작가 소개']];
    $('#nav').innerHTML = items.map(([h, t]) => `<a href="#${h}" class="${cur === h ? 'on' : ''}"${cur === h ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  }
  const badges = types => `<span class="badges">${types.map(t => `<span class="bd ${t}">${DATA.types[t].icon} ${DATA.types[t].label}</span>`).join('')}</span>`;
  const rangeText = l => l.range + (l.pages ? ` (${l.pages}쪽)` : '');

  /* ---------- 활동지 ---------- */
  function item(it, i) {
    const h = `<div class="q">${i + 1}. ${esc(it.q)}</div>`;
    switch (it.k) {
      case 'q': return `<div class="it">${h}<div class="lines">${'<div></div>'.repeat(it.lines || 2)}</div></div>`;
      case 'draw': return `<div class="it">${h}<div class="draw" style="height:${it.h || 190}px"></div></div>`;
      case 'ck': return `<div class="it">${h}<div class="ck">${it.opts.map(o => `<span>${esc(o)}</span>`).join('')}</div></div>`;
      case 'ox': return `<div class="it ox">${h}<ol>${it.items.map(o => `<li><span>${esc(o)}</span><span class="oxb">( O · X )</span></li>`).join('')}</ol></div>`;
      case 'scale': return `<div class="it">${h}<div class="scale"><span>${esc(it.left)}</span><span class="bar">${'<i></i>'.repeat(5)}</span><span>${esc(it.right)}</span></div></div>`;
      case 'bingo': { const n = it.size || 3; return `<div class="it">${h}<div class="bingo" style="grid-template-columns:repeat(${n},1fr)">${'<div></div>'.repeat(n * n)}</div></div>`; }
      case 'how': return `<div class="it"><div class="q">✂️ ${esc(it.q)}</div><ol class="how">${it.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>`;
      case 'tbl': {
        const cols = it.cols, rl = it.rowLabels || [];
        const rows = Array.from({ length: it.rows || 1 }, (_, r) => `<tr>${cols.map((c, j) => j === 0 && rl[r] ? `<th>${esc(rl[r])}</th>` : '<td></td>').join('')}</tr>`).join('');
        return `<div class="it">${h}<table><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${rows}</table></div>`;
      }
    }
    return '';
  }
  function numbered(items) { let k = 0; return items.map(it => it.k === 'how' ? item(it, 0) : item(it, k++)).join(''); }
  function sheet(b, l) {
    return `<div class="sheet"><div class="top"><div><div class="sub">《${esc(b.title)}》 · ${l.n}차시 · ${esc(rangeText(l))}</div><div class="tt">${esc(l.title)}</div></div>
      <div class="who"><span>학년</span><span>반</span><span>번</span><span>이름</span></div></div>
      <div class="goal">🎯 학습 목표: ${esc(l.goal)}</div>${numbered(l.sheet)}<div class="foot">한 책 읽기 · 박선영 작가 함께 읽기</div></div>`;
  }
  function sheetText(b, l) {
    let k = 0;
    const lines = l.sheet.map(it => {
      if (it.k === 'how') return `[${it.q}]\n` + it.steps.map((s, i) => `   ${i + 1}) ${s}`).join('\n');
      const head = `${++k}. ${it.q}`;
      if (it.k === 'ck') return head + `\n   ${it.opts.join(' / ')}`;
      if (it.k === 'ox') return head + '\n' + it.items.map(o => `   - ${o} ( O · X )`).join('\n');
      if (it.k === 'scale') return head + `\n   ${it.left} ←───────→ ${it.right}`;
      if (it.k === 'tbl') return head + `\n   [표: ${it.cols.filter(Boolean).join(' | ')}]`;
      return head;
    });
    return `《${b.title}》 ${l.n}차시 - ${l.title} (${rangeText(l)})\n학년 반 번 이름:\n학습 목표: ${l.goal}\n\n` + lines.join('\n\n');
  }
  function doPrint(html, msgSel) {
    $('#printArea').innerHTML = html;
    try { window.print(); } catch (e) {}
    const m = $(msgSel);
    if (m) m.textContent = '인쇄 창이 열리지 않으면 이 페이지를 새 창에서 열어 주세요.';
  }

  /* ---------- 그림 ---------- */
  function shelfSVG() {
    const c = [['#ffcf70', '#f2b441'], ['#7fd8c9', '#4fbfac'], ['#ff9fb5', '#f07d98']];
    return `<svg viewBox="0 0 420 320" role="img" aria-label="책꽂이에 꽂힌 세 권의 책">
    <defs><linearGradient id="sh" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#e8eefc"/></linearGradient></defs>
    <ellipse cx="210" cy="292" rx="180" ry="16" fill="#3b63f6" opacity=".08"/>
    <rect x="30" y="262" width="360" height="22" rx="11" fill="url(#sh)" stroke="#dbe3fb"/>
    ${c.map(([a, d], i) => { const x = 70 + i * 100, h = 180 + i * 14, y = 262 - h; return `<g class="float" style="animation-delay:${i * -2}s">
      <rect x="${x}" y="${y}" width="82" height="${h}" rx="10" fill="${a}"/><rect x="${x}" y="${y}" width="16" height="${h}" rx="8" fill="${d}"/>
      <rect x="${x + 26}" y="${y + 24}" width="42" height="6" rx="3" fill="#fff" opacity=".85"/><rect x="${x + 26}" y="${y + 36}" width="30" height="6" rx="3" fill="#fff" opacity=".6"/>
      <circle cx="${x + 48}" cy="${y + h - 46}" r="18" fill="#fff" opacity=".55"/></g>`; }).join('')}
    <path d="M352 60c10 0 16 8 16 16 0-8 6-16 16-16-10 0-16-8-16-16 0 8-6 16-16 16z" fill="#3b63f6" opacity=".55"/>
    <path d="M40 90c7 0 11 5 11 11 0-6 4-11 11-11-7 0-11-5-11-11 0 6-4 11-11 11z" fill="#f59e0b" opacity=".6"/></svg>`;
  }

  /* ---------- 홈 ---------- */
  function home() {
    nav('home');
    const total = DATA.books.reduce((s, b) => s + b.lessons.length, 0);
    $('#app').innerHTML = `<section>
    <div class="hero"><div>
      <span class="pill">✨ 박선영 작가 한 책 읽기</span>
      <h1>책 한 권을 깊이 읽고<br><span class="grad">함께 생각을 키워요</span></h1>
      <p class="lead">학년군별로 고른 <strong>박선영 작가의 동화 세 권</strong>을 읽기 전·중·후 <strong>10차시 활동</strong>으로 나누었습니다. 책을 고르면 차시별 수업 흐름과 <strong>인쇄용 활동지</strong>를 바로 볼 수 있고, 학생은 감상과 질문을 <strong>온라인으로 제출</strong>합니다.</p>
      <div class="stats"><div class="stat"><b>${DATA.books.length}권</b><span>학년군별 도서</span></div><div class="stat"><b>${total}차시</b><span>학생 활동</span></div><div class="stat"><b>${total}장</b><span>활동지</span></div></div>
    </div><div class="shelf">${shelfSVG()}</div></div>

    <div class="sec-h"><div class="eb">Books</div><h2>📚 우리 학년 책 고르기</h2></div>
    <div class="books">${DATA.books.map(b => `<a class="book glass" href="#${b.id}">
      <div class="cov" style="background:${b.color}"><span class="em" aria-hidden="true">${b.emoji}</span><span class="gr">${b.grade}</span></div>
      <h3>${esc(b.title)}</h3><div class="meta">${esc(b.info)}</div><p>${esc(b.theme)}</p>
      <span class="btn sec" style="align-self:flex-start">10차시 활동 보기 →</span></a>`).join('')}</div>

    <div class="sec-h"><div class="eb">How it works</div><h2>🧭 이렇게 활용해요</h2></div>
    <div class="feats">
      <div class="tile feat"><div class="ic">📝</div><h3>차시별 수업 흐름</h3><p>40분 수업을 <strong>활동 순서와 시간</strong>까지 나누어 두었습니다.</p></div>
      <div class="tile feat"><div class="ic">🖨️</div><h3>A4 활동지</h3><p>차시마다 <strong>바로 인쇄하는 활동지</strong>가 있고, 10장을 한 번에 뽑을 수 있습니다.</p></div>
      <div class="tile feat"><div class="ic">💬</div><h3>우리 반 게시판</h3><p>학생 감상·질문·작품은 <strong>선생님이 확인한 뒤</strong> 게시판에 공개됩니다.</p></div>
    </div>

    <div class="glass author-cta" style="margin-top:30px"><div><div class="eb">Author</div><h2>✍️ 박선영 작가를 만나요</h2><p class="meta" style="margin:0">세 권의 작가의 말에 담긴 메시지와, 작가님께 묻고 싶은 질문을 모읍니다.</p></div>
      <a class="btn" href="#author">작가 소개 보기 →</a></div>
    </section>`;
  }

  /* ---------- 작가 ---------- */
  function authorView() {
    nav('author');
    const a = DATA.author;
    $('#app').innerHTML = `<section><div class="glass">
      <span class="pill">✍️ 작가 소개</span>
      <h1 style="font-size:clamp(26px,3.6vw,38px)">${esc(a.name)} 작가</h1>
      <p class="lead" style="margin:0">${esc(a.intro)}</p>
      <p class="note">자세한 약력과 사진은 작가님께 확인한 뒤 싣습니다.</p>

      <div class="sec-h"><div class="eb">Messages</div><h2>💌 작가가 아이들에게 전하는 말</h2></div>
      <div class="msgs">${a.messages.map(m => { const b = book(m.bookId); return `<div class="tile"><div class="meta">${b.emoji} 《${esc(b.title)}》 작가의 말</div><h3>「${esc(m.title)}」</h3><p>${esc(m.text)}</p></div>`; }).join('')}</div>

      <div class="sec-h"><div class="eb">Books</div><h2>📚 작품</h2></div>
      <div class="fgrid">${DATA.books.map(b => `<a class="tile" href="#${b.id}" style="text-decoration:none;color:var(--ink)"><b>${b.emoji} ${esc(b.title)}</b> <span class="meta">· ${esc(b.info)}${b.award ? ' · ' + esc(b.award) : ''}</span></a>`).join('')}</div>

      <div class="sec-h"><div class="eb">Questions</div><h2>🙋 작가님께 묻고 싶은 질문</h2>
        <p class="meta" style="margin:0">모은 질문은 작가와의 만남 행사 때 활용합니다. 선생님이 확인한 뒤 공개됩니다.</p></div>
      ${submitForm('author', 0, ['질문'])}
    </div></section>`;
    bindSubmit('author', 0);
  }

  /* ---------- 책 ---------- */
  function bookView(b) {
    nav(b.id); loadOverrides(b);
    const P = DATA.phases;
    $('#app').innerHTML = `<section><div class="glass">
     <div class="bhead"><div><span class="pill">${b.emoji} ${b.grade}</span><h1 style="font-size:clamp(26px,3.6vw,38px)">${esc(b.title)}</h1>
      <div class="meta">${esc(b.info)}${b.award ? ' · ' + esc(b.award) : ''}</div><p class="lead" style="margin:10px 0 0">${esc(b.summary)}</p>
      <ul class="chips" aria-label="목차">${b.chapters.map(c => `<li>${c.no ? c.no + '. ' : ''}${esc(c.title)}${c.page ? ` <small>${c.page}쪽</small>` : ''}</li>`).join('')}</ul></div>
      <div class="bact"><button class="btn" id="printAll">🖨️ 활동지 10장 한번에 인쇄</button><a class="btn sec" href="#${b.id}-wall">💬 우리 반 게시판</a></div></div>
     ${Object.keys(P).map(pk => { const ls = b.lessons.filter(l => l.phase === pk); return `<div class="phase"><h3>${P[pk].icon} ${P[pk].label}</h3><div class="lessons">
       ${ls.map(l0 => { const l = lessonOf(b, l0.n); return `<a class="ls" href="#${b.id}-${l.n}"><span class="n">${l.n}차시 · ${esc(rangeText(l))}</span><b>${esc(l.title)}</b><span class="g">${esc(l.goal)}</span>${badges(l.types)}</a>`; }).join('')}</div></div>`; }).join('')}
     <p class="note" id="pmsg">차시별 활동은 책 본문을 바탕으로 만든 수업 계획입니다. 학급 상황에 맞게 다듬어 사용해 주세요.</p>
    </div></section>`;
    $('#printAll').onclick = () => doPrint(b.lessons.map(l => sheet(b, lessonOf(b, l.n))).join(''), '#pmsg');
  }

  /* ---------- 차시 ---------- */
  function lessonView(b, n) {
    nav(b.id); loadOverrides(b);
    const l = lessonOf(b, n), ph = DATA.phases[l.phase], last = b.lessons.length;
    const steps = (l.steps || []).map(s => typeof s === 'string' ? { text: s } : s);
    $('#app').innerHTML = `<section>
    <a href="#${b.id}" class="btn sec" style="margin-bottom:16px">← ${esc(b.title)}</a>
    <div class="lgrid"><div>
     <div class="glass">
      <span class="pill">${ph.icon} ${ph.label} · ${n}차시</span>
      <h1 style="font-size:clamp(24px,3vw,32px)">${esc(l.title)}</h1>
      <div class="meta">${esc(b.title)} · ${esc(rangeText(l))} · 40분</div>
      ${badges(l.types)}
      <div class="box"><b>🎯 학습 목표</b><br>${esc(l.goal)}</div>
      <div class="box"><b>🧭 활동 흐름</b><ol class="steps">${steps.map(s => `<li><span>${esc(s.text)}</span><span class="min">${s.min ? s.min + '분' : ''}</span></li>`).join('')}</ol></div>
      ${l.materials && l.materials.length ? `<div class="box"><b>🧺 준비물</b><br>${l.materials.map(esc).join(' · ')}</div>` : ''}
      ${l.teacherNote ? `<div class="box tnote"><b>👩‍🏫 선생님께</b><br>${esc(l.teacherNote)}</div>` : ''}
      <div class="pager">${n > 1 ? `<a class="btn sec" href="#${b.id}-${n - 1}">← ${n - 1}차시</a>` : '<span></span>'}${n < last ? `<a class="btn" href="#${b.id}-${n + 1}">${n + 1}차시 →</a>` : `<a class="btn" href="#${b.id}-wall">게시판 보기 →</a>`}</div>
     </div>
     <div class="glass submit"><div class="eb">Submit</div><h2>📮 온라인 제출</h2>
      <p class="meta" style="margin:0 0 12px">감상·질문·작품 설명을 보내면 선생님이 확인한 뒤 <a href="#${b.id}-wall">우리 반 게시판</a>에 공개됩니다.</p>
      ${submitForm(b.id, n, ['감상', '질문', '작품', '활동지'])}</div>
    </div><div>
      <div class="tools"><button class="btn" id="pr">🖨️ 인쇄 / PDF 저장</button><button class="btn sec" id="cp">📋 문항 텍스트 복사</button></div>
      <p class="note" id="msg" aria-live="polite"></p>
      ${sheet(b, l)}
    </div></div></section>`;
    $('#pr').onclick = () => doPrint(sheet(b, l), '#msg');
    $('#cp').onclick = async () => {
      try { await navigator.clipboard.writeText(sheetText(b, l)); $('#msg').textContent = '복사했습니다. 구글 문서나 클래스룸 과제에 붙여 넣으세요.'; }
      catch (e) { $('#msg').textContent = '복사가 막혀 있습니다. 활동지 문항을 직접 선택해 복사해 주세요.'; }
    };
    bindSubmit(b.id, n);
  }

  /* ---------- 제출 폼 ---------- */
  function submitForm(bookId, lesson, types) {
    const me = store.get('student', {});
    const opt = (n, v) => Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${+v === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('');
    return `<form class="fgrid" id="sf" novalidate>
      <div class="frow">
        <div><label for="sg">학년</label><select id="sg" required><option value="">선택</option>${opt(6, me.grade)}</select></div>
        <div><label for="sc">반</label><select id="sc" required><option value="">선택</option>${opt(15, me.classNo)}</select></div>
        <div><label for="sn">번호</label><input id="sn" type="number" inputmode="numeric" min="1" max="40" value="${esc(me.studentNo || '')}" required></div>
        <div><label for="sk">반 코드</label><input id="sk" autocomplete="off" value="${esc(me.classCode || '')}" required></div>
      </div>
      <div class="frow" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
        <div><label for="snick">공개 이름 (선택)</label><input id="snick" maxlength="12" placeholder="비우면 ‘3반 12번’처럼 보여요" value="${esc(me.nickname || '')}"></div>
        <div><label for="st">종류</label><select id="st">${types.map(t => `<option>${t}</option>`).join('')}</select></div>
      </div>
      <div><label for="sbody">내용</label><textarea id="sbody" maxlength="${MAXLEN}" required placeholder="실명은 쓰지 말아 주세요."></textarea>
        <div class="hint"><span id="scount">0</span> / ${MAXLEN}자 · 실명은 받지 않습니다.</div></div>
      <div><button class="btn" type="submit" id="sbtn">보내기</button><div class="msg" id="smsg" role="status" aria-live="polite"></div></div>
    </form>`;
  }
  function bindSubmit(bookId, lesson) {
    const f = $('#sf'); if (!f) return;
    const body = $('#sbody'), cnt = $('#scount'), msg = $('#smsg'), btn = $('#sbtn');
    body.addEventListener('input', () => { cnt.textContent = body.value.length; });
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const d = { bookId, lesson, grade: $('#sg').value, classNo: $('#sc').value, studentNo: $('#sn').value.trim(), classCode: $('#sk').value.trim(), nickname: $('#snick').value.trim(), type: $('#st').value, content: body.value.trim() };
      const say = (t, ok) => { msg.textContent = t; msg.className = 'msg ' + (ok ? 'ok' : 'err'); };
      if (!d.grade || !d.classNo || !d.studentNo) return say('학년, 반, 번호를 모두 넣어 주세요.');
      if (!d.classCode) return say('선생님께 받은 반 코드를 넣어 주세요.');
      if (!d.content) return say('내용을 써 주세요.');
      store.set('student', { grade: d.grade, classNo: d.classNo, studentNo: d.studentNo, classCode: d.classCode, nickname: d.nickname });
      btn.disabled = true; say('보내는 중…', true);
      try {
        const r = await apiPost('submit', d);
        if (r && r.ok) { body.value = ''; cnt.textContent = '0'; say('잘 받았습니다! 선생님이 확인하면 게시판에 공개됩니다.', true); }
        else say((r && r.error) || '제출하지 못했습니다.');
      } catch (e) { say(apiMsg(e)); }
      btn.disabled = false;
    });
  }

  /* ---------- 게시판 ---------- */
  function wallView(b) {
    nav(b.id);
    const me = store.get('student', {});
    const opt = (n, v, all) => `<option value="">${all}</option>` + Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${+v === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('');
    $('#app').innerHTML = `<section>
    <a href="#${b.id}" class="btn sec" style="margin-bottom:16px">← ${esc(b.title)}</a>
    <div class="glass"><span class="pill">💬 우리 반 게시판</span>
      <h1 style="font-size:clamp(24px,3vw,32px)">${b.emoji} ${esc(b.title)}</h1>
      <p class="meta" style="margin:0">선생님이 확인한 감상·질문·작품만 보입니다.</p>
      <div class="filters">
        <div><label for="fg">학년</label><select id="fg">${opt(6, me.grade, '전체')}</select></div>
        <div><label for="fc">반</label><select id="fc">${opt(15, me.classNo, '전체')}</select></div>
        <div><label for="fl">차시</label><select id="fl">${opt(b.lessons.length, '', '전체')}</select></div>
        <div><button class="btn sm" id="fgo">보기</button></div>
      </div>
      <div id="posts" class="posts" aria-live="polite"></div>
    </div></section>`;
    const load = async () => {
      const box = $('#posts');
      box.innerHTML = '<div class="empty">불러오는 중…</div>';
      const p = { bookId: b.id };
      if ($('#fg').value) p.grade = $('#fg').value;
      if ($('#fc').value) p.classNo = $('#fc').value;
      if ($('#fl').value) p.lesson = $('#fl').value;
      try {
        const r = await apiGet('posts', p);
        const list = (r && r.ok && r.posts) || [];
        box.innerHTML = list.length ? list.map(x => postCard(b, x)).join('') : '<div class="empty">아직 공개된 글이 없습니다.</div>';
      } catch (e) { box.innerHTML = `<div class="empty">${esc(apiMsg(e))}</div>`; }
    };
    $('#fgo').onclick = load; load();
  }
  function postCard(b, x) {
    const l = x.lesson ? lessonOf(b, +x.lesson) : null;
    return `<div class="tile post"><div class="who"><b>${esc(x.nickname)}</b><span>${esc(x.type)}${l ? ` · ${l.n}차시 ${esc(l.title)}` : ''}</span></div>
      <div class="body">${esc(x.content)}</div>${x.teacherComment ? `<div class="cmt">👩‍🏫 ${esc(x.teacherComment)}</div>` : ''}
      <div class="meta">${esc(String(x.createdAt || '').slice(0, 10))}</div></div>`;
  }

  /* ---------- 교사 관리 ---------- */
  let adminRows = [];
  function adminView() {
    nav('');
    const code = store.sget('admin');
    $('#app').innerHTML = `<section><div class="glass">
      <span class="pill">🔐 교사 관리</span><h1 style="font-size:clamp(24px,3vw,32px)">제출물 확인·공개</h1>
      <form class="filters" id="af">
        <div style="min-width:200px"><label for="acode">교사 관리 코드</label><input id="acode" type="password" autocomplete="off" value="${esc(code)}"></div>
        <div><label for="ab">책</label><select id="ab"><option value="">전체</option>${DATA.books.map(b => `<option value="${b.id}">${esc(b.title)}</option>`).join('')}<option value="author">작가 질문</option></select></div>
        <div><label for="as">상태</label><select id="as"><option value="">전체</option><option selected>대기</option><option>공개</option><option>숨김</option></select></div>
        <div><button class="btn sm" type="submit">불러오기</button></div>
        <div><button class="btn sm sec" type="button" id="acsv">CSV 내보내기</button></div>
        <div><button class="btn sm sec" type="button" id="aout">나가기</button></div>
      </form>
      <div class="msg" id="amsg" role="status" aria-live="polite"></div>
      <div id="alist" class="fgrid"></div>
    </div></section>`;
    $('#af').onsubmit = ev => { ev.preventDefault(); adminLoad(); };
    $('#aout').onclick = () => { store.sset('admin', ''); $('#acode').value = ''; $('#alist').innerHTML = ''; $('#amsg').textContent = ''; };
    $('#acsv').onclick = exportCSV;
    if (code) adminLoad();
  }
  async function adminLoad() {
    const code = $('#acode').value.trim(), msg = $('#amsg');
    if (!code) { msg.textContent = '관리 코드를 넣어 주세요.'; msg.className = 'msg err'; return; }
    msg.textContent = '불러오는 중…'; msg.className = 'msg';
    try {
      const r = await apiPost('admin.list', { adminCode: code, filters: { bookId: $('#ab').value, status: $('#as').value } });
      if (!r || !r.ok) { msg.textContent = (r && r.error) || '불러오지 못했습니다.'; msg.className = 'msg err'; return; }
      store.sset('admin', code);
      adminRows = r.rows || [];
      msg.textContent = `${adminRows.length}건`; msg.className = 'msg ok';
      $('#alist').innerHTML = adminRows.length ? adminRows.map(adminRow).join('') : '<div class="empty">해당하는 제출물이 없습니다.</div>';
      $('#alist').querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', adminAct));
    } catch (e) { msg.textContent = apiMsg(e); msg.className = 'msg err'; }
  }
  function adminRow(x) {
    const b = book(x.bookId), title = b ? b.title : '작가 질문';
    return `<div class="tile arow" data-id="${esc(x.id)}"><div>
      <div class="meta"><span class="st ${esc(x.status)}">${esc(x.status)}</span> ${esc(title)}${+x.lesson ? ` · ${esc(x.lesson)}차시` : ''} · ${esc(x.type)} · ${esc(x.grade)}학년 ${esc(x.classNo)}반 ${esc(x.studentNo)}번 (${esc(x.nickname)}) · ${esc(String(x.createdAt).slice(0, 16).replace('T', ' '))}</div>
      <div class="body" style="white-space:pre-wrap;margin-top:6px">${esc(x.content)}</div></div>
      <div><label for="c-${esc(x.id)}">교사 댓글</label><textarea id="c-${esc(x.id)}" maxlength="500">${esc(x.teacherComment || '')}</textarea>
      <div class="abtns"><button class="btn sm" data-act="공개">공개</button><button class="btn sm warn" data-act="숨김">숨김</button><button class="btn sm sec" data-act="대기">대기로</button></div></div></div>`;
  }
  async function adminAct(ev) {
    const btn = ev.currentTarget, row = btn.closest('[data-id]'), id = row.dataset.id;
    const comment = row.querySelector('textarea').value.trim();
    btn.disabled = true;
    try {
      const r = await apiPost('admin.update', { adminCode: store.sget('admin'), id, status: btn.dataset.act, teacherComment: comment });
      if (r && r.ok) {
        const x = adminRows.find(o => o.id === id); if (x) { x.status = btn.dataset.act; x.teacherComment = comment; }
        const st = row.querySelector('.st'); st.textContent = btn.dataset.act; st.className = 'st ' + btn.dataset.act;
      } else { $('#amsg').textContent = (r && r.error) || '저장하지 못했습니다.'; $('#amsg').className = 'msg err'; }
    } catch (e) { $('#amsg').textContent = apiMsg(e); $('#amsg').className = 'msg err'; }
    btn.disabled = false;
  }
  function exportCSV() {
    if (!adminRows.length) { $('#amsg').textContent = '먼저 제출물을 불러와 주세요.'; return; }
    const cols = ['id', 'createdAt', 'bookId', 'lesson', 'grade', 'classNo', 'studentNo', 'nickname', 'type', 'content', 'status', 'teacherComment'];
    const cell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const csv = '﻿' + [cols.join(','), ...adminRows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `onebook_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- 라우팅 ---------- */
  function route(keepScroll) {
    const h = decodeURIComponent(location.hash.slice(1)), [id, sub] = h.split('-'), b = DATA.books.find(x => x.id === id);
    if (h === 'author') authorView();
    else if (h === 'admin') adminView();
    else if (b && sub === 'wall') wallView(b);
    else if (b && sub && +sub >= 1 && +sub <= b.lessons.length) lessonView(b, +sub);
    else if (b) bookView(b);
    else home();
    if (keepScroll !== true) window.scrollTo(0, 0);
  }

  fetch('data/books.json', { cache: 'no-cache' })
    .then(r => r.json())
    .then(d => { DATA = d; addEventListener('hashchange', () => route()); route(); })
    .catch(() => { $('#app').innerHTML = '<section><div class="glass empty">활동 자료를 불러오지 못했습니다. 웹 주소(GitHub Pages)에서 열었는지 확인해 주세요.</div></section>'; });
})();
