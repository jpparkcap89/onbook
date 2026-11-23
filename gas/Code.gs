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
    if (body.action === 'admin.list') return json(adminList(body));
    if (body.action === 'admin.update') return json(adminUpdate(body));
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
  const denied = checkAdmin(b.adminCode); if (denied) return denied;
  const f = b.filters || {};
  const rows = readRows('submissions')
    .filter(r => (!f.bookId || r.bookId === f.bookId) && (!f.status || r.status === f.status))
    .sort((a, c) => String(c.createdAt).localeCompare(String(a.createdAt)))
    .map(r => { const o = {}; SHEETS.submissions.forEach(k => { o[k] = r[k]; }); return o; });
  return { ok: true, rows };
}

function adminUpdate(b) {
  const denied = checkAdmin(b.adminCode); if (denied) return denied;
  const id = String(b.id || ''), status = String(b.status || '');
  if (STATUSES.indexOf(status) < 0) return { ok: false, error: '상태가 올바르지 않습니다.' };
  const comment = clean(b.teacherComment, LIMITS.comment);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet('submissions');
    const last = sh.getLastRow();
    if (last < 2) return { ok: false, error: '제출물을 찾을 수 없습니다.' };
    const ids = sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0]));
    const i = ids.indexOf(id);
    if (i < 0) return { ok: false, error: '제출물을 찾을 수 없습니다.' };
    const row = i + 2;
    sh.getRange(row, SHEETS.submissions.indexOf('status') + 1).setValue(status);
    sh.getRange(row, SHEETS.submissions.indexOf('teacherComment') + 1).setValue(safeCell(comment));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
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
