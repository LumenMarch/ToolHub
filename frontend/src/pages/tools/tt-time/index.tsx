import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import api from '@/api/axios';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useTusUpload } from '@/hooks/useTusUpload';
import { llmUnavailableReason, useLlmAvailability } from '@/hooks/useLlmStatus';
import type { HistogramMode } from './charts';
import type { AnalysisContext, Bin, Stats } from './lib';
import { makeAnalysisContext } from './analysisWiring';
import { streamTtTimeAnalysis } from './analysisStream';
import type { ActiveModule, BackendProcessResponse, Phase } from './types';
import { TtTimeReadyView } from './TtTimeReadyView';
import { TtTimeUploadView } from './TtTimeUploadView';

const DEFAULT_BIN_WIDTH = 10;

/** 会话级缓存键：误退出模块再回来时按 uploadId 恢复，不必重新上传。 */
const CACHE_KEY = 'tt-time-active-upload';

interface CachedTtSession {
  uploadId: string;
  fileName: string;
  binWidthStr: string;
  station: string;
  excludeFail: boolean;
  activeModule: ActiveModule;
  mode: HistogramMode;
}

const ACTIVE_MODULES: readonly ActiveModule[] = ['distribution', 'boxplot', 'comparison'];
const HISTOGRAM_MODES: readonly HistogramMode[] = ['percent', 'count'];

/** 读取上次会话；字段类型不对就整份丢弃，避免半坏数据把界面带进异常状态。 */
function readCachedSession(): CachedTtSession | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedTtSession>;
    if (typeof parsed.uploadId !== 'string' || !parsed.uploadId) return null;
    if (typeof parsed.fileName !== 'string' || !parsed.fileName) return null;
    return {
      uploadId: parsed.uploadId,
      fileName: parsed.fileName,
      binWidthStr:
        typeof parsed.binWidthStr === 'string' && parsed.binWidthStr.trim()
          ? parsed.binWidthStr
          : String(DEFAULT_BIN_WIDTH),
      station: typeof parsed.station === 'string' && parsed.station ? parsed.station : 'all',
      excludeFail: parsed.excludeFail !== false,
      activeModule: ACTIVE_MODULES.includes(parsed.activeModule as ActiveModule)
        ? (parsed.activeModule as ActiveModule)
        : 'distribution',
      mode: HISTOGRAM_MODES.includes(parsed.mode as HistogramMode)
        ? (parsed.mode as HistogramMode)
        : 'percent',
    };
  } catch {
    return null;
  }
}

function writeCachedSession(session: CachedTtSession): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(session));
  } catch {
    // 会话存储不可用时仅失去跨路由恢复能力，当前页面仍可正常工作
  }
}

function clearCachedSession(): void {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // 同上：清理失败不影响内存态
  }
}

/** 从 unknown 错误里读 HTTP 状态码与后端 detail，避免对第三方错误对象做内联断言。 */
function readHttpError(err: unknown): { status?: number; detail?: string } {
  if (typeof err !== 'object' || err === null) return {};
  const response = 'response' in err ? err.response : undefined;
  if (typeof response !== 'object' || response === null) return {};
  const status =
    'status' in response && typeof response.status === 'number' ? response.status : undefined;
  const data = 'data' in response ? response.data : undefined;
  const detail =
    typeof data === 'object' &&
    data !== null &&
    'detail' in data &&
    typeof data.detail === 'string'
      ? data.detail
      : undefined;
  return { status, detail };
}

