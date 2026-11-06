/**
 * 가상 업무 대화 (모두 허구 데이터 — 실제 개인/기업 정보 없음).
 * 이 앱은 실제 AI 모델을 호출하지 않는다. 어시스턴트 응답은 전부 사전 작성/템플릿이다.
 */
export interface DemoMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface DemoConversation {
  id: string
  title: string
  group: 'today' | 'week' | 'month'
  messages: DemoMessage[]
}

export const CONVERSATIONS: DemoConversation[] = [
  {
    id: 'c-settlement-review',
    title: '정산 배치 PR 코드 리뷰',
    group: 'today',
    messages: [
      {
        role: 'user',
        content:
          '정산 배치에서 중복 지급 이슈가 있었던 부분 수정한 PR이야. 리뷰해줘.\n\n```ts\nexport async function settleDaily(date: string) {\n  const rows = await repo.findPending(date)\n  for (const row of rows) {\n    await payout.send(row.merchantId, row.amount)\n    await repo.markSettled(row.id)\n  }\n}\n```',
      },
      {
        role: 'assistant',
        content: `중복 지급의 근본 원인은 **지급 요청과 상태 변경이 원자적으로 묶여 있지 않다는 점**입니다. \`payout.send\` 성공 후 \`markSettled\` 전에 프로세스가 죽으면, 다음 배치에서 같은 건이 다시 지급됩니다.

### 주요 지적 사항

1. **멱등 키 부재** — 지급 API 호출 시 \`row.id\` 기반 멱등 키를 넘기지 않아 재시도 시 중복 지급을 막을 수 없습니다.
2. **상태 선점 없음** — 여러 워커가 동시에 \`findPending\`을 호출하면 같은 행을 집을 수 있습니다.
3. **순차 처리** — 건별 \`await\`로 처리 시간이 행 수에 비례합니다. 다만 정합성 이슈를 먼저 해결한 뒤 병렬화하는 것이 안전합니다.

### 수정 제안

\`\`\`ts
export async function settleDaily(date: string) {
  // 1) 처리할 행을 먼저 선점 (PENDING → PROCESSING)
  const rows = await repo.claimPending(date, { workerId, limit: 500 })

  for (const row of rows) {
    try {
      await payout.send(row.merchantId, row.amount, {
        idempotencyKey: \`settle:\${row.id}\`,
      })
      await repo.markSettled(row.id)
    } catch (err) {
      await repo.release(row.id, { reason: String(err) })
      logger.warn('settle failed', { id: row.id, err })
    }
  }
}
\`\`\`

\`claimPending\`은 \`UPDATE ... SET status = 'PROCESSING' WHERE status = 'PENDING' ... RETURNING *\` 형태로 구현하면 행 잠금 없이도 선점이 됩니다.

| 항목 | 현재 | 제안 |
| --- | --- | --- |
| 중복 지급 방지 | 없음 | 멱등 키 + 상태 선점 |
| 실패 처리 | 배치 전체 중단 | 건별 release 후 계속 |
| 동시 실행 | 위험 | 안전 |

테스트로는 \`markSettled\` 직전에 예외를 던지는 케이스와, 워커 2개가 동시에 실행되는 케이스를 추가하는 것을 권장합니다.`,
      },
      { role: 'user', content: 'release 할 때 재시도 횟수 제한도 넣는 게 좋을까?' },
      {
        role: 'assistant',
        content: `네, 넣는 것이 좋습니다. 영구 실패 건(예: 해지된 계좌)이 매 배치마다 재시도되면 로그와 알림이 계속 쌓입니다.

- \`retry_count\` 컬럼을 두고 \`release\` 시 1씩 증가
- 3회 초과 시 \`status = 'FAILED'\`로 전환하고 운영 알림 발송
- \`FAILED\` 건은 백오피스에서 수동 재처리

\`\`\`sql
UPDATE settlement
   SET status = CASE WHEN retry_count >= 3 THEN 'FAILED' ELSE 'PENDING' END,
       retry_count = retry_count + 1,
       last_error = $2
 WHERE id = $1;
\`\`\``,
      },
    ],
  },
  {
    id: 'c-payment-reqs',
    title: '결제 API v2 요구사항 정리',
    group: 'today',
    messages: [
      {
        role: 'user',
        content: '회의 메모 붙여넣을게. 결제 API v2 요구사항으로 정리해줘.\n\n- 부분 환불 지원 필요 (현재 전체 환불만)\n- 카드사 응답 지연 시 타임아웃 10초 → 고객 이탈\n- 가맹점별 수수료율 다르게\n- 웹훅 재전송 기능 요청 많음\n- 정산 리포트 CSV 다운로드',
      },
      {
        role: 'assistant',
        content: `회의 메모를 기능/비기능 요구사항으로 나눠 정리했습니다.

## 기능 요구사항

| ID | 요구사항 | 우선순위 | 비고 |
| --- | --- | --- | --- |
| FR-01 | 부분 환불 API | 높음 | 누적 환불액 ≤ 결제액 검증 |
| FR-02 | 가맹점별 수수료율 설정 | 높음 | 적용 시작일 기준 이력 관리 |
| FR-03 | 웹훅 수동/자동 재전송 | 중간 | 최대 5회, 지수 백오프 |
| FR-04 | 정산 리포트 CSV 다운로드 | 낮음 | 기간 최대 31일 |

## 비기능 요구사항

- **응답 시간**: 승인 요청 p95 3초 이내. 카드사 응답이 5초를 넘으면 \`PENDING\` 상태로 응답하고 결과는 웹훅으로 통지
- **가용성**: 월 99.9% (점검 시간 제외)
- **감사 로그**: 환불·수수료 변경은 변경자와 사유를 필수로 기록

## 확인이 필요한 사항

1. 부분 환불 시 수수료도 비례 환불하는지, 원 수수료를 유지하는지
2. 수수료율 변경이 이미 승인된 미정산 건에도 적용되는지
3. 웹훅 재전송을 가맹점이 직접 호출할 수 있게 열어둘지

다음 단계로 FR-01의 API 스펙 초안(요청/응답 필드, 에러 코드)을 작성해 드릴까요?`,
      },
    ],
  },
  {
    id: 'c-q3-sales',
    title: '3분기 지역별 매출 분석',
    group: 'today',
    messages: [
      {
        role: 'user',
        content: '3분기 지역별 매출 요약 데이터야. 특이점이랑 다음 분기 액션 아이템 뽑아줘.\n\n수도권 41.2억(+8%), 영남 18.7억(-3%), 호남 9.4억(+12%), 충청 11.1억(+1%), 강원/제주 4.3억(-9%)',
      },
      {
        role: 'assistant',
        content: `3분기 전체 매출은 **84.7억 원**으로 전 분기 대비 약 **+4.1%** 증가했습니다.

| 지역 | 매출 | 전 분기 대비 | 비중 |
| --- | ---: | ---: | ---: |
| 수도권 | 41.2억 | +8% | 48.6% |
| 영남 | 18.7억 | −3% | 22.1% |
| 충청 | 11.1억 | +1% | 13.1% |
| 호남 | 9.4억 | +12% | 11.1% |
| 강원/제주 | 4.3억 | −9% | 5.1% |

### 특이점

- **호남 +12%**는 신규 대리점 2곳 오픈 효과로 보입니다. 기존 점포 기준 성장률을 따로 확인해야 실제 수요 증가인지 판단할 수 있습니다.
- **수도권 집중도 48.6%**는 전 분기(46.9%)보다 높아졌습니다. 성장은 좋지만 단일 지역 의존도가 커지고 있습니다.
- **강원/제주 −9%**는 계절성(성수기 종료) 영향이 큽니다. 작년 동기 대비로 비교하는 편이 정확합니다.

### 다음 분기 액션 아이템

1. 영남 지역 하락 원인 분해 — 고객 수 감소인지 객단가 하락인지 확인
2. 호남 신규 대리점의 3개월 코호트 리텐션 추적
3. 지역별 지표를 **전년 동기 대비**로 대시보드에 추가`,
      },
    ],
  },
  {
    id: 'c-kafka-lag',
    title: 'Kafka consumer lag 원인 분석',
    group: 'week',
    messages: [
      {
        role: 'user',
        content: 'order-events 컨슈머 lag이 피크 시간마다 20만까지 올라가. 파티션 12개, 컨슈머 인스턴스 4개야. 처리 로직에 DB insert 있어.',
      },
      {
        role: 'assistant',
        content: `파티션 12개에 인스턴스 4개면 인스턴스당 3개 파티션을 처리하고 있습니다. lag이 피크에만 쌓인다면 **처리량 한계**일 가능성이 높습니다.

### 확인 순서

1. \`records-consumed-rate\`와 \`commit-latency-avg\` 지표로 처리 속도 측정
2. 메시지당 DB insert 시간 확인 — 건별 insert라면 이 부분이 병목일 가능성이 큽니다
3. \`max.poll.records\` 와 \`max.poll.interval.ms\` 설정으로 리밸런싱이 반복되는지 확인

### 개선안

- **배치 insert**: poll 단위로 모아서 \`INSERT ... VALUES (...), (...)\` 한 번에 처리
- **인스턴스 확장**: 파티션 수(12)까지는 선형 확장이 가능
- **커밋 전략**: 배치 처리 후 수동 커밋 (\`enable.auto.commit=false\`)

\`\`\`bash
kafka-consumer-groups --bootstrap-server $BROKER \\
  --describe --group order-events-consumer
\`\`\`

위 명령으로 파티션별 lag 분포를 먼저 보세요. 특정 파티션에만 몰려 있다면 키 분포(핫 키) 문제입니다.`,
      },
    ],
  },
  {
    id: 'c-onboarding-doc',
    title: '신규 입사자 온보딩 문서 요약',
    group: 'week',
    messages: [
      { role: 'user', content: '개발팀 온보딩 위키가 너무 길어. 첫 주에 꼭 해야 할 것만 체크리스트로 줄여줘.' },
      {
        role: 'assistant',
        content: `첫 주 체크리스트로 줄였습니다. 위키 원문 순서가 아니라 **의존 관계 순서**로 배치했습니다.

**1일 차**
- [ ] 사내 계정, VPN, 2단계 인증 설정
- [ ] 저장소 접근 권한 요청 (팀 리드 승인 필요)
- [ ] 로컬 개발 환경 구성 — \`make bootstrap\` 실행

**2–3일 차**
- [ ] 스테이징 배포 파이프라인 한 번 따라 해보기
- [ ] 온콜 런북 읽기 (장애 등급, 연락 체계)
- [ ] 첫 PR: 문서 오타 수정 등 작은 변경으로 리뷰 흐름 익히기

**4–5일 차**
- [ ] 담당 서비스 아키텍처 리뷰 세션 (멘토와 1시간)
- [ ] \`good-first-issue\` 라벨 이슈 1건 처리

나머지(코드 컨벤션 상세, 히스토리성 문서)는 필요할 때 찾아보는 참고 자료로 분리하는 것을 권장합니다.`,
      },
    ],
  },
  {
    id: 'c-sql-opt',
    title: '주문 조회 쿼리 최적화',
    group: 'week',
    messages: [
      {
        role: 'user',
        content: '이 쿼리가 3초 넘게 걸려.\n\n```sql\nSELECT * FROM orders o\nJOIN customers c ON c.id = o.customer_id\nWHERE DATE(o.created_at) = \'2026-10-31\'\nORDER BY o.created_at DESC;\n```',
      },
      {
        role: 'assistant',
        content: `\`DATE(o.created_at)\`처럼 컬럼에 함수를 씌우면 \`created_at\` 인덱스를 사용할 수 없습니다. 범위 조건으로 바꾸세요.

\`\`\`sql
SELECT o.id, o.status, o.total_amount, o.created_at,
       c.name, c.grade
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
 WHERE o.created_at >= '2026-10-31'
   AND o.created_at <  '2026-11-01'
 ORDER BY o.created_at DESC;
\`\`\`

추가로 확인할 것:

- \`SELECT *\` 대신 필요한 컬럼만 조회 (특히 TEXT/JSON 컬럼 제외)
- \`orders(created_at)\` 인덱스 존재 여부 — 없다면 생성
- \`EXPLAIN ANALYZE\`로 \`Index Scan\` 사용 여부 확인

일반적으로 이 수정만으로 수십 ms 수준으로 줄어듭니다.`,
      },
    ],
  },
  {
    id: 'c-sprint-notes',
    title: '스프린트 리뷰 회의록 정리',
    group: 'month',
    messages: [
      { role: 'user', content: '스프린트 23 리뷰 회의록 정리해줘. 녹취 요약본 붙일게.' },
      {
        role: 'assistant',
        content: `## 스프린트 23 리뷰

**완료**
- 주문 내역 필터 개선 (기간/상태 복합 필터)
- 관리자 대시보드 응답 속도 개선 — p95 1.8초 → 0.6초

**이월**
- 쿠폰 중복 적용 방지 — 정책 확정 지연으로 다음 스프린트로 이월

**결정 사항**
- 다음 스프린트부터 QA 기간을 2일 → 3일로 늘림
- 장애 회고 문서는 발생 후 3영업일 이내 공유

**액션 아이템**

| 담당 | 내용 | 기한 |
| --- | --- | --- |
| 백엔드 | 쿠폰 정책 초안 공유 | 11/10 |
| 프론트 | 필터 UI 사용성 테스트 결과 정리 | 11/12 |
| 전원 | 회고 템플릿 검토 | 11/08 |`,
      },
    ],
  },
  {
    id: 'c-release-notes',
    title: '릴리스 노트 v2.14 초안',
    group: 'month',
    messages: [
      { role: 'user', content: 'v2.14 변경 사항 커밋 로그로 릴리스 노트 초안 써줘. 고객용 톤으로.' },
      {
        role: 'assistant',
        content: `### v2.14 업데이트 안내

**새로운 기능**
- 주문 내역을 기간과 상태로 함께 필터링할 수 있습니다.
- 정산 리포트를 CSV 파일로 내려받을 수 있습니다.

**개선 사항**
- 관리자 대시보드가 이전보다 약 3배 빠르게 열립니다.
- 결제 실패 시 안내 문구를 더 구체적으로 바꿨습니다.

**수정된 문제**
- 일부 환경에서 영수증 출력 시 금액이 잘리던 문제를 수정했습니다.

업데이트는 별도 작업 없이 자동으로 적용됩니다.`,
      },
    ],
  },
  {
    id: 'c-regex',
    title: '사업자등록번호 검증 정규식',
    group: 'month',
    messages: [
      { role: 'user', content: '사업자등록번호 형식 검증 정규식 알려줘. 하이픈 있어도 없어도 되게.' },
      {
        role: 'assistant',
        content: `형식만 검증하는 정규식은 다음과 같습니다.

\`\`\`ts
const BIZ_NO = /^\\d{3}-?\\d{2}-?\\d{5}$/

BIZ_NO.test('123-45-67890') // true
BIZ_NO.test('1234567890')   // true
\`\`\`

다만 형식만 맞는 번호도 많기 때문에, 실제 서비스에서는 **체크섬 검증**을 함께 하는 것이 좋습니다. 필요하면 체크섬 함수도 작성해 드릴게요.`,
      },
    ],
  },
]

