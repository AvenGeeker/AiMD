import { describe, expect, it } from 'vitest';
import { plainExcerpt } from './excerpt.js';

describe('plainExcerpt', () => {
  it('keeps prose that carries no markup', () => {
    expect(plainExcerpt('提醒她体检报告要带上。')).toBe('提醒她体检报告要带上。');
  });

  it('strips a leading heading marker from the collapsed single line', () => {
    expect(plainExcerpt('# 产品周会纪要 讨论了三个方向。 - 多选 - 左划')).toBe(
      '产品周会纪要 讨论了三个方向。 多选 左划',
    );
  });

  it('drops the duplicated title prefix', () => {
    expect(plainExcerpt('# 产品周会纪要 讨论了三个方向。', '产品周会纪要')).toBe('讨论了三个方向。');
  });

  it('removes code fences but keeps the code text', () => {
    expect(plainExcerpt('```bash make backup ``` 每周日凌晨跑一次。')).toBe(
      'bash make backup 每周日凌晨跑一次。',
    );
  });

  it('unwraps inline emphasis, links and images', () => {
    expect(plainExcerpt('**重点** 和 [链接](https://a.b) 与 ![图](https://a.b/i.png)')).toBe(
      '重点 和 链接 与 图',
    );
    expect(plainExcerpt('`code` 与 _斜体_')).toBe('code 与 斜体');
  });

  it('collapses the whitespace left behind', () => {
    expect(plainExcerpt('# 标题   - 一条   > 引用')).toBe('标题 一条 引用');
  });
});
