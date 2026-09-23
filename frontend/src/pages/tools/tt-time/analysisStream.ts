import { postSse } from '../../../lib/sse';
import type { LlmErrorPayload } from '../../../types/llm';
import type { AnalysisContext } from './lib';
import type { AnalysisResult } from './types';

/** 后端 LLM 错误契约在前端的表示，便于按 code 决定「能不能重试」。 */
export class LlmRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(payload: LlmErrorPayload) {
    super(payload.message);
    this.name = 'LlmRequestError';
    this.code = payload.code;
    this.retryable = payload.retryable;
  }
}

interface StreamHandlers {
  /** 每来一段正文增量就回调一次，调用方据此做渐进渲染。 */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

/**
 * 以 SSE 方式请求测试时间分析结论。
 *
 * resolve 的时机是收到 done 事件；正文以 done 之前的 delta 拼接为准，
 * model / elapsedMs 由 done 提供（后端在流结束后才知道总耗时）。
 * 失败统一抛 LlmRequestError：推流已经开始，HTTP 状态码已发出，
 * 后端只能靠 error 事件把错误码带出来。
 */
export async function streamTtTimeAnalysis(
  context: AnalysisContext,
  handlers: StreamHandlers = {},
): Promise<AnalysisResult> {
  const { onDelta, signal } = handlers;
  const pieces: string[] = [];
  // 用对象承载回调结果：直接给外层 let 赋值会被 TS 按「初始值 null」窄化，
  // 到 await 之后它仍认为那个变量恒为 null，只能换成属性写入。
  const outcome: { result?: AnalysisResult; failure?: LlmErrorPayload } = {};

  await postSse('/tools/tt-time/analyze/stream', {
    body: context,
    signal,
    onEvent: (event) => {
      const data = safeParse(event.data);
      if (event.event === 'delta') {
        const text = typeof data?.text === 'string' ? data.text : '';
        if (text) {
          pieces.push(text);
          onDelta?.(text);
        }
        return;
      }
      if (event.event === 'done') {
        outcome.result = {
          advice: pieces.join(''),
          model: String(data?.model ?? ''),
          elapsedMs: Number(data?.elapsedMs ?? 0),
        };
        return;
      }
      if (event.event === 'error') {
        outcome.failure = {
          code: String(data?.code ?? 'llm_error'),
          message: String(data?.message ?? '模型服务调用失败'),
          retryable: Boolean(data?.retryable),
        };
      }
    },
  });

  if (outcome.failure) throw new LlmRequestError(outcome.failure);
  if (!outcome.result) {
    throw new LlmRequestError({
      code: 'llm_bad_response',
      message: '模型服务未返回完整结论，请重试',
      retryable: true,
    });
  }
  // done 带空正文：后端保证过“要么有正文、要么发 error 事件”，走到这里说明
  // 链路某一环把内容弄丢了（上次就是分帧解析失败默默拼出个空 done）。
  // 呷给界面一句“已完成但没内容”不如直接报出来，否则用户只能看到空白。
  if (!outcome.result.advice) {
    throw new LlmRequestError({
      code: 'llm_bad_response',
      message: '模型服务没有推送任何正文，请重试或检查模型思考配置',
      retryable: true,
    });
  }
  return outcome.result;
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
