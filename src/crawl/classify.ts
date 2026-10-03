import type { Candidate } from './types';

const regions = [
  '北京', '天津', '上海', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江',
  '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南',
  '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '台湾',
  '内蒙古', '广西', '西藏', '宁夏', '新疆', '香港', '澳门',
];

export function fileFormat(name: string): string | null {
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return extension && ['pdf', 'html', 'htm', 'doc', 'docx', 'zip'].includes(extension)
    ? extension.toUpperCase()
    : null;
}

export function classifyFile(name: string): Candidate['classification'] | null {
  const format = fileFormat(name);
  if (!format || /春季|春考|春招|单招/.test(name)) return null;
  if (/参考答案|权威答案|答案解析|解析版|题解|答案[（(]|试题答案/.test(name)) return null;
  if (/答案/.test(name) && !/(?:及|和|\+|含)答案/.test(name)) return null;
  return format === 'ZIP' || /(?:及|和|\+|含)答案|解析|部分|回忆版|实验题/.test(name)
    ? 'uncertain'
    : 'ordinary';
}

export function regionsInText(text: string): string[] {
  const ordered = regions
    .map((name) => ({ name, index: text.indexOf(name) }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index)
    .map(({ name }) => name);
  return [...new Set(ordered)];
}

export function inferSeries(text: string): {
  scope: Candidate['scope']; series: string | null; regions: string[];
} {
  const short = text.replace(/\.[^.]+$/, '').replace(/^\d{4}(?:年)?/, '').replace(/[（(].*$/, '')
    .replace(/[文理]$/, '').trim();
  const national = /全国|新课标|新高考|大纲|旧课程|外语小语种/.test(short);
  if (national) {
    const match = short.match(/全国\s*([12一二ⅠⅡ])/);
    const number = match?.[1];
    const series = number
      ? `全国${/[1一Ⅰ]/.test(number) ? '一' : '二'}卷`
      : short.endsWith('卷') ? short : `${short}卷`;
    return { scope: 'national', series, regions: [] };
  }
  const matches = regionsInText(short);
  if (matches.length === 1) {
    return { scope: 'regional', series: `${matches[0]}卷`, regions: matches };
  }
  return { scope: null, series: short || null, regions: matches };
}
