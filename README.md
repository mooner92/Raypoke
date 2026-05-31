# PokeBOT MCP Server

> Ray-Ban Meta 스마트 글래스 + [Poke AI](https://poke.com) + Claude + 실시간 웹검색을 연결하는 MCP(Model Context Protocol) 서버.

안경으로 사진을 찍거나 음성 명령을 내리면, Poke가 이 MCP 서버를 호출하여 Claude AI와 실시간 웹검색으로 처리한 뒤 iMessage로 답변합니다.

---

## 1. 아키텍처

```
┌──────────────────┐   "Hey Meta, send photo to Poke..."
│  Ray-Ban Meta    │
│  스마트 글래스    │── 사진/음성 ──┐
└──────────────────┘               │
                                   ▼
                          ┌──────────────────┐
                          │     Poke AI      │  (iMessage 인터페이스)
                          └────────┬─────────┘
                                   │ MCP over SSE (HTTPS)
                                   ▼
                  ┌──────────────────────────────────┐
                  │      PokeBOT MCP Server           │
                  │  (Express + @modelcontextprotocol)│
                  │                                   │
                  │  GET  /sse       SSE 연결         │
                  │  POST /messages  MCP 메시지       │
                  │  GET  /health    상태 확인        │
                  └───────┬───────────────────┬───────┘
                          │                   │
              ┌───────────▼──────┐   ┌────────▼──────────────┐
              │  Anthropic API   │   │   Gemini 2.5 Flash    │
              │ (claude-sonnet)  │   │ (Google Search 그라운딩)│
              │ 비전·복잡 추론    │   │ 검색·번역·길안내·가격   │
              └──────────────────┘   └───────────────────────┘
```

> **모델 이원화**: 단순 작업(웹검색·번역·길안내·행사/티켓/가격 검색)은 무료 **Gemini 2.5 Flash**가, 이미지 분석과 복잡한 추론은 **Claude Sonnet**이 담당합니다.

### 전체 플로우

1. 사용자가 안경으로 **"Hey Meta, send photo to Poke, why are people gathered here?"** 라고 말함
2. Poke가 사진 + 질문을 받아 PokeBOT MCP 서버의 적절한 도구(`analyze_scene`)를 SSE로 호출
3. 서버가 Claude Vision으로 이미지를 분석하고, 위치 정보가 있으면 Gemini의 Google Search 그라운딩으로 행사/입장료 정보를 추가 검색
4. 모델이 3문장 이내의 한국어 음성 최적화 답변을 생성
5. Poke가 답변을 iMessage로 전달 → 안경에서 음성으로 재생

---

## 2. MCP 도구 (8가지)

| 도구 | 설명 | 사용 API | 주요 입력 |
|------|------|----------|-----------|
| `web_search` | 실시간 웹검색 (Google Search 그라운딩) | Gemini | `query`, `count?` |
| `analyze_image` | 이미지 분석 (URL/base64/Meta CDN 자동 다운로드), 텍스트 추출·장소 식별 | Claude | `image_source`, `question`, `location?` |
| `analyze_scene` | 장면 종합 분석 + 행사 검색 결합 | Claude(+Gemini) | `image_source`, `location?` |
| `search_events` | 위치별 오늘 행사/입장료/예매 링크 | Gemini | `location`, `date?`, `category?` |
| `get_ticket_info` | 행사명 → 티켓 가격·예매처·잔여석 | Gemini | `event_name`, `platform?` |
| `translate` | 텍스트 번역 (메뉴판·간판) | Gemini | `text`, `target_lang?`, `source_lang?` |
| `price_search` | 상품 인터넷 최저가·판매처·링크 | Gemini | `item`, `options?` |
| `ask_claude` | Claude에게 직접 질문 (추론·설명) | Claude | `prompt`, `system?` |

모든 응답은 **3문장 이내·한국어·음성 출력 최적화**로 생성됩니다.

---

## 3. 설치

### 3-1. 로컬 개발

```bash
# 1) 의존성 설치
npm install

# 2) 환경 변수 설정
cp .env.example .env
#   .env 파일을 열어 ANTHROPIC_API_KEY, GEMINI_API_KEY 입력

# 3) 개발 서버 (hot reload)
npm run dev

# 4) 헬스체크
curl http://localhost:3000/health
```

빌드 / 프로덕션 실행:

```bash
npm run build   # dist/ 로 컴파일
npm start       # node dist/index.js
```

### 3-2. Oracle Cloud 배포

```bash
# Oracle 서버(Ubuntu 22.04)에서:
git clone <your-repo> ~/projects/pokebot
cd ~/projects/pokebot

# 초기 환경 자동 설정 (Node 22, Docker, nginx, 방화벽, .env)
bash scripts/setup.sh

# Docker로 실행
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

> **Oracle Free Tier 주의**: 방화벽은 **iptables**와 **Oracle Security List(콘솔)** 양쪽 모두 열어야 합니다. `setup.sh`가 iptables는 처리하지만, 콘솔의 Security List 인그레스 규칙(80/443)은 수동으로 추가해야 합니다.

---

## 4. API 키 발급

- **Anthropic (Claude)**: https://console.anthropic.com/ → API Keys
- **Google Gemini**: https://aistudio.google.com/apikey → Create API key (무료 티어 제공)

---

## 5. Poke 연동 방법

1. Poke 앱 → **Settings → Advanced → Custom Integrations**
2. **Add MCP Server** 선택
3. SSE 엔드포인트 입력: `https://YOUR_DOMAIN/sse`
4. (선택) `MCP_AUTH_TOKEN`을 설정한 경우, 헤더에 `Authorization: Bearer <token>` 추가하거나 URL을 `https://YOUR_DOMAIN/sse?token=<token>` 형태로 입력
5. 연결되면 7개 도구가 Poke에 노출됩니다.

---

## 6. 사용 예시 (안경에서)

- 🗣️ *"Hey Meta, send photo to Poke, why are people gathered here?"*
  → 장면 분석 + 행사 정보 + 입장료/예매 안내
- 🗣️ *"Hey Meta, send message to Poke: search events near Hongdae today"*
  → 오늘 홍대 행사 검색
- 🗣️ *"Hey Meta, send photo to Poke, explain this"*
  → 포스터/간판 텍스트 추출 + 설명
- 🗣️ *"Hey Meta, send photo to Poke, translate this menu"*
  → 메뉴판 번역

---

## 7. 도구별 상세

### `web_search(query, count?)`
Gemini의 Google Search 그라운딩으로 실시간 정보를 검색해 3문장으로 요약합니다. `count`는 참고할 결과 폭의 힌트입니다 (1–10, 기본 5).

### `analyze_image(image_source, question, location?)`
`image_source`는 `https://` URL 또는 base64 문자열(`data:image/...` 접두사 허용). 포스터·간판·메뉴판의 텍스트는 반드시 추출합니다. `location` 제공 시 더 정확한 답변.
Ray-Ban Meta 글래스가 보내는 단명·인증 CDN URL(`media.meta.com`, `fbcdn.net`, `cdninstagram.com`)은 서버가 직접 다운로드해 base64로 변환한 뒤 Claude에 전달합니다(다운로드 실패 시 URL 직접 전달로 fallback). 그 외 URL은 Claude가 직접 가져옵니다.

### `analyze_scene(image_source, location?)`
"사람들이 왜 모여있는지"에 특화. `location`이 있으면 `search_events`와 결합해 입장료/예매 정보까지 보강합니다. `analyze_image`와 동일한 Meta CDN 자동 다운로드 처리가 적용됩니다.

### `search_events(location, date?, category?)`
Gemini 그라운딩으로 행사명·입장료·예매 정보를 한 번에 검색해 요약. 인터파크/YES24/네이버예약 링크를 우선 노출합니다.

### `get_ticket_info(event_name, platform?)`
Gemini 그라운딩으로 가격·예매처·잔여 좌석 여부를 검색합니다.

### `translate(text, target_lang?, source_lang?)`
Gemini로 번역. 기본 목표 언어는 한국어, 원본 언어는 자동 감지.

### `price_search(item, options?)`
Gemini 그라운딩으로 상품의 인터넷 최저가·판매처·구매 링크를 검색합니다. "이거 인터넷에서 얼마야?" 류 질문에 대응합니다.

### `ask_claude(prompt, system?)`
복잡한 추론·설명이 필요할 때 Claude에 직접 질문합니다.

---

## 8. 트러블슈팅

| 증상 | 원인 / 해결 |
|------|------------|
| SSE 연결이 곧바로 끊김 | nginx에서 `proxy_buffering off`, `proxy_read_timeout 86400s` 확인. 서버는 `X-Accel-Buffering: no` 헤더를 보냅니다. |
| Poke에서 도구가 안 보임 | `/health`의 `tools` 배열과 `apis` 상태 확인. 401이면 토큰 불일치. |
| `검색 중 오류가 발생했어요` | Gemini/Anthropic 키 또는 쿼터 확인. `/health`의 `apis.gemini`, `apis.anthropic` 상태 참고. |
| 포트 접속 불가 (Oracle) | iptables **및** Oracle Security List 양쪽 인그레스 규칙 확인. |
| base64 이미지 413 오류 | nginx `client_max_body_size 25m`, Express body limit 확인. |

로그 레벨은 `.env`의 `LOG_LEVEL`(`debug|info|warn|error`)로 조정합니다. API 키 등 민감정보는 로그에서 자동 마스킹됩니다.

---

## 9. 기여 방법

1. 이슈를 등록하거나 기능을 제안합니다.
2. 브랜치를 만들어 작업합니다. PR 시 CI(`lint` + `typecheck` + `build`)가 자동 실행됩니다.
3. 코드 스타일: ESLint + Prettier (`npm run lint`, `npm run format`). `any` 사용 금지.
4. `main` 브랜치 머지 시 Oracle 서버로 자동 배포됩니다.

> 단위 테스트는 현재 범위에서 제외되어 있으며 향후 추가 예정입니다 (TODO).

---

## 10. 라이선스

[MIT](./LICENSE)
