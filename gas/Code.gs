/**
 * 한 책 읽기 포털 — Apps Script 백엔드 (설계 문서 5장)
 *
 * GET  ?action=posts&bookId=&lesson=&grade=&classNo=   공개된 제출물
 * GET  ?action=lessons&bookId=                         시트 덮어쓰기 내용
 * GET  ?action=ping                                    연결 확인
 * POST {action:'submit', bookId, lesson, grade, classNo, studentNo, nickname, type, content, classCode}
 * POST {action:'admin.list', adminCode, filters:{bookId, status}}
 * POST {action:'admin.update', adminCode, id, status, teacherComment}
 *
 * POST 본문은 JSON 문자열을 Content-Type: text/plain 으로 보냅니다(CORS preflight 회피).
 * 관리 코드는 Script Properties(ADMIN_CODE)에 둡니다. 처음 한 번 setup()을 실행하세요.
 * 응답의 글은 이스케이프하지 않은 원문이며, 화면(assets/app.js)에서 HTML 이스케이프해 보여 줍니다.
 */

const SHEETS = {
  submissions: ['id', 'createdAt', 'bookId', 'lesson', 'grade', 'classNo', 'studentNo', 'nickname', 'type', 'content', 'imageUrl', 'status', 'teacherComment'],
  classes: ['grade', 'classNo', 'teacherName', 'teacherEmail', 'classCode'],
  settings: ['key', 'value', 'note'],
  lessons: ['bookId', 'lesson', 'title', 'goal', 'steps', 'materials', 'teacherNote']
};
const BOOK_IDS = ['gabi', 'dream', 'suii', 'author'];
const TYPES = ['감상', '질문', '작품', '활동지'];
const STATUSES = ['대기', '공개', '숨김'];
const LIMITS = { content: 2000, nickname: 12, comment: 500, gapSec: 30, posts: 200 };

/* ---------- 처음 한 번 실행 ---------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  Object.keys(SHEETS).forEach(name => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const head = SHEETS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#eef2ff');
    sh.setFrozenRows(1);
  });
  const st = ss.getSheetByName('settings');
  if (st.getLastRow() < 2) {
    st.getRange(2, 1, 2, 3).setValues([
      ['requireApproval', 'TRUE', 'TRUE: 교사 승인 후 공개(기본) / FALSE: 바로 공개'],
      ['adminCode', '(Script Properties에 저장)', '실제 값은 확장 프로그램 > Apps Script > 프로젝트 설정 > 스크립트 속성 ADMIN_CODE']
    ]);
  }
  const ls = ss.getSheetByName('lessons');
  if (!ls.getRange(1, 1).getNote()) ls.getRange(1, 1).setNote('고칠 칸만 채우세요. steps는 줄마다 한 단계, materials는 · 로 구분합니다.');
  const sub = ss.getSheetByName('submissions');
  sub.getRange('B:B').setNumberFormat('@'); // 제출 시각은 ISO 문자열로 보관
  const blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  if (!props.getProperty('ADMIN_CODE')) {
    const code = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    props.setProperty('ADMIN_CODE', code);
    Logger.log('교사 관리 코드: ' + code + '  (스크립트 속성 ADMIN_CODE에서 바꿀 수 있습니다)');
  } else {
    Logger.log('교사 관리 코드는 이미 있습니다. 스크립트 속성 ADMIN_CODE를 확인하세요.');
  }
}

/* ---------- 진입점 ---------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'posts') return json(getPosts(p));
    if (p.action === 'lessons') return json(getLessons(p));
    if (p.action === 'ping') return json({ ok: true, time: new Date().toISOString() });
    return json({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: '서버 오류가 났습니다.' });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json({ ok: false, error: '요청 형식이 올바르지 않습니다.' }); }
  try {
    if (body.action === 'submit') return json(submit(body));
    const admin = {
      'admin.list': adminList, 'admin.update': adminUpdate, 'admin.delete': adminDelete,
      'admin.reset': adminReset, 'admin.seed': adminSeed,
      'admin.classes': adminClasses, 'admin.classes.save': adminClassesSave
    }[body.action];
    if (admin) {
      const denied = checkAdmin(body.adminCode);
      return json(denied || admin(body));
    }
    return json({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: '서버 오류가 났습니다.' });
  }
}

/* ---------- 조회 ---------- */
function getPosts(p) {
  const bookId = String(p.bookId || '');
  if (BOOK_IDS.indexOf(bookId) < 0) return { ok: false, error: '책을 찾을 수 없습니다.' };
  const f = { lesson: intOr(p.lesson, 0), grade: intOr(p.grade, 0), classNo: intOr(p.classNo, 0) };
  const posts = readRows('submissions')
    .filter(r => r.status === '공개' && r.bookId === bookId &&
      (!f.lesson || +r.lesson === f.lesson) && (!f.grade || +r.grade === f.grade) && (!f.classNo || +r.classNo === f.classNo))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, LIMITS.posts)
    .map(r => ({
      id: r.id, createdAt: r.createdAt, lesson: +r.lesson, type: r.type, content: r.content,
      nickname: r.nickname || (r.classNo + '반 ' + r.studentNo + '번'),
      teacherComment: r.teacherComment || ''
    }));
  return { ok: true, posts };
}

