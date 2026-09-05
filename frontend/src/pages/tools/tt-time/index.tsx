import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Database } from 'lucide-react';

import api from '@/api/axios';
import FileDropZone from '@/components/FileDropZone';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTusUpload } from '@/hooks/useTusUpload';
import { LoadingSignal } from '@/components/LoadingSignal';
import type { HistogramMode } from './charts';
import type { AnalysisContext, Bin, Stats } from './lib';
import { makeAnalysisContext } from './analysisWiring';
import type { ActiveModule, AnalysisResult, BackendProcessResponse, Phase } from './types';
import { TtTimeReadyView } from './TtTimeReadyView';

const DEFAULT_BIN_WIDTH = 10;

const TtTimeTool: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('upload');
  const [activeModule, setActiveModule] = useState<ActiveModule>('distribution');
  const [currentUploadId, setCurrentUploadId] = useState('');
  const [fileName, setFileName] = useState('');
  const [processData, setProcessData] = useState<BackendProcessResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [mode, setMode] = useState<HistogramMode>('percent');
  const [binWidthStr, setBinWidthStr] = useState(String(DEFAULT_BIN_WIDTH));
  const [station, setStation] = useState('all');
  const [excludeFail, setExcludeFail] = useState(true);
  const processGenRef = useRef(0);

  const binWidth = useMemo(() => {
    const n = Number(binWidthStr.trim());
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_BIN_WIDTH;
  }, [binWidthStr]);

  const runBackendProcess = useCallback(
    async (
      uploadId: string,
      options: { binWidthVal: number; stationVal: string; excludeFailVal: boolean },
    ) => {
      if (!uploadId) return;
      const gen = ++processGenRef.current;
      setErrorMessage('');
      try {
        const res = await api.post<BackendProcessResponse>('/tools/tt-time/process', {
          upload_id: uploadId,
          bin_width: options.binWidthVal,
          station_filter: options.stationVal,
          exclude_fail: options.excludeFailVal,
        });
        if (gen !== processGenRef.current) return;
        setProcessData(res.data);
        setPhase('ready');
      } catch (err: unknown) {
        if (gen !== processGenRef.current) return;
        const msg =
          err instanceof Error
            ? err.message
            : (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
              '后端数据处理失败';
        setErrorMessage(String(msg));
        setPhase('ready');
      }
    },
    [],
  );

  const tusUpload = useTusUpload({
    onSuccess: (uploadId) => {
      setCurrentUploadId(uploadId);
      setPhase('analyzing');
      void runBackendProcess(uploadId, {
        binWidthVal: binWidth,
        stationVal: station,
        excludeFailVal: excludeFail,
      });
    },
    onError: (err) => {
      setErrorMessage(err.message || '文件上传失败');
      setPhase('upload');
    },
  });

  const onFileSelect = (file: File) => {
    setFileName(file.name);
    setErrorMessage('');
    setProcessData(null);
    setStation('all');
    setExcludeFail(true);
    setPhase('upload');
    void tusUpload.upload({ file, metadata: { filename: file.name } });
  };

  useEffect(() => {
    if (!currentUploadId || phase !== 'ready') return;
    void runBackendProcess(currentUploadId, {
      binWidthVal: binWidth,
      stationVal: station,
      excludeFailVal: excludeFail,
    });
  }, [currentUploadId, binWidth, station, excludeFail, runBackendProcess, phase]);

  const reset = () => {
    tusUpload.reset();
    setPhase('upload');
    setCurrentUploadId('');
    setProcessData(null);
    setFileName('');
    setStation('all');
    setExcludeFail(true);
    setActiveModule('distribution');
    setErrorMessage('');
  };

  const stations = processData?.stations ?? [];
  const allStationBoxGroups = processData?.stationBoxGroups ?? [];
  const stats: Stats =
    processData?.stats ?? { count: 0, min: NaN, max: NaN, q1: NaN, q2: NaN, q3: NaN };
  const bins: Bin[] = processData?.bins ?? [];

  // 使用后端真实 mean/percentiles/tail，绝不从五数总结伪造 tts
  const analysisContext: AnalysisContext | null = useMemo(
    () => makeAnalysisContext(processData, fileName, station),
    [processData, fileName, station],
  );

  const adviceMutation = useMutation({
    mutationFn: (ctx: AnalysisContext) =>
      api.post<AnalysisResult>('/tools/tt-time/analyze', ctx).then((r) => r.data),
  });

  if (phase === 'upload' || phase === 'analyzing') {
    const isUploading = tusUpload.status === 'uploading';
    const progress = Math.round(tusUpload.progress);
    return (
      <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>上传测试日志</CardTitle>
            <CardDescription>
              支持超大数据文件秒级解析，采用 Polars 高性能多线程计算引擎。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FileDropZone
              id="tt-time-file"
              label="测试日志文件"
              description="拖拽或点击选择 Export-*.csv、.xlsx 或 .xls 文件"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              file={null}
              disabled={isUploading || phase === 'analyzing'}
              onSelect={onFileSelect}
            />
            {isUploading ? (
              <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>正在极速上传文件...</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ) : null}
            {phase === 'analyzing' ? (
              <div className="flex items-center justify-center gap-3 py-6 text-sm text-muted-foreground">
                <LoadingSignal label="分析中" ariaLabel="后端 Polars 引擎正在分析数据" />
                <span>后端 Polars 引擎正在多线程分析数据...</span>
              </div>
            ) : null}
            {errorMessage ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Database className="size-4 shrink-0" />
              支持列：Station ID、StartTime、EndTime、Test Pass/Fail Status（可选）
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TtTimeReadyView
      fileName={fileName}
      processData={processData}
      activeModule={activeModule}
      setActiveModule={setActiveModule}
      reset={reset}
      excludeFail={excludeFail}
      setExcludeFail={setExcludeFail}
      mode={mode}
      setMode={setMode}
      binWidthStr={binWidthStr}
      setBinWidthStr={setBinWidthStr}
      station={station}
      setStation={setStation}
      stations={stations}
      allStationBoxGroups={allStationBoxGroups}
      stats={stats}
      bins={bins}
      analysisContext={analysisContext}
      adviceMutation={adviceMutation}
    />
  );
};

export default TtTimeTool;
