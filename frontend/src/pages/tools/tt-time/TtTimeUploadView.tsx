import React from 'react';
import { Database } from 'lucide-react';

import FileDropZone from '@/components/FileDropZone';
import LoadingOverlay from '@/components/LoadingOverlay';
import { LoadingSignal } from '@/components/LoadingSignal';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { UploadStatus } from '@/hooks/useTusUpload';
import type { Phase } from './types';

interface TtTimeUploadViewProps {
  phase: Phase;
  fileName: string;
  errorMessage: string;
  uploadStatus: UploadStatus;
  uploadProgress: number;
  onSelect: (file: File) => void;
}

/** 上传各阶段文案；determinate 表示该阶段有字节级进度。 */
const UPLOAD_STAGES: Partial<
  Record<UploadStatus, { message: string; determinate: boolean }>
> = {
  hashing: { message: '正在校验文件指纹…', determinate: true },
  'cache-checking': { message: '正在查找服务端缓存…', determinate: false },
  uploading: { message: '正在上传文件…', determinate: true },
  confirming: { message: '正在确认上传结果…', determinate: false },
};

/**
 * 上传/分析阶段视图。
 * 大文件真正耗时的是计算指纹与缓存检查（以前完全没有反馈），四个阶段统一交给进度浮层。
 */
export const TtTimeUploadView: React.FC<TtTimeUploadViewProps> = ({
  phase,
  fileName,
  errorMessage,
  uploadStatus,
  uploadProgress,
  onSelect,
}) => {
  const stage = UPLOAD_STAGES[uploadStatus];
  const isLoading = phase === 'upload' && stage !== undefined;
  const progress = stage === undefined ? null : stage.determinate ? uploadProgress / 100 : 1;
  const progressText =
    stage?.determinate === true ? `（${Math.round(uploadProgress)}%）` : '';

  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6">
      <LoadingOverlay
        loading={isLoading}
        progress={progress}
        message={stage?.message ?? '正在上传文件…'}
        detail={fileName ? `${fileName}${progressText}` : undefined}
      />
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
            disabled={isLoading || phase === 'analyzing'}
            onSelect={onSelect}
          />
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
};
