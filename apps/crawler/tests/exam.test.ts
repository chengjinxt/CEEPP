import { describe, expect, it } from 'vitest';
import {
  EXAM_REGIONS,
  EXAM_SUBJECTS,
  normalizeRegion,
  normalizeResourceKind,
  normalizeSeries,
  normalizeSubject,
  normalizeSubjectRole,
  seriesRegions,
} from '@ceepp/shared/exam';

describe('exam taxonomy', () => {
  it('uses the 31 mainland provincial-level regions and normalizes full names', () => {
    expect(EXAM_REGIONS).toHaveLength(31);
    expect(new Set(EXAM_REGIONS).size).toBe(31);
    expect(normalizeRegion('北京市')).toBe('北京');
    expect(normalizeRegion('广西壮族自治区')).toBe('广西');
    expect(normalizeRegion('香港特别行政区')).toBeNull();
  });

  it('normalizes series, subjects, and 3+1+2 subject roles', () => {
    expect(normalizeSeries('新高考Ⅰ卷')).toBe('全国一卷');
    expect(normalizeSeries('新高考 I 卷')).toBe('全国一卷');
    expect(normalizeSeries('全国2卷')).toBe('全国二卷');
    expect(normalizeSeries('全国II卷')).toBe('全国二卷');
    expect(normalizeSubject('政治')).toBe('思想政治');
    expect(normalizeSubject('生物')).toBe('生物学');
    expect(EXAM_SUBJECTS).toContain('文科综合');
    expect(normalizeSubjectRole('物理')).toBe('first_choice');
    expect(normalizeSubjectRole('化学')).toBe('second_choice');
    expect(normalizeSubjectRole('物理', { elective: true })).toBe('elective');
  });

  it('limits national-series presets by year and subject role', () => {
    expect(seriesRegions(2025, '全国一卷', 'unified')).toHaveLength(11);
    expect(seriesRegions(2026, '全国二卷', 'unified')).toHaveLength(17);
    expect(seriesRegions(2026, '全国二卷', 'integrated')).toEqual(['西藏', '新疆']);
    expect(seriesRegions(2025, '全国二卷', 'integrated')).toEqual([]);
    expect(seriesRegions(2026, '全国二卷', 'first_choice')).toEqual([]);
    expect(seriesRegions(2024, '全国一卷', 'unified')).toEqual([]);
  });

  it('distinguishes questions, answers, analyses, and listening formats', () => {
    expect(normalizeResourceKind('试卷：', '数学试卷.pdf')).toBe('question');
    expect(normalizeResourceKind('答案：', '数学答案.pdf')).toBe('answer');
    expect(normalizeResourceKind('答案：', '数学解析.pdf')).toBe('analysis');
    expect(normalizeResourceKind('', '试题及答案.pdf')).toBe('question_with_answer');
    expect(normalizeResourceKind('听力：', '英语听力.pdf', 'https://files.example/listening.pdf')).toBe('listening_paper');
    expect(normalizeResourceKind('听力：', '英语听力.mp3', 'https://files.example/listening.mp3')).toBe('listening_audio');
  });
});