const TtTimeTool: React.FC = () => {
  // 只读一次缓存：后续所有初始值都从这份快照取，避免 8 个 useState 各读一遍 sessionStorage
  const [restored] = useState(readCachedSession);
  const [phase, setPhase] = useState<Phase>(restored ? 'analyzing' : 'upload');
  const [activeModule, setActiveModule] = useState<ActiveModule>(restored?.activeModule ?? 'distribution');
  const [currentUploadId, setCurrentUploadId] = useState(restored?.uploadId ?? '');
  const [fileName, setFileName] = useState(restored?.fileName ?? '');
  const [processData, setProcessData] = useState<BackendProcessResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  // 参数变化后的页内重算：结果页保持挂载，只叠加提示，避免卸载正在编辑的表单
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [mode, setMode] = useState<HistogramMode>(restored?.mode ?? 'percent');
  const [binWidthStr, setBinWidthStr] = useState(restored?.binWidthStr ?? String(DEFAULT_BIN_WIDTH));
  const [station, setStation] = useState(restored?.station ?? 'all');
  const [excludeFail, setExcludeFail] = useState(restored?.excludeFail ?? true);
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

  // 会话缓存：只存 uploadId 与参数，结果由后端按 uploadId 重算。
  // 误退出模块再回来时据此恢复，不必重新选文件、重新上传。
  useEffect(() => {
    if (!currentUploadId) {
      clearCachedSession();
      return;
    }
    writeCachedSession({
      uploadId: currentUploadId,
      fileName,
      binWidthStr,
      station,
      excludeFail,
      activeModule,
      mode,
    });
  }, [currentUploadId, fileName, binWidthStr, station, excludeFail, activeModule, mode]);

  // 去重键：上传完成或参数变化后，同一组参数只发起一次后端计算
  const lastProcessedRef = useRef('');
  // ref 写入统一走这三个回调：效果/事件里直接改 ref 会被 React Compiler 的
  // immutability 规则判为"在渲染期修改"
  const invalidateInFlight = useCallback(() => {
    processGenRef.current += 1;
  }, []);
  const markProcessed = useCallback((key: string) => {
    lastProcessedRef.current = key;
  }, []);
  const clearProcessed = useCallback(() => {
    lastProcessedRef.current = '';
  }, []);

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
        const { status, detail } = readHttpError(err);
        const msg = err instanceof Error ? err.message : detail || '后端数据处理失败';
        // 恢复的会话可能已随上传文件过期：退回上传页并清掉缓存，而不是停在一个永远失败的页面上
        if (status === 404 || status === 410) {
          setCurrentUploadId('');
          setFileName('');
          setProcessData(null);
          clearProcessed();
          setErrorMessage('上次的上传文件已失效，请重新选择文件');
          setPhase('upload');
          return;
        }
        setErrorMessage(String(msg));
        setPhase('ready');
      }
    },
    [clearProcessed],
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
    clearProcessed();
    // 立刻清掉旧数据集的 uploadId：否则 station/excludeFail 被重置会让驱动 effect
    // 重跑，用上一个 uploadId 发请求，把旧数据集的图表当成"新文件的结果"展示，
    // 还会在上传期间把界面切到 analyzing、盖掉上传进度。
    setCurrentUploadId('');
    // 在途的旧响应同样不能再落地
    invalidateInFlight();
    void tusUpload.upload({ file, metadata: { filename: file.name } });
  };

  // 后端处理的单一驱动点：上传完成或参数变化后重新计算。
  // ① 去重键含参数，处理完成把 phase 置回 ready 不会再次触发同一 uploadId 的
  //    全量计算（旧实现因此对每次上传都发两遍相同请求）；
  // ② 300ms 定时器把分箱宽度输入期间的逐字触发收敛成一次请求。
  useEffect(() => {
    if (!currentUploadId) return;
    const key = `${currentUploadId}|${binWidth}|${station}|${excludeFail}`;
    if (lastProcessedRef.current === key) return;
    // 参数已变：立刻作废在途请求。否则它会在 300ms 防抖窗口内落地，
    // 把旧参数的结果配着新参数一起渲染出来。
    invalidateInFlight();
    const timer = window.setTimeout(() => {
      // 「重新计算」可能已经替同一组参数发过请求了，别再发一遍
      if (lastProcessedRef.current === key) return;
      // 只有上传后的首次计算才切整页 analyzing；参数变化必须保持结果页挂载，
      // 否则分箱宽度输入框会被卸载，用户打字打到一半的字符直接丢失。
      const isFirstRun = lastProcessedRef.current === '';
      markProcessed(key);
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
  }, [
    currentUploadId,
    binWidth,
    station,
    excludeFail,
    runBackendProcess,
    invalidateInFlight,
    markProcessed,
  ]);

  // I-3：处理失败必须可见且可重试。原实现只在去重键上做一次性请求，
  // 失败后既没有提示也没有重试入口，用户只能重传整个文件。
  const retryProcess = () => {
    if (!currentUploadId) return;
    markProcessed(`${currentUploadId}|${binWidth}|${station}|${excludeFail}`);
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
    clearProcessed();
    setProcessData(null);
    setFileName('');
    setStation('all');
    setExcludeFail(true);
    setActiveModule('distribution');
    setErrorMessage('');
    // 重置期间在途的旧响应不得再把界面拉回旧结果页
    invalidateInFlight();
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
  const { data: llmStatus } = useLlmAvailability();
  const llmBlockedReason = llmUnavailableReason(llmStatus);

  if (phase === 'upload' || phase === 'analyzing') {
    return (
      <TtTimeUploadView
        phase={phase}
        fileName={fileName}
        errorMessage={errorMessage}
        uploadStatus={tusUpload.status}
        uploadProgress={tusUpload.progress}
        onSelect={onFileSelect}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
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
      isRecomputing={isRecomputing}
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
