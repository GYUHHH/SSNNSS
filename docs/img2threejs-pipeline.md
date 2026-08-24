# 실제 img2threejs 생성 파이프라인

브라우저와 Cloudflare Worker는 Python·Claude Code 프로세스를 실행하지 않는다. 웹은 작업만 등록하고, GitHub Actions의 격리된 Ubuntu 작업자가 `img2threejs`와 Claude Code를 실제로 실행한다.

## 실행 순서

1. 웹에서 사진을 업로드한다. 텍스트 입력은 먼저 참조 이미지를 만든다.
2. Worker가 비공개 Supabase Storage에 참조 이미지를 저장하고 작업 행을 만든다.
3. Worker가 `.github/workflows/img2threejs.yml`을 실행한다.
4. 작업자가 `img2threejs v1.5-beta`, Python 3.12, Claude Code를 설치한다.
5. `forge/state.py init`과 `forge/next.py`로 실제 상태기계를 시작한다.
6. Claude Code가 이미지 분석, qualityContract, spec, 8개 조형 pass, 브라우저 다각도 렌더, 최대 3회 교정을 수행한다.
7. `validate_sculpt_spec.py`, 완료된 state, 앱용 JSON 스키마를 모두 검사한다.
8. 모든 게이트를 통과한 결과만 Worker에 반환한다. 실패 결과는 보관함에 들어가지 않는다.
9. 웹은 서버 작업을 polling하므로 패널을 닫아도 계속 진행되고, 새로고침 뒤에도 미수령 작업을 이어받는다.

## 최초 1회 설정

1. Supabase SQL Editor에서 [custom_object_jobs.sql](../supabase/custom_object_jobs.sql) 전체를 실행한다.
2. Cloudflare Worker secret을 등록한다.

```bash
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put GITHUB_ACTIONS_TOKEN
npx wrangler secret put IMG2THREEJS_RUNNER_SECRET
```

`GITHUB_ACTIONS_TOKEN`은 `GYUHHH/SSNNSS` 저장소의 Actions를 실행할 수 있는 fine-grained token이어야 한다.

3. GitHub 저장소의 Settings → Secrets and variables → Actions에 다음을 등록한다.

- `ANTHROPIC_API_KEY`
- `IMG2THREEJS_RUNNER_SECRET`: Cloudflare에 넣은 값과 정확히 같은 값

4. Worker를 다시 배포한다.

```bash
npx wrangler deploy
```

## 실패 기준

- 필수 secret 또는 SQL 테이블 없음
- 참조 이미지 검증 실패
- img2threejs 필수 단계·증거 누락
- 보정 횟수 초과
- 다각도 렌더 실패
- sculpt spec 또는 앱용 안전 스키마 실패

위 경우 작업은 `failed`로 종료되고 생성물을 저장하지 않는다.
