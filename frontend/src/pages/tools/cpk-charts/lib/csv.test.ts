import { describe, expect, it } from 'bun:test';
import { parseTestCsv } from './csv';
import { DEFAULT_CHART_SETTINGS, formatHistogramTopLabel } from './stats';
import { getActive } from '../store/useOppStore';

describe('cpk-charts 通过 Test Pass/Fail Status 列判断去除不良', () => {
  const sampleCsv = `Site,Product,Serial Number,Test Pass/Fail Status,Voltage,Current
Lower Limit,,,,3.0,0.1
Upper Limit,,,,5.0,0.5
Measurement Unit,,,,V,A
Site1,Prod1,SN001,PASS,3.5,0.2
Site1,Prod1,SN002,FAIL,9.9,0.9
Site1,Prod1,SN003,PASS,3.6,0.25
Site1,Prod1,SN004,FAIL,1.0,0.05
Site1,Prod1,SN005,PASS,3.7,0.3
`;

  it('通过 Test Pass/Fail Status 列准确记录每行测试状态', () => {
    const ds = parseTestCsv(sampleCsv, 'test.csv');
    expect(ds.columns.length).toBe(2); // Voltage, Current
    expect(ds.records).toBe(5);
    expect(ds.statusList).toBeDefined();
    expect(ds.statusList).toEqual(['PASS', 'FAIL', 'PASS', 'FAIL', 'PASS']);
    expect(ds.statusColumn).toBe(3);
    expect(ds.hasFailRecords).toBe(true);
  });

  it('在去除不良(excludeFail=true)时仅保留 PASS 行参与指标与分布计算', () => {
    const ds = parseTestCsv(sampleCsv, 'test.csv');
    const settings = { ...DEFAULT_CHART_SETTINGS };

    // 1. 不去除不良 (excludeFail = false): 5 条数据全部参与
    const activeAll = getActive(ds, 'Voltage', settings, false);
    expect(activeAll).not.toBeNull();
    expect(activeAll?.analysis.stat.count).toBe(5);

    // 2. 去除不良 (excludeFail = true): 仅 3 条 PASS 数据 (3.5, 3.6, 3.7) 参与
    const activePassOnly = getActive(ds, 'Voltage', settings, true);
    expect(activePassOnly).not.toBeNull();
    expect(activePassOnly?.analysis.stat.count).toBe(3);
    expect(activePassOnly?.analysis.stat.min).toBe(3.5);
    expect(activePassOnly?.analysis.stat.max).toBe(3.7);
    expect(activePassOnly?.analysis.stat.mean).toBe(3.6);
  });

  describe('formatHistogramTopLabel 百分比模式柱顶文字', () => {
    it('百分比模式下 0 不要显示在柱子上，返回空串', () => {
      expect(formatHistogramTopLabel(0, 0, true)).toBe('');
      expect(formatHistogramTopLabel(1, 0.4, true)).toBe('');
      expect(formatHistogramTopLabel(1, 0.1, true)).toBe('');
    });

    it('百分比模式下大于等于 0.5% 四舍五入为正整数显示', () => {
      expect(formatHistogramTopLabel(10, 0.5, true)).toBe('1');
      expect(formatHistogramTopLabel(50, 4.8, true)).toBe('5');
      expect(formatHistogramTopLabel(100, 20.0, true)).toBe('20');
    });

    it('Count 数量模式下显示实际数量', () => {
      expect(formatHistogramTopLabel(12, 12.5, false)).toBe('12');
      expect(formatHistogramTopLabel(0, 0, false)).toBe('0');
    });
  });
});
