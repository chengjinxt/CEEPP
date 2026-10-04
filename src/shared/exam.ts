export type OriginType = 'national' | 'provincial' | 'joint' | 'unknown';
export type SubjectRole = 'unified' | 'first_choice' | 'second_choice' | 'elective' | 'integrated' | 'other';
export type ResourceKind =
  | 'question'
  | 'answer'
  | 'question_with_answer'
  | 'analysis'
  | 'listening_paper'
  | 'listening_audio'
  | 'other';

export const EXAM_REGIONS = [
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
  '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
  '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州',
  '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆',
] as const;

export const EXAM_SUBJECTS = [
  '语文', '数学', '英语', '日语', '俄语', '德语', '法语', '西班牙语',
  '物理', '历史', '化学', '地理', '思想政治', '生物学', '文科综合', '理科综合',
] as const;

export const ORIGIN_TYPE_LABELS: Record<OriginType, string> = {
  national: '全国统一命题',
  provincial: '省级自主命题',
  joint: '多地联合命题',
  unknown: '待核对',
};

export const SUBJECT_ROLE_LABELS: Record<SubjectRole, string> = {
  unified: '全国统考科目',
  first_choice: '首选科目',
  second_choice: '再选科目',
  elective: '选考科目',
  integrated: '综合科目',
  other: '其他',
};

export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  question: '试卷',
  answer: '答案',
  question_with_answer: '试卷及答案',
  analysis: '解析',
  listening_paper: '听力材料',
  listening_audio: '听力音频',
  other: '其他',
};

const NATIONAL_ONE_REGIONS = [
  '浙江', '江苏', '山东', '广东', '河北', '福建', '湖北', '湖南', '河南', '江西', '安徽',
] as const;
const NATIONAL_TWO_REGIONS = [
  '辽宁', '重庆', '海南', '山西', '云南', '贵州', '黑龙江', '吉林', '甘肃', '广西', '西藏', '新疆', '四川', '陕西', '内蒙古', '宁夏', '青海',
] as const;

const REGION_ALIASES: Record<string, string> = {
  '内蒙古自治区': '内蒙古', '广西壮族自治区': '广西', '西藏自治区': '西藏',
  '宁夏回族自治区': '宁夏', '新疆维吾尔自治区': '新疆',
};

export function normalizeRegion(value: string): string | null {
  const compact = value.trim().replace(/\s+/g, '');
  const normalized = REGION_ALIASES[compact] ?? compact.replace(/(?:特别行政区|省|市|自治区)$/u, '');
  return (EXAM_REGIONS as readonly string[]).includes(normalized) ? normalized : null;
}

export function normalizeRegions(values: string | readonly string[]): string[] {
  const chunks = typeof values === 'string' ? values.split(/[\s、,，/]+/) : values;
  const result: string[] = [];
  for (const value of chunks) {
    const region = normalizeRegion(value);
    if (region && !result.includes(region)) result.push(region);
  }
  return result;
}

export function normalizeSeries(value: string): string {
  const compact = value.trim().replace(/\s+/g, '');
  if (/(?:全国|新高考|新课标)[^一-龥]*(?:1|Ⅰ|一)(?:卷)?/u.test(compact)) return '全国一卷';
  if (/(?:全国|新高考|新课标)[^一-龥]*(?:2|Ⅱ|二)(?:卷)?/u.test(compact)) return '全国二卷';
  const region = normalizeRegion(compact.replace(/卷$/u, ''));
  return region ? `${region}卷` : compact;
}

export function normalizeSubject(value: string): string | null {
  const compact = value.trim().replace(/\s+/g, '');
  const aliases: Record<string, string> = {
    '政治': '思想政治', '生物': '生物学', '文综': '文科综合', '理综': '理科综合',
    '外语': '英语',
  };
  const normalized = aliases[compact] ?? compact;
  return (EXAM_SUBJECTS as readonly string[]).includes(normalized) ? normalized : null;
}

export function normalizeSubjectRole(subject: string, options: { elective?: boolean } = {}): SubjectRole {
  const normalized = normalizeSubject(subject);
  if (!normalized) return 'other';
  if (['语文', '数学', '英语', '日语', '俄语', '德语', '法语', '西班牙语'].includes(normalized)) return 'unified';
  if (['文科综合', '理科综合'].includes(normalized)) return 'integrated';
  if (options.elective) return 'elective';
  if (['物理', '历史'].includes(normalized)) return 'first_choice';
  if (['化学', '地理', '思想政治', '生物学'].includes(normalized)) return 'second_choice';
  return 'other';
}

export function normalizeResourceKind(label: string, title = '', url = ''): ResourceKind {
  const text = `${label}${title}`;
  if (/听力/u.test(text)) return /\.mp3(?:$|[?#])/iu.test(url) || /\.mp3$/iu.test(title) ? 'listening_audio' : 'listening_paper';
  if (/解析|题解/u.test(text)) return 'analysis';
  if (/(?:及|和|\+|含)答案/u.test(text)) return 'question_with_answer';
  if (/^答案|参考答案|权威答案/u.test(text)) return 'answer';
  if (/^试卷|试题|真题/u.test(text)) return 'question';
  return 'other';
}

export function seriesRegions(year: number, series: string, subjectRole: SubjectRole): string[] {
  if ((year !== 2025 && year !== 2026) || subjectRole !== 'unified') return [];
  const normalized = normalizeSeries(series);
  if (normalized === '全国一卷') return [...NATIONAL_ONE_REGIONS];
  if (normalized === '全国二卷') return [...NATIONAL_TWO_REGIONS];
  return [];
}

