import axios from 'axios';
import { FileArrowUp, CheckSquareOffset, DownloadSimple } from '@phosphor-icons/react';
import { gsap } from 'gsap';
import React, { useEffect, useRef, useState } from 'react';

import api from '../../api/axios';

type FileKind = 'attendance' | 'shift';

interface FileDropZoneProps {
  accept: string;
  description: string;
  file: File | null;
  id: string;
  label: string;
  onSelect: (file: File) => void;
}

const FileDropZone: React.FC<FileDropZoneProps> = ({
  accept,
  description,
  file,
  id,
  label,
  onSelect,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile) {
      onSelect(droppedFile);
    }
  };

  return (
    <div className="min-w-0">
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        aria-label={`选择${label}`}
        className="sr-only"
        onChange={(event) => {
          const selectedFile = event.target.files?.[0];
          if (selectedFile) {
            onSelect(selectedFile);
          }
          event.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        aria-describedby={`${id}-description`}
        className={`group flex min-h-64 w-full flex-col justify-between border-2 p-6 text-left transition-colors md:p-8 ${
          isDragging
            ? 'border-primary bg-primary/10'
            : 'border-border bg-card hover:border-primary'
        }`}
      >
        <div className="flex w-full items-start justify-between gap-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {label}
          </span>
          <FileArrowUp
            weight="bold"
            className="h-7 w-7 shrink-0 text-primary transition-transform group-hover:-translate-y-1"
          />
        </div>

        <div className="min-w-0">
          <p className="break-words text-2xl font-bold tracking-tight md:text-3xl">
            {file ? file.name : '拖放或选择文件'}
          </p>
          <p
            id={`${id}-description`}
            className="mt-3 font-mono text-xs leading-relaxed text-muted-foreground"
          >
            {file
              ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
              : description}
          </p>
        </div>
      </button>
    </div>
  );
};

const getExtension = (filename: string) => {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex === -1 ? '' : filename.slice(dotIndex).toLowerCase();
};

const parseDownloadFilename = (contentDisposition?: string) => {
  const encodedMatch = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch) {
    return decodeURIComponent(encodedMatch[1]);
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/\D/g, '')
    .slice(0, 14);
  return `出勤整理_完整_${timestamp}.xlsx`;
};

const readErrorMessage = async (error: unknown) => {
  if (!axios.isAxiosError(error)) {
    return '处理失败，请稍后重试';
  }

  const responseData = error.response?.data;
  if (responseData instanceof Blob) {
    try {
      const parsed = JSON.parse(await responseData.text());
      return parsed.detail || '处理失败，请检查上传文件';
    } catch {
      return '处理失败，请检查上传文件';
    }
  }

  return responseData?.detail || error.message || '处理失败，请稍后重试';
};

const AttendanceOrganizer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [attendanceFile, setAttendanceFile] = useState<File | null>(null);
  const [shiftFile, setShiftFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const context = gsap.context(() => {
      gsap.to('.clip-text > span', {
        y: 0,
        duration: 1.2,
        stagger: 0.1,
        ease: 'power4.out',
      });
      gsap.from('.attendance-reveal', {
        y: 24,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: 'expo.out',
        delay: 0.35,
      });
    }, containerRef);

    return () => context.revert();
  }, []);

  const handleFileSelect = (kind: FileKind, file: File) => {
    const extension = getExtension(file.name);
    const isValid =
      kind === 'attendance'
        ? extension === '.xls' || extension === '.xlsx'
        : extension === '.xlsx';

    if (!isValid) {
      setError(
        kind === 'attendance'
          ? '通行记录仅支持 .xls 或 .xlsx 格式'
          : '班别文件仅支持 .xlsx 格式',
      );
      return;
    }

    setError('');
    setStatus('');
    if (kind === 'attendance') {
      setAttendanceFile(file);
    } else {
      setShiftFile(file);
    }
  };

  const handleProcess = async () => {
    if (!attendanceFile || !shiftFile) {
      setError('请先选择通行记录和班别文件');
      return;
    }

    const formData = new FormData();
    formData.append('attendance_file', attendanceFile);
    formData.append('shift_file', shiftFile);

    setError('');
    setStatus('正在整理记录并生成 Excel…');
    setIsProcessing(true);

    try {
      const response = await api.post<Blob>(
        '/tools/attendance/process',
        formData,
        { responseType: 'blob' },
      );
      const filename = parseDownloadFilename(
        response.headers['content-disposition'],
      );
      const downloadUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
      setStatus(`整理完成，已下载 ${filename}`);
    } catch (requestError) {
      setStatus('');
      setError(await readErrorMessage(requestError));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex min-h-[70vh] w-full flex-col justify-center py-10"
    >
      <div className="mb-12">
        <h1 className="text-5xl font-bold uppercase leading-[0.85] tracking-tighter md:text-7xl">
          <div className="clip-text">
            <span>出勤资料</span>
          </div>
          <br />
          <div className="clip-text">
            <span className="text-primary">整理.</span>
          </div>
        </h1>
        <p className="attendance-reveal mt-6 max-w-2xl font-mono text-xs uppercase leading-relaxed tracking-[0.18em] text-muted-foreground md:text-sm">
          上传通行记录与班别明细，自动识别离岗、用餐、超时及数据异常。
        </p>
      </div>

      <div className="attendance-reveal grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FileDropZone
          id="attendance-file"
          label="01 / 通行记录"
          description="支持 .xls 或 .xlsx，包含一个或多个人员工作表。"
          accept=".xls,.xlsx"
          file={attendanceFile}
          onSelect={(file) => handleFileSelect('attendance', file)}
        />
        <FileDropZone
          id="shift-file"
          label="02 / 班别明细"
          description="仅支持 .xlsx，必须覆盖通行记录中的全部员工。"
          accept=".xlsx"
          file={shiftFile}
          onSelect={(file) => handleFileSelect('shift', file)}
        />
      </div>

      <div className="attendance-reveal mt-8 flex flex-col gap-6 border-t-2 border-border pt-8 md:flex-row md:items-center">
        <button
          type="button"
          onClick={handleProcess}
          disabled={!attendanceFile || !shiftFile || isProcessing}
          className="flex min-h-14 items-center justify-center gap-3 bg-foreground px-8 py-4 text-lg font-bold uppercase tracking-tight text-background transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isProcessing ? (
            <CheckSquareOffset
              weight="bold"
              className="h-6 w-6 animate-pulse"
            />
          ) : (
            <DownloadSimple weight="bold" className="h-6 w-6" />
          )}
          {isProcessing ? '正在整理' : '生成并下载'}
        </button>

        <div className="min-h-12 flex-1 font-mono text-sm leading-relaxed">
          {error && (
            <p role="alert" className="text-primary">
              [ 异常 ] {error}
            </p>
          )}
          {status && (
            <p role="status" aria-live="polite" className="text-muted-foreground">
              {status}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AttendanceOrganizer;
