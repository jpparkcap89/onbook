# 박선영 작가 한 책 읽기 포털 (onebook)

박선영 작가의 동화 세 권을 학년군별로 함께 읽는 포털입니다. 책마다 읽기 전·중·후 **10차시 활동**과 **인쇄용 A4 활동지**가 있고, 학생이 감상·질문·작품을 온라인으로 제출하면 교사가 확인한 뒤 게시판에 공개합니다.

| 학년군 | 도서 |
|---|---|
| 1~2학년 | 가비와 달랑달랑 달랑구 |
| 3~4학년 | 꿈의 공책 |
| 5~6학년 | 도와줘! 예비 천사 한수이 |

## 구조

```
GitHub Pages (index.html · assets · data)  ──fetch──▶  Google Apps Script 웹앱 (gas/)  ──▶  Google Sheets
```

```
onebook/
├─ index.html            # 해시 라우팅: #home #author #gabi #gabi-3 #gabi-wall #admin
├─ assets/style.css      # cap89 스타일
├─ assets/app.js         # 화면·활동지·제출·게시판·교사 관리
├─ assets/config.js      # GAS 웹앱 주소(apiUrl)
├─ data/books.json       # 책·차시·활동 흐름·활동지 문항
├─ gas/Code.gs           # Apps Script 백엔드(API)
├─ gas/appsscript.json  # (clasp를 쓸 때만 필요)
├─ SETUP.md            # 시트·웹앱 연결 안내
└─ claude/               # 설계 문서와 1차 시안
```

## 활동 내용 고치기

`data/books.json`의 `books[].lessons[]`를 고칩니다. 활동지 문항(`sheet`) 형식:

| k | 모양 | 필드 |
|---|---|---|
| `q` | 줄 쓰기 | `lines` |
| `draw` | 그리기 칸 | `h`(높이, px) |
| `tbl` | 표 | `cols`, `rows`, `rowLabels` |
| `ck` | 고르기 | `opts` |
| `ox` | OX 문항 | `items` |
| `scale` | 가치 수직선 | `left`, `right` |
| `bingo` | 빙고판 | `size` |
| `how` | 만드는 방법 | `steps` |

시트의 `lessons` 탭에 고친 내용을 넣으면 저장소를 고치지 않아도 화면에 우선 적용됩니다(gas/Code.gs 참고).

## 로컬에서 보기

`data/books.json`을 불러오므로 웹 서버로 엽니다.

```bash
python -m http.server 8000
```

## 백엔드 연결

구글 시트의 **확장 프로그램 → Apps Script**에 `gas/Code.gs`를 붙여 넣고 웹앱으로 배포합니다. 순서는 [SETUP.md](SETUP.md)를 보세요.

## 개인정보

- 실명은 받지 않습니다(학년·반·번호 + 선택 닉네임).
- 제출물은 교사가 승인한 뒤에만 공개됩니다.
- 책 본문은 옮기지 않고, 활동에 필요한 장면만 쪽수와 함께 적습니다.
