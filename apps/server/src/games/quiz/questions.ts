import type { QuizCategory } from '@relay/shared'

/** 자체 작성 문항. answer = choices 배열의 정답 인덱스 (출제 시 보기 순서는 섞인다) */
export interface QuizQuestion {
  q: string
  choices: [string, string, string, string]
  answer: number
}

export const QUESTIONS: Record<Exclude<QuizCategory, 'random'>, QuizQuestion[]> = {
  general: [
    { q: '대한민국의 수도는?', choices: ['서울', '부산', '세종', '인천'], answer: 0 },
    { q: '1년 중 날짜 수가 가장 적은 달은?', choices: ['2월', '4월', '6월', '11월'], answer: 0 },
    { q: '무지개 색 중 빨강 바로 다음 색은?', choices: ['주황', '노랑', '초록', '파랑'], answer: 0 },
    { q: '올림픽 오륜기의 고리는 몇 개인가?', choices: ['5개', '4개', '6개', '7개'], answer: 0 },
    { q: '세계에서 면적이 가장 넓은 나라는?', choices: ['러시아', '캐나다', '중국', '미국'], answer: 0 },
    { q: '피아노의 표준 건반 수는?', choices: ['88개', '76개', '96개', '104개'], answer: 0 },
    { q: '한글을 창제한 조선의 왕은?', choices: ['세종', '태종', '정조', '영조'], answer: 0 },
    { q: '축구 경기에서 한 팀의 선발 출전 인원은?', choices: ['11명', '9명', '10명', '12명'], answer: 0 },
    { q: '태양계에서 가장 큰 행성은?', choices: ['목성', '토성', '해왕성', '지구'], answer: 0 },
    { q: '체스에서 처음에 각 진영이 가진 폰(Pawn)의 수는?', choices: ['8개', '6개', '10개', '16개'], answer: 0 },
    { q: '일본의 화폐 단위는?', choices: ['엔', '위안', '원', '바트'], answer: 0 },
    { q: '세계에서 가장 높은 산은?', choices: ['에베레스트', 'K2', '킬리만자로', '몽블랑'], answer: 0 },
  ],
  it: [
    { q: 'HTTP 상태 코드 404의 의미는?', choices: ['Not Found', 'Forbidden', 'Bad Request', 'Server Error'], answer: 0 },
    { q: '1바이트는 몇 비트인가?', choices: ['8비트', '4비트', '16비트', '32비트'], answer: 0 },
    { q: 'Git에서 원격 저장소의 변경을 가져와 병합까지 하는 명령은?', choices: ['git pull', 'git fetch', 'git push', 'git clone'], answer: 0 },
    { q: 'HTML의 약자에 포함되지 않는 단어는?', choices: ['Program', 'Markup', 'Language', 'HyperText'], answer: 0 },
    { q: 'SQL에서 테이블의 행을 조회하는 키워드는?', choices: ['SELECT', 'UPDATE', 'INSERT', 'DROP'], answer: 0 },
    { q: 'HTTPS의 기본 포트 번호는?', choices: ['443', '80', '8080', '22'], answer: 0 },
    { q: 'JavaScript에서 엄격한 동등 비교 연산자는?', choices: ['===', '==', '=', '!='], answer: 0 },
    { q: 'CSS에서 요소 바깥쪽 여백을 지정하는 속성은?', choices: ['margin', 'padding', 'border', 'gap'], answer: 0 },
    { q: '선입선출(FIFO) 구조를 가진 자료구조는?', choices: ['큐', '스택', '트리', '힙'], answer: 0 },
    { q: 'IPv4 주소는 몇 비트로 구성되는가?', choices: ['32비트', '64비트', '128비트', '16비트'], answer: 0 },
    { q: 'SSH의 기본 포트 번호는?', choices: ['22', '21', '25', '3389'], answer: 0 },
    { q: 'JSON의 J가 의미하는 언어는?', choices: ['JavaScript', 'Java', 'Julia', 'Jython'], answer: 0 },
  ],
  science: [
    { q: '물의 화학식은?', choices: ['H₂O', 'CO₂', 'O₂', 'NaCl'], answer: 0 },
    { q: '빛의 속도는 초속 약 몇 km인가?', choices: ['30만 km', '3만 km', '300만 km', '3천 km'], answer: 0 },
    { q: '사람의 정상 체온에 가장 가까운 값은?', choices: ['36.5℃', '34.0℃', '38.5℃', '40.0℃'], answer: 0 },
    { q: '식물이 빛으로 양분을 만드는 과정은?', choices: ['광합성', '증산 작용', '호흡', '발효'], answer: 0 },
    { q: '원소 기호 Fe가 나타내는 원소는?', choices: ['철', '불소', '금', '납'], answer: 0 },
    { q: '1기압에서 물이 끓는 온도는?', choices: ['100℃', '90℃', '120℃', '80℃'], answer: 0 },
    { q: '지구에서 가장 가까운 별(항성)은?', choices: ['태양', '시리우스', '북극성', '베가'], answer: 0 },
    { q: '사람 성인의 뼈는 대략 몇 개인가?', choices: ['206개', '150개', '310개', '412개'], answer: 0 },
    { q: '소리가 가장 빠르게 전달되는 매질은?', choices: ['고체', '액체', '기체', '진공'], answer: 0 },
    { q: '산성도를 나타내는 척도는?', choices: ['pH', 'dB', 'Hz', 'lx'], answer: 0 },
  ],
  history: [
    { q: '훈민정음이 반포된 해는?', choices: ['1446년', '1392년', '1592년', '1443년'], answer: 0 },
    { q: '임진왜란이 일어난 해는?', choices: ['1592년', '1636년', '1510년', '1419년'], answer: 0 },
    { q: '조선을 건국한 인물은?', choices: ['이성계', '왕건', '정도전', '이방원'], answer: 0 },
    { q: '고려를 건국한 인물은?', choices: ['왕건', '궁예', '견훤', '이성계'], answer: 0 },
    { q: '거북선과 관련이 깊은 인물은?', choices: ['이순신', '권율', '강감찬', '을지문덕'], answer: 0 },
    { q: '프랑스 혁명이 시작된 해는?', choices: ['1789년', '1776년', '1815년', '1848년'], answer: 0 },
    { q: '최초로 달에 착륙한 유인 우주선 임무는?', choices: ['아폴로 11호', '아폴로 13호', '보스토크 1호', '제미니 4호'], answer: 0 },
    { q: '고구려의 수도가 아니었던 곳은?', choices: ['경주', '졸본', '국내성', '평양'], answer: 0 },
    { q: '신라가 삼국을 통일한 시기는 몇 세기인가?', choices: ['7세기', '5세기', '9세기', '10세기'], answer: 0 },
    { q: '제2차 세계대전이 끝난 해는?', choices: ['1945년', '1939년', '1950년', '1918년'], answer: 0 },
  ],
}