function getLessons(p) {
  const bookId = String(p.bookId || '');
  if (BOOK_IDS.indexOf(bookId) < 0) return { ok: false, error: '책을 찾을 수 없습니다.' };
  const lessons = readRows('lessons').filter(r => r.bookId === bookId && +r.lesson >= 1).map(r => {
    const fields = {};
    if (r.title) fields.title = String(r.title);
    if (r.goal) fields.goal = String(r.goal);
    if (r.steps) fields.steps = String(r.steps).split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(text => ({ text }));
    if (r.materials) fields.materials = String(r.materials).split('·').map(s => s.trim()).filter(Boolean);
    if (r.teacherNote) fields.teacherNote = String(r.teacherNote);
    return { lesson: +r.lesson, fields };
  }).filter(o => Object.keys(o.fields).length);
  return { ok: true, lessons };
}

/* ---------- 제출 ---------- */
function submit(b) {
  const d = {
    bookId: String(b.bookId || ''),
    lesson: intOr(b.lesson, -1),
    grade: intOr(b.grade, 0),
    classNo: intOr(b.classNo, 0),
    studentNo: intOr(b.studentNo, 0),
    nickname: clean(b.nickname, LIMITS.nickname),
    type: String(b.type || ''),
    content: clean(b.content, LIMITS.content + 1),
    classCode: String(b.classCode || '').trim()
  };
  if (BOOK_IDS.indexOf(d.bookId) < 0) return { ok: false, error: '책을 찾을 수 없습니다.' };
  if (d.lesson < 0 || d.lesson > 10 || (d.bookId !== 'author' && d.lesson < 1)) return { ok: false, error: '차시가 올바르지 않습니다.' };
  if (d.grade < 1 || d.grade > 6 || d.classNo < 1 || d.classNo > 15 || d.studentNo < 1 || d.studentNo > 40) return { ok: false, error: '학년·반·번호를 확인해 주세요.' };
  if (TYPES.indexOf(d.type) < 0) return { ok: false, error: '종류를 골라 주세요.' };
  if (!d.content) return { ok: false, error: '내용을 써 주세요.' };
  if (d.content.length > LIMITS.content) return { ok: false, error: LIMITS.content + '자까지 쓸 수 있습니다.' };
  if (!checkClassCode(d.grade, d.classNo, d.classCode)) return { ok: false, error: '반 코드가 맞지 않습니다. 선생님께 확인해 주세요.' };

  const cache = CacheService.getScriptCache();
  const rlKey = 'rl:' + d.grade + '-' + d.classNo + '-' + d.studentNo;
  if (cache.get(rlKey)) return { ok: false, error: '조금 전에 보냈어요. ' + LIMITS.gapSec + '초 뒤에 다시 보내 주세요.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const id = Utilities.getUuid();
    const status = requireApproval() ? '대기' : '공개';
    const row = {
      id, createdAt: new Date().toISOString(), bookId: d.bookId, lesson: d.lesson, grade: d.grade, classNo: d.classNo, studentNo: d.studentNo,
      nickname: d.nickname, type: d.type, content: d.content, imageUrl: '', status, teacherComment: ''
    };
    sheet('submissions').appendRow(SHEETS.submissions.map(k => safeCell(row[k])));
    cache.put(rlKey, '1', LIMITS.gapSec);
    return { ok: true, id, status };
  } finally {
    lock.releaseLock();
  }
}

function checkClassCode(grade, classNo, code) {
  const rows = readRows('classes').filter(r => +r.grade === grade && +r.classNo === classNo);
  if (!rows.length) return false;
  return rows.some(r => String(r.classCode).trim() !== '' && String(r.classCode).trim() === code);
}

/* ---------- 교사 관리 ---------- */
function adminList(b) {
  const f = b.filters || {};
  const rows = readRows('submissions')
    .filter(r => (!f.bookId || r.bookId === f.bookId) && (!f.status || r.status === f.status))
    .sort((a, c) => String(c.createdAt).localeCompare(String(a.createdAt)))
    .map(r => { const o = {}; SHEETS.submissions.forEach(k => { o[k] = r[k]; }); return o; });
  return { ok: true, rows };
}