export const GROUP_LABEL = { today: '오늘', week: '지난 7일', month: '지난 30일' } as const

/** 업무 보기 및 빈 대화의 제안 프롬프트 */
export const SUGGESTIONS = [
  { title: '코드 리뷰', text: '이 함수의 에러 처리를 리뷰해줘' },
  { title: '문서 요약', text: '회의록을 결정 사항과 액션 아이템으로 정리해줘' },
  { title: '데이터 분석', text: '월별 매출 추이에서 이상치를 찾아줘' },
  { title: 'SQL 작성', text: '최근 30일 재구매 고객 비율을 구하는 쿼리 작성해줘' },
]

/**
 * 오프라인 템플릿 응답.
 * 실제 모델이 없으므로 입력 키워드에 따라 사전 작성된 형식의 응답을 돌려준다.
 */
export function templateReply(input: string): string {
  const t = input.toLowerCase()
  const quoted = input.length > 60 ? input.slice(0, 60) + '…' : input
  if (/(리뷰|코드|함수|버그|에러|error|pr\b)/.test(t))
    return `요청하신 내용을 코드 리뷰 관점에서 정리하면 다음과 같습니다.

1. **입력 검증** — 외부에서 들어오는 값의 타입과 범위를 함수 진입 시점에 확인하세요.
2. **에러 전파** — 예외를 삼키지 말고, 호출자가 판단할 수 있도록 원인을 포함해 다시 던지거나 결과 타입으로 반환하세요.
3. **부수 효과 분리** — I/O와 계산 로직을 분리하면 테스트 작성이 쉬워집니다.

실제 코드를 붙여 주시면 줄 단위로 구체적인 의견을 드릴 수 있습니다.`
  if (/(분석|데이터|매출|지표|통계|추이)/.test(t))
    return `분석은 다음 순서로 진행하는 것을 권장합니다.

| 단계 | 내용 |
| --- | --- |
| 1 | 기간·단위(일/주/월)와 비교 기준(전월/전년 동기) 확정 |
| 2 | 결측치·중복 제거 등 데이터 정합성 확인 |
| 3 | 추세 확인 후 이상치는 원인 이벤트와 대조 |
| 4 | 결론과 다음 액션을 3개 이내로 요약 |

원본 데이터(CSV 또는 표)를 붙여 주시면 바로 계산해 드리겠습니다.`
  if (/(sql|쿼리|select|테이블)/.test(t))
    return `쿼리를 작성하려면 테이블 구조가 필요합니다. 일반적인 형태로 예시를 드리면:

\`\`\`sql
SELECT DATE_TRUNC('month', created_at) AS month,
       COUNT(*)                         AS orders
  FROM orders
 WHERE created_at >= NOW() - INTERVAL '30 days'
 GROUP BY 1
 ORDER BY 1;
\`\`\`

실제 컬럼명을 알려 주시면 그에 맞게 수정하겠습니다.`
  if (/(회의|정리|요약|문서|메모)/.test(t))
    return `"${quoted}" 요청을 기준으로 정리 형식을 제안드립니다.

- **배경** — 논의가 필요했던 이유 한두 줄
- **결정 사항** — 확정된 내용만
- **액션 아이템** — 담당자와 기한 포함
- **미결 사항** — 다음 논의로 넘길 것

원문을 붙여 주시면 이 형식으로 바로 정리해 드릴게요.`
  return `"${quoted}"에 대해 정리해 보겠습니다.

먼저 목표와 제약 조건을 명확히 하는 것이 좋습니다. 다음 정보를 알려 주시면 더 정확하게 도와드릴 수 있습니다.

1. 최종적으로 얻고 싶은 결과물 (문서, 코드, 표 등)
2. 참고해야 할 기존 자료나 조건
3. 마감 일정이나 우선순위`
}
