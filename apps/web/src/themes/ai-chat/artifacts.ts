/**
 * 산출물 패널에 순환 표시되는 가상 결과물 (코드 / 문서 / 차트). 모두 허구 데이터.
 * 실제 생성이 아니라 미리 작성된 내용을 "작성 중"처럼 점진적으로 보여준다.
 */
export type ArtifactTemplate =
  | { kind: 'code'; title: string; lang: string; body: string }
  | { kind: 'doc'; title: string; body: string }
  | {
      kind: 'chart'
      title: string
      subtitle: string
      chart: 'line' | 'bar'
      unit: string
      points: { label: string; value: number }[]
      notes: string
    }

export const ARTIFACTS: ArtifactTemplate[] = [
  {
    kind: 'code',
    title: 'refund.service.ts',
    lang: 'ts',
    body: `import { z } from 'zod'
import { db } from '../db'
import { payoutClient } from '../clients/payout'

const PartialRefund = z.object({
  paymentId: z.string().startsWith('pay_'),
  amount: z.number().int().positive(),
  reason: z.string().max(200),
})

export type PartialRefundInput = z.infer<typeof PartialRefund>

/**
 * 부분 환불 — 누적 환불액이 결제액을 넘지 않도록 행 잠금 후 검증한다.
 */
export async function partialRefund(input: PartialRefundInput) {
  const req = PartialRefund.parse(input)

  return db.transaction(async (tx) => {
    const payment = await tx.payments.findForUpdate(req.paymentId)
    if (!payment) throw new RefundError('PAYMENT_NOT_FOUND')
    if (payment.status !== 'CAPTURED') throw new RefundError('INVALID_STATE')

    const refunded = await tx.refunds.sumByPayment(payment.id)
    if (refunded + req.amount > payment.amount) {
      throw new RefundError('REFUND_EXCEEDS_PAYMENT', {
        remaining: payment.amount - refunded,
      })
    }

    const refund = await tx.refunds.insert({
      paymentId: payment.id,
      amount: req.amount,
      reason: req.reason,
      status: 'PENDING',
    })

    await payoutClient.refund(payment.pgTxId, req.amount, {
      idempotencyKey: \`refund:\${refund.id}\`,
    })
    return tx.refunds.markDone(refund.id)
  })
}

export class RefundError extends Error {
  constructor(readonly code: string, readonly meta?: Record<string, unknown>) {
    super(code)
  }
}
`,
  },
  {
    kind: 'chart',
    title: '월별 결제 승인율',
    subtitle: '2025.12 – 2026.10 · 전체 가맹점 · 단위 %',
    chart: 'line',
    unit: '%',
    points: [
      { label: '12월', value: 96.1 },
      { label: '1월', value: 96.4 },
      { label: '2월', value: 95.8 },
      { label: '3월', value: 96.6 },
      { label: '4월', value: 96.9 },
      { label: '5월', value: 97.2 },
      { label: '6월', value: 94.3 },
      { label: '7월', value: 96.8 },
      { label: '8월', value: 97.4 },
      { label: '9월', value: 97.6 },
      { label: '10월', value: 97.9 },
    ],
    notes: `- 6월 급락(94.3%)은 카드사 점검 시간대 타임아웃 영향으로 확인됨
- 7월 이후 타임아웃 시 \`PENDING\` 응답 + 웹훅 통지로 바꾼 뒤 회복세
- 10월 97.9%로 최근 1년 최고치`,
  },
  {
    kind: 'doc',
    title: '정산_배치_장애_회고.md',
    body: `# 정산 배치 중복 지급 장애 회고

**발생** 2026-10-28 02:10 · **복구** 02:55 · **영향** 가맹점 37곳, 중복 지급 41건

## 요약
정산 배치 워커가 지급 요청 성공 직후 재시작되면서, 상태가 \`PENDING\` 으로 남은 건이 다음 실행에서 다시 지급되었습니다.

## 타임라인
| 시각 | 내용 |
| --- | --- |
| 02:10 | 배포 파이프라인이 워커 롤링 재시작 |
| 02:14 | 지급 대사 알림 — 금액 불일치 |
| 02:31 | 배치 일시 중지, 원인 파악 |
| 02:55 | 중복 지급분 회수 요청 완료 |

## 근본 원인
1. 지급 요청과 상태 변경이 원자적으로 묶여 있지 않음
2. 지급 API 호출 시 멱등 키 미사용
3. 배치 실행 중 배포를 막는 장치 없음

## 재발 방지
- [x] 처리 대상 행 선점(\`PENDING → PROCESSING\`) 도입
- [x] 멱등 키 \`settle:{id}\` 전달
- [ ] 배치 실행 중 배포 차단 (11/14)
- [ ] 대사 알림 임계값 조정 (11/20)
`,
  },
  {
    kind: 'code',
    title: 'daily_revenue.sql',
    lang: 'sql',
    body: `-- 일별 순매출 (환불 차감) · 최근 30일
WITH paid AS (
  SELECT DATE_TRUNC('day', captured_at) AS day,
         SUM(amount)                    AS gross
    FROM payments
   WHERE status = 'CAPTURED'
     AND captured_at >= NOW() - INTERVAL '30 days'
   GROUP BY 1
),
refunded AS (
  SELECT DATE_TRUNC('day', created_at) AS day,
         SUM(amount)                   AS refunds
    FROM refunds
   WHERE status = 'DONE'
     AND created_at >= NOW() - INTERVAL '30 days'
   GROUP BY 1
)
SELECT p.day,
       p.gross,
       COALESCE(r.refunds, 0)              AS refunds,
       p.gross - COALESCE(r.refunds, 0)    AS net,
       ROUND(COALESCE(r.refunds, 0) * 100.0 / p.gross, 2) AS refund_rate
  FROM paid p
  LEFT JOIN refunded r ON r.day = p.day
 ORDER BY p.day DESC;
`,
  },
  {
    kind: 'chart',
    title: '지역별 3분기 매출',
    subtitle: '2026 Q3 · 단위 억 원',
    chart: 'bar',
    unit: '억',
    points: [
      { label: '수도권', value: 41.2 },
      { label: '영남', value: 18.7 },
      { label: '충청', value: 11.1 },
      { label: '호남', value: 9.4 },
      { label: '강원/제주', value: 4.3 },
    ],
    notes: `- 전체 84.7억, 전 분기 대비 +4.1%
- 수도권 비중 48.6% — 전 분기(46.9%)보다 집중도 상승
- 호남 +12%는 신규 대리점 2곳 효과, 기존점 기준 성장률 별도 확인 필요`,
  },
  {
    kind: 'doc',
    title: 'API_v2_마이그레이션_가이드.md',
    body: `# 결제 API v2 마이그레이션 가이드

v1은 **2027-03-31**에 종료됩니다. 아래 순서대로 전환하세요.

## 1. 엔드포인트 변경
| v1 | v2 |
| --- | --- |
| \`POST /payments/cancel\` | \`POST /v2/payments/{id}/refunds\` |
| \`GET /settle?date=\` | \`GET /v2/settlements?from=&to=\` |

## 2. 부분 환불
v2부터 \`amount\` 를 지정해 부분 환불할 수 있습니다. 누적 환불액이 결제액을 넘으면 \`REFUND_EXCEEDS_PAYMENT\` 를 반환합니다.

\`\`\`bash
curl -X POST https://api.example.com/v2/payments/pay_8f2a/refunds \\
  -H "Idempotency-Key: 6f1c..." \\
  -d '{ "amount": 15000, "reason": "부분 취소" }'
\`\`\`

## 3. 웹훅
- 서명 헤더가 \`X-Signature-256\` 으로 바뀝니다.
- 실패 시 최대 5회, 지수 백오프로 재전송합니다.

## 체크리스트
- [ ] 멱등 키 헤더 추가
- [ ] 환불 에러 코드 처리
- [ ] 웹훅 서명 검증 로직 교체
`,
  },
]
