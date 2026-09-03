import { describe, expect, it } from 'bun:test';
import * as XLSX from 'xlsx';
import {
  buildStationComparisonTable,
  computeStationBoxGroups,
  formatStationNumericName,
  getStationQ3ComparisonData,
  parseExcelBuffer,
  parseTestFile,
  parseTestRows,
  parseTestTimestamp,
} from './lib';

describe('tt-time lib', () => {
  describe('parseTestTimestamp', () => {
    it('解析标准日期时间字符串', () => {
      const ts = parseTestTimestamp('2024/05/01 10:20:30');
      expect(Number.isFinite(ts)).toBe(true);
      const d = new Date(ts);
      expect(d.getFullYear()).toBe(2024);
      expect(d.getMonth()).toBe(4);
      expect(d.getDate()).toBe(1);
      expect(d.getHours()).toBe(10);
      expect(d.getMinutes()).toBe(20);
      expect(d.getSeconds()).toBe(30);
    });

    it('解析带有短横线的日期时间字符串', () => {
      const ts = parseTestTimestamp('2024-05-01 10:20:30.500');
      expect(Number.isFinite(ts)).toBe(true);
      const d = new Date(ts);
      expect(d.getFullYear()).toBe(2024);
      expect(d.getMilliseconds()).toBe(500);
    });

    it('支持 Date 对象或 ISO 字符串 / Excel 日期解析', () => {
      const date = new Date('2024-05-01T10:20:30Z');
      expect(parseTestTimestamp(date)).toBe(date.getTime());
    });
  });

  describe('parseTestRows (CSV)', () => {
    it('正确解析包含 Station ID, StartTime, EndTime 的 CSV', () => {
      const csv = `Title,Test Export
Station ID,StartTime,EndTime,Test Pass/Fail Status
ST01,2024-05-01 10:00:00,2024-05-01 10:00:15,PASS
ST02,2024-05-01 10:00:00,2024-05-01 10:00:25,FAIL
`;
      const result = parseTestRows(csv);
      expect(result.rows.length).toBe(2);
      expect(result.rows[0]).toEqual({
        stationId: 'ST01',
        tt: 15,
        status: 'PASS',
      });
      expect(result.rows[1]).toEqual({
        stationId: 'ST02',
        tt: 25,
        status: 'FAIL',
      });
      expect(result.invalid).toBe(0);
    });
  });

  describe('parseExcelBuffer (XLSX & XLS)', () => {
    it('正确解析 XLSX 格式的 Buffer 数据', () => {
      const wsData = [
        ['Export Header Meta'],
        ['Station ID', 'StartTime', 'EndTime', 'Test Pass/Fail Status'],
        ['ST01', '2024-05-01 10:00:00', '2024-05-01 10:00:20', 'PASS'],
        ['ST02', '2024-05-01 10:00:00', '2024-05-01 10:00:30', 'PASS'],
        ['ST03', '2024-05-01 10:00:00', '2024-05-01 10:00:10', 'FAIL'],
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const result = parseExcelBuffer(buffer);
      expect(result.rows.length).toBe(3);
      expect(result.rows[0].stationId).toBe('ST01');
      expect(result.rows[0].tt).toBe(20);
      expect(result.rows[1].stationId).toBe('ST02');
      expect(result.rows[1].tt).toBe(30);
      expect(result.rows[2].stationId).toBe('ST03');
      expect(result.rows[2].tt).toBe(10);
      expect(result.rows[2].status).toBe('FAIL');
    });

    it('正确解析数字类型 Station ID 和 Date 对象的 Excel 表格', () => {
      const wsData = [
        ['Station ID', 'StartTime', 'EndTime', 'Test Pass/Fail Status'],
        [101, new Date(2024, 4, 1, 10, 0, 0), new Date(2024, 4, 1, 10, 0, 45), 'PASS'],
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const result = parseExcelBuffer(buffer);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].stationId).toBe('101');
      expect(result.rows[0].tt).toBe(45);
      expect(result.rows[0].status).toBe('PASS');
    });

    it('正确解析 XLS 格式的二进制数据', () => {
      const wsData = [
        ['Metadata Row'],
        ['Station ID', 'StartTime', 'EndTime', 'Test Pass/Fail Status'],
        ['Line1_ST01', '2024-05-01 08:00:00', '2024-05-01 08:00:18', 'PASS'],
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = XLSX.write(wb, { type: 'array', bookType: 'xls' });

      const result = parseExcelBuffer(buffer);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].stationId).toBe('Line1_ST01');
      expect(result.rows[0].tt).toBe(18);
    });
  });

  describe('parseTestFile', () => {
    it('能够自动识别并解析 File (xlsx)', async () => {
      const wsData = [
        ['Station ID', 'StartTime', 'EndTime'],
        ['ST_XLSX', '2024-05-01 12:00:00', '2024-05-01 12:00:50'],
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const file = new File([buffer], 'export_data.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const result = await parseTestFile(file);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].stationId).toBe('ST_XLSX');
      expect(result.rows[0].tt).toBe(50);
    });

    it('能够自动识别并解析 File (csv)', async () => {
      const csv = `Station ID,StartTime,EndTime\nST_CSV,2024-05-01 12:00:00,2024-05-01 12:00:30`;
      const file = new File([csv], 'export_data.csv', { type: 'text/csv' });

      const result = await parseTestFile(file);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].stationId).toBe('ST_CSV');
      expect(result.rows[0].tt).toBe(30);
    });
  });
  describe('formatStationNumericName', () => {
    it('正确解析如 FLDG_FQ3-4FT-01B_15_HILO1 这种复合机台名称中的机台号 15', () => {
      expect(formatStationNumericName('FLDG_FQ3-4FT-01B_15_HILO1')).toBe('15');
      expect(formatStationNumericName('FLDG_FQ3-4FT-01B_02_HILO1')).toBe('2');
      expect(formatStationNumericName('FLDG_FQ3-4FT-01B_1_HILO1')).toBe('1');
      expect(formatStationNumericName('FLDG_FQ3-4FT-01B_48_HILO1')).toBe('48');
    });

    it('正确将各种常见机台编号提取为纯数字', () => {
      expect(formatStationNumericName('1')).toBe('1');
      expect(formatStationNumericName('01')).toBe('1');
      expect(formatStationNumericName('ST01')).toBe('1');
      expect(formatStationNumericName('ST-48')).toBe('48');
      expect(formatStationNumericName('Station 15')).toBe('15');
      expect(formatStationNumericName('Station_003')).toBe('3');
      expect(formatStationNumericName('Line1_ST02')).toBe('2');
    });

    it('纯非数字字符串时保留原样', () => {
      expect(formatStationNumericName('StationA')).toBe('StationA');
    });
  });

  describe('computeStationBoxGroups 排序', () => {
    it('按照提取出的纯数字从小到大严格数值升序排序', () => {
      const rows = [
        { stationId: 'FLDG_FQ3-4FT-01B_15_HILO1', tt: 200 },
        { stationId: 'FLDG_FQ3-4FT-01B_2_HILO1', tt: 190 },
        { stationId: 'FLDG_FQ3-4FT-01B_01_HILO1', tt: 185 },
        { stationId: 'FLDG_FQ3-4FT-01B_48_HILO1', tt: 210 },
        { stationId: 'FLDG_FQ3-4FT-01B_10_HILO1', tt: 195 },
      ];
      const groups = computeStationBoxGroups(rows);
      // 机台号顺序必须为: 1, 2, 10, 15, 48
      const numericNames = groups.map((g) => formatStationNumericName(g.stationId));
      expect(numericNames).toEqual(['1', '2', '10', '15', '48']);
    });
  });

  describe('机台数据对比 (buildStationComparisonTable & getStationQ3ComparisonData)', () => {
    const sampleRows = [
      { stationId: '1', tt: 184 },
      { stationId: '1', tt: 186 },
      { stationId: '1', tt: 186 },
      { stationId: '1', tt: 187 },
      { stationId: '1', tt: 192 },
      { stationId: '2', tt: 183 },
      { stationId: '2', tt: 186 },
      { stationId: '2', tt: 188 },
      { stationId: '2', tt: 189 },
      { stationId: '2', tt: 191 },
    ];

    it('正确生成对比表格数据行（最大值、Q3、Med、Q1、最小值）', () => {
      const groups = computeStationBoxGroups(sampleRows);
      const table = buildStationComparisonTable(groups);
      expect(table.stations).toEqual(['1', '2']);
      expect(table.rows.length).toBe(5);
      expect(table.rows.map((r) => r.label)).toEqual(['最大值', 'Q3', 'Med', 'Q1', '最小值']);
      // 机台 1
      expect(table.rows[0].values['1']).toBe(192);
      expect(table.rows[1].values['1']).toBe(187);
      expect(table.rows[2].values['1']).toBe(186);
      expect(table.rows[3].values['1']).toBe(186);
      expect(table.rows[4].values['1']).toBe(184);
      // 机台 2
      expect(table.rows[0].values['2']).toBe(191);
      expect(table.rows[1].values['2']).toBe(189);
      expect(table.rows[2].values['2']).toBe(188);
      expect(table.rows[3].values['2']).toBe(186);
      expect(table.rows[4].values['2']).toBe(183);
    });

    it('正确提取机台 Q3 序列用于折线图', () => {
      const groups = computeStationBoxGroups(sampleRows);
      const q3Data = getStationQ3ComparisonData(groups);
      expect(q3Data.stations).toEqual(['1', '2']);
      expect(q3Data.q3Values).toEqual([187, 189]);
    });
  });
});
