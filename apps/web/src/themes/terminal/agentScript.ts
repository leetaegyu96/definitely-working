/**
 * 오른쪽 분할 창: AI 코딩 에이전트가 혼자 작업하는 것처럼 보이는 가상 시나리오 (반복 재생).
 * 실제로 아무 것도 실행하거나 수정하지 않는다.
 */
export type Step =
  | { k: 'prompt'; text: string }
  | { k: 'think'; ms: number; text?: string }
  | { k: 'say'; text: string }
  | { k: 'tool'; name: string; arg: string; result: string; ms?: number }
  | { k: 'bash'; cmd: string; out: { t: string; c?: string }[]; ms?: number }
  | { k: 'diff'; file: string; add: number; del: number; lines: { n: number; t: string; s: '+' | '-' | ' ' }[] }
  | { k: 'todo'; items: { done: boolean; text: string }[] }
  | { k: 'pause'; ms: number }

export const SCENARIOS: Step[][] = [
  [
    { k: 'prompt', text: '웹훅 재전송에 지수 백오프 넣어줘. 최대 5회' },
    { k: 'think', ms: 2600, text: '재전송 로직이 어디 있는지 먼저 확인하고, 현재 재시도 간격이 고정인지 봐야겠다.' },
    { k: 'tool', name: 'Search', arg: 'pattern: "retryWebhook"', result: 'Found 3 files' },
    { k: 'tool', name: 'Read', arg: 'src/webhook/dispatcher.ts', result: 'Read 96 lines' },
    { k: 'say', text: '현재는 30초 고정 간격으로 무제한 재시도하고 있습니다. 시도 횟수를 저장하고 2ⁿ 분 간격(최대 5회)으로 바꾸겠습니다.' },
    { k: 'todo', items: [{ done: false, text: 'attempts 컬럼 추가 마이그레이션' }, { done: false, text: 'nextRetryAt 계산 로직 변경' }, { done: false, text: '5회 초과 시 DEAD 처리' }, { done: false, text: '테스트 추가' }] },
    { k: 'diff', file: 'src/webhook/dispatcher.ts', add: 9, del: 3, lines: [
      { n: 41, t: '  const attempts = event.attempts + 1', s: ' ' },
      { n: 42, t: '  const next = new Date(Date.now() + 30_000)', s: '-' },
      { n: 42, t: '  if (attempts > MAX_ATTEMPTS) {', s: '+' },
      { n: 43, t: "    return repo.markDead(event.id, 'max attempts exceeded')", s: '+' },
      { n: 44, t: '  }', s: '+' },
      { n: 45, t: '  const delayMs = 2 ** attempts * 60_000 + jitter(5_000)', s: '+' },
      { n: 46, t: '  const next = new Date(Date.now() + delayMs)', s: '+' },
    ] },
    { k: 'tool', name: 'Write', arg: 'migrations/0042_webhook_attempts.sql', result: 'Wrote 6 lines' },
    { k: 'think', ms: 1800 },
    { k: 'bash', cmd: 'pnpm test webhook', out: [
      { t: ' ✓ test/webhook/dispatcher.test.ts (7 tests) 38ms', c: 't-green' },
      { t: ' ✓ test/webhook/signature.test.ts (4 tests) 9ms', c: 't-green' },
      { t: ' Tests  11 passed (11)', c: 't-green' },
    ] },
    { k: 'todo', items: [{ done: true, text: 'attempts 컬럼 추가 마이그레이션' }, { done: true, text: 'nextRetryAt 계산 로직 변경' }, { done: true, text: '5회 초과 시 DEAD 처리' }, { done: true, text: '테스트 추가' }] },
    { k: 'say', text: '완료했습니다. 재시도 간격은 2·4·8·16·32분(+최대 5초 지터)이고, 5회 초과 시 DEAD 상태로 전환되어 백오피스에서 수동 재전송할 수 있습니다.' },
    { k: 'pause', ms: 7000 },
  ],
  [
    { k: 'prompt', text: '주문 조회 API p95가 1.2초야. 원인 찾아줘' },
    { k: 'think', ms: 3000, text: 'API 레이어보다 쿼리 쪽일 가능성이 높다. 실행 계획부터 보자.' },
    { k: 'tool', name: 'Read', arg: 'src/orders/repo.ts', result: 'Read 142 lines' },
    { k: 'bash', cmd: 'psql $DATABASE_URL -c "EXPLAIN ANALYZE SELECT ..."', out: [
      { t: ' Sort  (cost=48211.33..48302.10 rows=36308) (actual time=1104.2..1131.9)' },
      { t: '   ->  Seq Scan on orders o  (actual time=0.03..982.4 rows=36120)', c: 't-yellow' },
      { t: '         Filter: (date(created_at) = \'2026-11-05\'::date)' },
      { t: ' Planning Time: 0.4 ms' },
      { t: ' Execution Time: 1139.8 ms', c: 't-red' },
    ], ms: 1400 },
    { k: 'say', text: 'created_at 에 DATE() 를 씌워서 인덱스를 못 타고 전체 스캔하고 있습니다. 범위 조건으로 바꾸겠습니다.' },
    { k: 'diff', file: 'src/orders/repo.ts', add: 2, del: 1, lines: [
      { n: 58, t: "    .where(sql`date(o.created_at) = ${day}`)", s: '-' },
      { n: 58, t: "    .where('o.created_at', '>=', dayStart(day))", s: '+' },
      { n: 59, t: "    .where('o.created_at', '<', dayStart(addDays(day, 1)))", s: '+' },
    ] },
    { k: 'bash', cmd: 'psql $DATABASE_URL -c "EXPLAIN ANALYZE SELECT ..."', out: [
      { t: ' Index Scan using orders_created_at_idx on orders o  (actual time=0.04..21.7)', c: 't-green' },
      { t: ' Execution Time: 24.3 ms', c: 't-green' },
    ], ms: 1100 },
    { k: 'say', text: '1139ms → 24ms 로 줄었습니다. 같은 패턴이 정산 리포트 쿼리 2곳에도 있어 함께 고칠지 확인이 필요합니다.' },
    { k: 'pause', ms: 8000 },
  ],
  [
    { k: 'prompt', text: '부분 환불 테스트 커버리지 올려줘' },
    { k: 'think', ms: 2200, text: '경계값 위주로 — 누적 환불액이 정확히 결제액과 같을 때, 1원 초과할 때, 동시 요청.' },
    { k: 'bash', cmd: 'pnpm vitest run --coverage src/payment', out: [
      { t: ' % Coverage report from v8' },
      { t: ' refund.service.ts   |   61.2 |    48.0 |   66.6 |   61.2 | 34-41,57-63', c: 't-yellow' },
    ], ms: 1600 },
    { k: 'tool', name: 'Read', arg: 'src/payment/refund.service.ts', result: 'Read 63 lines' },
    { k: 'tool', name: 'Write', arg: 'test/payment/refund.service.test.ts', result: 'Wrote 118 lines' },
    { k: 'say', text: '경계값 4건과 동시 환불 요청 1건을 추가했습니다. 동시 요청 케이스는 트랜잭션 내 행 잠금으로 하나만 성공해야 합니다.' },
    { k: 'bash', cmd: 'pnpm vitest run --coverage src/payment', out: [
      { t: ' ✓ test/payment/refund.service.test.ts (11 tests) 64ms', c: 't-green' },
      { t: ' refund.service.ts   |   94.1 |    91.6 |    100 |   94.1 | 61-62', c: 't-green' },
    ], ms: 1800 },
    { k: 'say', text: '라인 커버리지 61% → 94% 입니다. 남은 61–62행은 외부 PG 장애 분기라 목(mock) 확장이 필요합니다.' },
    { k: 'pause', ms: 7000 },
  ],
  [
    { k: 'prompt', text: 'README 실행 방법 최신화해줘' },
    { k: 'think', ms: 1600 },
    { k: 'tool', name: 'Read', arg: 'README.md', result: 'Read 41 lines' },
    { k: 'tool', name: 'Read', arg: 'docker-compose.yml', result: 'Read 28 lines' },
    { k: 'say', text: 'README 가 아직 로컬 PostgreSQL 직접 설치 기준입니다. docker compose 기준으로 바꾸고 환경 변수 표를 추가하겠습니다.' },
    { k: 'diff', file: 'README.md', add: 14, del: 6, lines: [
      { n: 7, t: '1. PostgreSQL 15 설치 후 billing DB 생성', s: '-' },
      { n: 7, t: '```bash', s: '+' },
      { n: 8, t: 'docker compose up -d postgres redis', s: '+' },
      { n: 9, t: 'pnpm install && pnpm db:migrate && pnpm dev', s: '+' },
      { n: 10, t: '```', s: '+' },
    ] },
    { k: 'say', text: '업데이트했습니다. `.env.example` 의 PAYOUT_API_URL 설명도 함께 추가했습니다.' },
    { k: 'pause', ms: 9000 },
  ],
]

export const VERBS = ['Thinking', 'Reasoning', 'Pondering', 'Considering', 'Analyzing']
