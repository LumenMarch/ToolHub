import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Database } from 'lucide-react';

import api from '@/api/axios';
import FileDropZone from '@/components/FileDropZone';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTusUpload } from '@/hooks/useTusUpload';
import { llmUnavailableReason, useLlmStatus } from '@/hooks/useLlmStatus';
import { LoadingSignal } from '@/components/LoadingSignal';
import type { HistogramMode } from './charts';
import type { AnalysisContext, Bin, Stats } from './lib';
import { makeAnalysisContext } from './analysisWiring';
import { streamTtTimeAnalysis } from './analysisStream';
import type { ActiveModule, BackendProcessResponse, Phase } from './types';
import { TtTimeReadyView } from './TtTimeReadyView';

const DEFAULT_BIN_WIDTH = 10;

const TtTimeTool: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('upload');
  const [activeModule, setActiveModule] = useState<ActiveModule>('distribution');
  const [currentUploadId, setCurrentUploadId] = useState('');
  const [fileName, setFileName] = useState('');
  const [processData, setProcessData] = useState<BackendProcessResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  // 参数变化后的页内重算：结果页保持挂载，只叠加提示，避免卸载正在编辑的表单
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [mode, setMode] = useState<HistogramMode>('percent');
  const [binWidthStr, setBinWidthStr] = useState(String(DEFAULT_BIN_WIDTH));
  const [station, setStation] = useState('all');
  const [excludeFail, setExcludeFail] = useState(true);
  // 流式过程中已到达的正文
  const [streamingAdvice, setStreamingAdvice] = useState('');
  const processGenRef = useRef(0);
  // 流式中止句柄：每次 mutation 各持一个 controller，reset / 重选文件 /
  // 卸载统一经它掐掉旧流，防止旧正文继续写进新数据集的渲染区
  const adviceAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      adviceAbortRef.current?.abort();
    },
    [],
  );

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
        setIsRecomputing(false);
        setPhase('ready');
      } catch (err: unknown) {
        if (gen !== processGenRef.current) return;
        setIsRecomputing(false);
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
      // 只登记结果，请求交给下面的单一驱动点：这里再发一次会让同一 uploadId 被重复全量计算
      setCurrentUploadId(uploadId);
      setPhase('analyzing');
    },
    onError: (err) => {
      setErrorMessage(err.message || '文件上传失败');
      setPhase('upload');
    },
  });

  const onFileSelect = (file: File) => {
    stopAdviceStream();
    setFileName(file.name);
    setErrorMessage('');
    setProcessData(null);
    setStation('all');
    setExcludeFail(true);
    setPhase('upload');
    // 同一文件命中服务端缓存时 uploadId 会复用，必须清掉去重键才能重新触发处理
    lastProcessedRef.current = '';
    // 立刻清掉旧数据集的 uploadId：否则 station/excludeFail 被重置会让驱动 effect
    // 重跑，用上一个 uploadId 发请求，把旧数据集的图表当成"新文件的结果"展示，
    // 还会在上传期间把界面切到 analyzing、盖掉上传进度。
    setCurrentUploadId('');
    // 在途的旧响应同样不能再落地
    processGenRef.current += 1;
    void tusUpload.upload({ file, metadata: { filename: file.name } });
  };

  // 后端处理的单一驱动点：上传完成或参数变化后重新计算。
  // ① 去重键含参数，处理完成把 phase 置回 ready 不会再次触发同一 uploadId 的
  //    全量计算（旧实现因此对每次上传都发两遍相同请求）；
  // ② 300ms 定时器把分箱宽度输入期间的逐字触发收敛成一次请求。
  const lastProcessedRef = useRef('');
  useEffect(() => {
    if (!currentUploadId) return;
    const key = `${currentUploadId}|${binWidth}|${station}|${excludeFail}`;
    if (lastProcessedRef.current === key) return;
    const timer = window.setTimeout(() => {
      // 只有上传后的首次计算才切整页 analyzing；参数变化必须保持结果页挂载，
      // 否则分箱宽度输入框会被卸载，用户打字打到一半的字符直接丢失。
      const isFirstRun = lastProcessedRef.current === '';
      lastProcessedRef.current = key;
      if (isFirstRun) {
        setPhase('analyzing');
      } else {
        setIsRecomputing(true);
      }
      void runBackendProcess(currentUploadId, {
        binWidthVal: binWidth,
        stationVal: station,
        excludeFailVal: excludeFail,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [currentUploadId, binWidth, station, excludeFail, runBackendProcess]);

  // I-3：处理失败必须可见且可重试。原实现只在去重键上做一次性请求，
  // 失败后既没有提示也没有重试入口，用户只能重传整个文件。
  const retryProcess = () => {
    if (!currentUploadId) return;
    lastProcessedRef.current = `${currentUploadId}|${binWidth}|${station}|${excludeFail}`;
    setErrorMessage('');
    setIsRecomputing(true);
    void runBackendProcess(currentUploadId, {
      binWidthVal: binWidth,
      stationVal: station,
      excludeFailVal: excludeFail,
    });
  };

  const reset = () => {
    stopAdviceStream();
    tusUpload.reset();
    setPhase('upload');
    setCurrentUploadId('');
    lastProcessedRef.current = '';
    setProcessData(null);
    setFileName('');
    setStation('all');
    setExcludeFail(true);
    setActiveModule('distribution');
    setErrorMessage('');
    // 重置期间在途的旧响应不得再把界面拉回旧结果页
    processGenRef.current += 1;
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
    // 流式消费：思考类模型要先思考几百 token 才吐正文，一次性等就是十几秒空白。
    // onDelta 直接把正文片段追到 streamingAdvice，边生成边渲染。
    mutationFn: (ctx: AnalysisContext) => {
      const controller = new AbortController();
      adviceAbortRef.current = controller;
      return streamTtTimeAnalysis(ctx, {
        onDelta: (text) => setStreamingAdvice((prev) => prev + text),
        signal: controller.signal,
      });
    },
    onMutate: () => {
      setStreamingAdvice('');
    },
  });

  // reset / 重选文件时掐掉旧流：reset() 清掉失败态，AbortError 不会残留成
  // 下个数据集界面上的红色告警
  const stopAdviceStream = useCallback(() => {
    adviceAbortRef.current?.abort();
    adviceAbortRef.current = null;
    setStreamingAdvice('');
    adviceMutation.reset();
  }, [adviceMutation]);

  // 模型服务不可用时直接把按钮置灰并说明原因，而不是让用户填完参数点下去才吃个 503
  const { data: llmStatus } = useLlmStatus();
  const llmBlockedReason = llmUnavailableReason(llmStatus);

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
    <div className="flex flex-col gap-4">
      {isRecomputing ? (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
          <LoadingSignal label="重算中" ariaLabel="后端正在按新参数重新计算" />
          <span>正在按新参数重新计算...</span>
        </div>
      ) : null}
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center gap-3">
            {errorMessage}
            <Button variant="outline" size="sm" onClick={retryProcess}>
              重新计算
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
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
      streamingAdvice={streamingAdvice}
        llmBlockedReason={llmBlockedReason}
      />
    </div>
  );
};

export default TtTimeTool;