/** 상태 바꾸기. id 하나(댓글 함께 저장) 또는 ids 여러 개(상태만) */
function adminUpdate(b) {
  const status = String(b.status || '');
  if (STATUSES.indexOf(status) < 0) return { ok: false, error: '상태가 올바르지 않습니다.' };
  const many = Array.isArray(b.ids);
  const want = many ? b.ids.map(String) : [String(b.id || '')];
  return withLock(() => {
    const sh = sheet('submissions'), rows = rowIndexById(sh);
    const sCol = SHEETS.submissions.indexOf('status') + 1, cCol = SHEETS.submissions.indexOf('teacherComment') + 1;
    let n = 0;
    want.forEach(id => {
      const row = rows[id]; if (!row) return;
      sh.getRange(row, sCol).setValue(status);
      if (!many) sh.getRange(row, cCol).setValue(safeCell(clean(b.teacherComment, LIMITS.comment)));
      n++;
    });
    return n ? { ok: true, updated: n } : { ok: false, error: '제출물을 찾을 수 없습니다.' };
  });
}

/** 개별·선택 삭제: ids 배열 */
function adminDelete(b) {
  const want = (Array.isArray(b.ids) ? b.ids : [b.id]).map(String).filter(Boolean);
  if (!want.length) return { ok: false, error: '지울 제출물을 골라 주세요.' };
  return withLock(() => {
    const sh = sheet('submissions'), rows = rowIndexById(sh);
    const targets = want.map(id => rows[id]).filter(Boolean).sort((a, c) => c - a);
    targets.forEach(r => sh.deleteRow(r));
    return { ok: true, deleted: targets.length };
  });
}

/** 초기화: scope 'dummy'(더미만) 또는 'all'(제출물 전체, confirm:'초기화' 필요) */
function adminReset(b) {
  const scope = String(b.scope || '');
  if (scope === 'all' && b.confirm !== '초기화') return { ok: false, error: '확인 문구 ‘초기화’를 입력해 주세요.' };
  if (scope !== 'all' && scope !== 'dummy') return { ok: false, error: '초기화 범위가 올바르지 않습니다.' };
  return withLock(() => {
    const sh = sheet('submissions'), last = sh.getLastRow();
    if (last < 2) return { ok: true, deleted: 0 };
    if (scope === 'all') {
      sh.getRange(2, 1, last - 1, SHEETS.submissions.length).clearContent();
      return { ok: true, deleted: last - 1 };
    }
    const ids = sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0]));
    const targets = ids.map((id, i) => isDummy(id) ? i + 2 : 0).filter(Boolean).reverse();
    targets.forEach(r => sh.deleteRow(r));
    return { ok: true, deleted: targets.length };
  });
}

/** 더미 데이터 만들기: 책별 학년에 맞춰 감상·질문·작품을 섞어 만든다. id가 dummy- 로 시작 */
function adminSeed(b) {
  const count = Math.max(1, Math.min(200, intOr(b.count, 30)));
  const BOOK = {
    gabi: { grades: [1, 2], texts: ['달랑구처럼 내 마음을 들어 주는 친구가 있으면 좋겠어요.', '가비가 까비라고 불릴 때 속상했을 것 같아요.', '종이컵 집게로 인형뽑기 한 게 제일 재미있었어요.', '틀려도 괜찮다는 말이 마음에 들었어요.', '친구에게 벚꽃 카드를 주었더니 웃어 주었어요.', '달랑구는 왜 가비하고만 말을 할까요?'] },
    dream: { grades: [3, 4], texts: ['나도 물음표 공책을 만들어서 질문을 세 개 썼어요.', '주하가 엄마에게 솔직하게 말해서 다행이에요.', '좋아하는 것과 잘해야 하는 것이 다를 수 있다는 걸 알았어요.', '빠르기말 걸음 놀이에서 비바체가 제일 신났어요.', '편지가 어디 있는지 추리한 게 맞았어요!', '수연이는 왜 늘 공책에 생각을 적을까요?'] },
    suii: { grades: [5, 6], texts: ['비교하는 말을 응원하는 말로 바꾸니 듣는 사람 마음이 달라질 것 같아요.', '한수이가 포기하려다 다시 일어선 장면이 인상 깊었어요.', '세인이 시점으로 다시 써 보니 세인이 마음을 이해하게 됐어요.', '그멈땡 놀이를 운동장에서 해 보고 싶어요.', '나만의 서천꽃은 용기를 주는 노란 꽃이에요.', '한수이의 거짓말은 정말 괜찮은 걸까요?'] }
  };
  const TYPES_W = ['감상', '감상', '감상', '질문', '작품', '활동지'];
  const ST_W = ['공개', '공개', '공개', '대기', '대기', '숨김'];
  const COMMENTS = ['', '', '생각을 잘 정리했어요!', '좋은 질문이에요. 함께 이야기해 봐요.', '근거가 분명해서 좋아요.'];
  const NICKS = ['', '', '', '책벌레', '꿈나무', '별빛', '하늘'];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const ids = Object.keys(BOOK), now = Date.now(), rows = [];
  for (let i = 0; i < count; i++) {
    const bookId = ids[i % ids.length], bk = BOOK[bookId];
    const type = pick(TYPES_W), status = pick(ST_W);
    const o = {
      id: 'dummy-' + Utilities.getUuid().slice(0, 8),
      createdAt: new Date(now - Math.floor(Math.random() * 14 * 86400000)).toISOString(),
      bookId, lesson: 1 + Math.floor(Math.random() * 10), grade: pick(bk.grades), classNo: 1 + Math.floor(Math.random() * 3),
      studentNo: 1 + Math.floor(Math.random() * 25), nickname: pick(NICKS), type, content: '[더미] ' + pick(bk.texts),
      imageUrl: '', status, teacherComment: status === '공개' ? pick(COMMENTS) : ''
    };
    rows.push(SHEETS.submissions.map(k => safeCell(o[k])));
  }
  return withLock(() => {
    const sh = sheet('submissions');
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return { ok: true, created: rows.length };
  });
}

/** 반 목록 */
function adminClasses() {
  return { ok: true, rows: readRows('classes').filter(r => r.grade !== '' || r.classNo !== '') };
}

/** 반 목록 통째로 저장 */
function adminClassesSave(b) {
  if (!Array.isArray(b.rows)) return { ok: false, error: '반 목록이 올바르지 않습니다.' };
  const rows = [], seen = {};
  for (const r of b.rows) {
    const g = intOr(r.grade, 0), c = intOr(r.classNo, 0), code = clean(r.classCode, 30);
    if (g < 1 || g > 6 || c < 1 || c > 15) return { ok: false, error: '학년(1~6)과 반(1~15)을 확인해 주세요.' };
    if (!code) return { ok: false, error: g + '학년 ' + c + '반의 반 코드를 넣어 주세요.' };
    if (seen[g + '-' + c]) return { ok: false, error: g + '학년 ' + c + '반이 두 번 들어 있습니다.' };
    seen[g + '-' + c] = 1;
    rows.push([g, c, safeCell(clean(r.teacherName, 30)), safeCell(clean(r.teacherEmail, 80)), safeCell(code)]);
  }
  return withLock(() => {
    const sh = sheet('classes'), last = sh.getLastRow(), w = SHEETS.classes.length;
    if (last > 1) sh.getRange(2, 1, last - 1, w).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, w).setValues(rows);
    return { ok: true, saved: rows.length };
  });
}

function checkAdmin(code) {
  const cache = CacheService.getScriptCache();
  const fails = +(cache.get('adminFails') || 0);
  if (fails >= 10) return { ok: false, error: '잘못된 시도가 많아 잠시 막혔습니다. 10분 뒤에 다시 해 주세요.' };
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_CODE');
  if (!real) return { ok: false, error: '관리 코드가 설정되지 않았습니다. setup()을 먼저 실행해 주세요.' };
  if (String(code || '') !== real) {
    cache.put('adminFails', String(fails + 1), 600);
    return { ok: false, error: '관리 코드가 맞지 않습니다.' };
  }
  return null;
}

/* ---------- 도우미 ---------- */
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}
/** submissions 의 id → 행 번호 */
function rowIndexById(sh) {
  const last = sh.getLastRow(), map = {};
  if (last < 2) return map;
  sh.getRange(2, 1, last - 1, 1).getValues().forEach((r, i) => { if (r[0] !== '') map[String(r[0])] = i + 2; });
  return map;
}
function isDummy(id) { return String(id).indexOf('dummy-') === 0; }
function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('시트 탭이 없습니다: ' + name + ' — setup()을 실행하세요.');
  return sh;
}
function readRows(name) {
  const sh = sheet(name), last = sh.getLastRow();
  if (last < 2) return [];
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  return sh.getRange(2, 1, last - 1, head.length).getValues().map(v => {
    const o = {}; head.forEach((h, j) => { o[h] = v[j] instanceof Date ? v[j].toISOString() : v[j]; }); return o;
  });
}
function requireApproval() {
  const r = readRows('settings').find(x => x.key === 'requireApproval');
  return !r || String(r.value).toUpperCase() !== 'FALSE';
}
function intOr(v, d) { const n = parseInt(v, 10); return isNaN(n) ? d : n; }
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
/** 시트 수식 주입 막기: = + - @ 로 시작하면 앞에 ' 를 붙여 글자로 저장 */
function safeCell(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
