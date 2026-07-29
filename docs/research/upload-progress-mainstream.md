# 1. 文件上传 100% 与服务端确认的主流处理方式

> 调研日期：2026-07-29  
> 调研范围：tus 协议、tus-js-client、tusd、Uppy、FilePond，以及 ToolHub 当前实现。  
> 来源约束：仅查阅 GitHub 官方仓库的一手规范、源码和文档；外部链接均固定到具体 commit。

## 2. 结论摘要

主流实现对上传过程至少区分两类信号：

1. **传输进度**：浏览器或 HTTP 栈报告已经发送了多少字节。这一数值可以达到 100%，但服务端仍可能尚未接收、持久化或确认最后一个分片。
2. **完成信号**：客户端收到成功响应，且服务端返回的 offset、ETag、文件引用等结果满足协议或业务要求。

成熟实现通常不会只靠百分比判断完成：

- tus-js-client 明确说明 `onProgress` 只代表已发送字节，数据未必已被服务端接受；`onChunkComplete` 才表示分片已被服务端接受，`onSuccess` 则在最终成功响应处理后触发。
- Uppy 和 FilePond 都允许传输百分比达到 100%，但仍保留独立的 `uploadComplete`、`PROCESSING_COMPLETE` 或成功事件；成功图标和完成状态不会仅由百分比触发。
- Uppy 和 tusd 进一步把文件传输与后处理分离。需要同步校验时，响应会等待校验；耗时后处理则进入独立阶段或在响应后异步执行。

因此，“把进度限制在 99%”是可选的视觉策略，不是主流方案的核心。核心是：**百分比、服务端确认、业务处理必须是不同状态**。

## 3. tus 协议与 tus-js-client

### 3.1 协议中的完成依据是服务端确认

tus v1.0.0 要求成功的 `PATCH` 返回 `204 No Content`，并在 `Upload-Offset` 中返回服务端已接收且已处理或存储后的新 offset，而不是以客户端发送进度作为完成依据：

- [tus 协议：PATCH 成功响应与 Upload-Offset 语义](https://github.com/tus/tus-resumable-upload-protocol/blob/c6a11fa3d7b6198e00e4aa5289ccb71314162b84/protocol.md#L211-L234)
- [tus 协议：HEAD 必须返回服务端当前 Upload-Offset](https://github.com/tus/tus-resumable-upload-protocol/blob/c6a11fa3d7b6198e00e4aa5289ccb71314162b84/protocol.md#L196-L209)

这意味着客户端看到“请求体已发送完”之后，仍需等待最终 `PATCH` 响应。只有响应中的 offset 等于文件长度，上传才被协议层确认完成。

### 3.2 tus-js-client 明确分离 sent、accepted 与 success

tus-js-client 的官方 FAQ 明确指出：

- `onProgress` 表示发送到服务端的字节数，数据未必已被服务端接收或接受。
- `onChunkComplete` 只在客户端已有证据确认远端接受完整分片后触发。

来源：

- [tus-js-client FAQ：onProgress 与 onChunkComplete 的区别](https://github.com/tus/tus-js-client/blob/4badd501aa9c8d33a7f72add8db88c899aa15504/docs/faq.md#L23-L25)
- [tus-js-client API：onChunkComplete 在 PATCH 成功后触发，onSuccess 表示上传成功结束](https://github.com/tus/tus-js-client/blob/4badd501aa9c8d33a7f72add8db88c899aa15504/docs/api.md#L47-L66)

源码中的事件顺序也验证了这一点：

1. 请求发送过程中，底层 progress handler 调用 `_emitProgress`。
2. 等待 HTTP 请求返回。
3. 从响应读取 `Upload-Offset`。
4. 再发送已确认进度和 `onChunkComplete`。
5. 当服务端 offset 等于总大小时调用 `onSuccess`。

来源：

- [发送请求时根据 bytesSent 报告 onProgress](https://github.com/tus/tus-js-client/blob/4badd501aa9c8d33a7f72add8db88c899aa15504/lib/upload.ts#L828-L897)
- [收到响应后读取 offset，再触发 onChunkComplete 和 onSuccess](https://github.com/tus/tus-js-client/blob/4badd501aa9c8d33a7f72add8db88c899aa15504/lib/upload.ts#L900-L925)
- [_emitProgress 注释明确说明字节可能尚未被服务端接受](https://github.com/tus/tus-js-client/blob/4badd501aa9c8d33a7f72add8db88c899aa15504/lib/upload.ts#L551-L573)

### 3.3 对 ToolHub 的直接启示

ToolHub 的 `useTusUpload` 使用 `onProgress` 计算 UI 百分比，并在独立的 `onSuccess` 中才把状态设为 `completed`、解析 upload ID 和 resolve Promise：

- [ToolHub：onProgress 与 onSuccess](https://github.com/LumenMarch/ToolHub/blob/f9ebc063d7d7e260f37b42d64d0d2d4bf3461f80/frontend/src/hooks/useTusUpload.ts#L65-L86)

这一完成判定在协议语义上是正确的。问题在于状态模型只有 `uploading` 和 `completed`，没有表达“客户端已发完、正在等待服务器确认”。同时 `Math.round` 会让 99.5% 以上提前显示为 100%，放大停顿感。

## 4. Uppy

### 4.1 上传百分比与上传成功是两个事件

Uppy 的 tus 插件分别转发 tus-js-client 的 `onProgress` 和 `onSuccess`：

- `onProgress` 触发 `upload-progress`。
- `onSuccess` 收到最终响应后才触发 `upload-success`。

来源：

- [Uppy Tus：分别处理 onProgress 与 onSuccess](https://github.com/transloadit/uppy/blob/99316b9893a82564317546a19205c9ab5cea1b8a/packages/%40uppy/tus/src/index.ts#L345-L386)

Uppy Core 虽然也会把传输进度四舍五入为百分比，但只有 `upload-success` 才设置 `uploadComplete: true`。如果注册了后处理器，上传成功后还会进入不定进度的 postprocess 状态，直到 `postprocess-complete` 才设置整个任务完成：

- [Uppy Core：上传进度只更新百分比，不设置 uploadComplete](https://github.com/transloadit/uppy/blob/99316b9893a82564317546a19205c9ab5cea1b8a/packages/%40uppy/core/src/Uppy.ts#L1530-L1577)
- [Uppy Core：upload-success 才设置 uploadComplete，并为后处理保留独立状态](https://github.com/transloadit/uppy/blob/99316b9893a82564317546a19205c9ab5cea1b8a/packages/%40uppy/core/src/Uppy.ts#L1768-L1805)
- [Uppy Core：postprocess-complete 才设置完整流程完成](https://github.com/transloadit/uppy/blob/99316b9893a82564317546a19205c9ab5cea1b8a/packages/%40uppy/core/src/Uppy.ts#L1837-L1870)

### 4.2 UI 依据状态而不是百分比显示“完成”

Uppy Status Bar 在 `uploadStarted && !uploadComplete` 时保持 `uploading` 状态；只有所有文件真正完成时才进入 `complete`。后处理有独立的 `postprocessing` 状态：

- [Uppy Status Bar：uploading、postprocessing、complete 状态判定](https://github.com/transloadit/uppy/blob/99316b9893a82564317546a19205c9ab5cea1b8a/packages/%40uppy/status-bar/src/StatusBar.tsx#L27-L65)
- [Uppy Dashboard：成功图标依赖 uploadComplete 且无处理中状态](https://github.com/transloadit/uppy/blob/99316b9893a82564317546a19205c9ab5cea1b8a/packages/%40uppy/dashboard/src/components/FileItem/index.tsx#L70-L100)

因此 Uppy 并不保证传输阶段永远只显示到 99%，而是保证“100%”不会自动变成“已完成”。如果响应较慢，用户仍处于 uploading 状态；如果还有后处理，则明确进入 postprocessing。

## 5. FilePond

### 5.1 XHR 上传进度与成功响应分开处理

FilePond 将 `xhr.upload.onprogress` 转为进度事件，但仅在 `xhr.onload` 且状态码为 2xx 时触发成功：

- [FilePond：onprogress 与成功 onload 独立](https://github.com/pqina/filepond/blob/1304c6d6a4687c4fecf9029710eec933277ce4dd/src/js/utils/sendRequest.js#L43-L87)
- [FilePond：服务端响应到达后才调用 processor 的 load](https://github.com/pqina/filepond/blob/1304c6d6a4687c4fecf9029710eec933277ce4dd/src/js/app/utils/createFileProcessorFunction.js#L82-L101)

FilePond 的文件状态也只在成功 load 后进入 `PROCESSING_COMPLETE` 并发出完成事件：

- [FilePond：load-perceived 后设置 PROCESSING_COMPLETE](https://github.com/pqina/filepond/blob/1304c6d6a4687c4fecf9029710eec933277ce4dd/src/js/app/utils/createItem.js#L228-L251)
- [FilePond：进度事件与完成事件分别分发](https://github.com/pqina/filepond/blob/1304c6d6a4687c4fecf9029710eec933277ce4dd/src/js/app/actions.js#L553-L590)

### 5.2 100% 仍可显示“处理中”

FilePond 在进度事件中显示“processing + 百分比”，而完成事件会切换到单独的完成标签：

- [FilePond：处理中百分比与完成标签是不同 UI 路由](https://github.com/pqina/filepond/blob/1304c6d6a4687c4fecf9029710eec933277ce4dd/src/js/app/view/fileStatus.js#L35-L58)

它还默认启用 750–1500 ms 的最低可感知上传时长，让过快的上传动画更稳定，但这只是体验平滑措施，不替代服务端成功判定：

- [FilePond：真实进度、感知进度与响应完成的组合](https://github.com/pqina/filepond/blob/1304c6d6a4687c4fecf9029710eec933277ce4dd/src/js/app/utils/createFileProcessor.js#L19-L105)

## 6. tusd 服务端

### 6.1 最终响应等待存储完成

tusd 将请求体以 `io.Reader` 传给存储层，边读边写；写入完成后更新 offset，再执行存储的 `FinishUpload` 和同步的 `pre-finish` 回调，最后才返回响应：

- [tusd：请求体限流并流式传给 WriteChunk](https://github.com/tus/tusd/blob/ad7fb31344e0629cb8a5af67bb1e630f90507890/pkg/handler/unrouted_handler.go#L869-L939)
- [tusd：更新 offset 后执行 FinishUpload 和 finish 事件](https://github.com/tus/tusd/blob/ad7fb31344e0629cb8a5af67bb1e630f90507890/pkg/handler/unrouted_handler.go#L961-L1019)
- [tusd FileStore：通过 io.Copy 流式写入文件](https://github.com/tus/tusd/blob/ad7fb31344e0629cb8a5af67bb1e630f90507890/pkg/filestore/filestore.go#L220-L235)

这与 tus 协议一致：客户端的传输进度可能先到 100%，但 `onSuccess` 必须等待服务端存储完成和最终响应。

### 6.2 同步校验与耗时后处理分开

tusd 提供两种边界：

- `pre-finish`：所有数据收到后、响应发送前同步执行，适合必须影响上传结果的校验。
- `post-finish`：响应发送后非阻塞执行，适合移动文件、编码等后处理。

来源：

- [tusd hooks：pre-finish 与 post-finish 的触发点和阻塞性](https://github.com/tus/tusd/blob/ad7fb31344e0629cb8a5af67bb1e630f90507890/docs/_advanced-topics/hooks.md#L25-L42)
- [tusd hooks：耗时后处理应在响应后的 post-finish 中启动](https://github.com/tus/tusd/blob/ad7fb31344e0629cb8a5af67bb1e630f90507890/docs/_advanced-topics/hooks.md#L420-L430)

## 7. ToolHub 与主流实现的差异

| 维度 | 主流实现 | ToolHub 当前实现 | 影响 |
|---|---|---|---|
| 传输与确认 | 分开建模；`progress` 不代表 success | hook 内部判定分开，但公开状态没有 `confirming` | 百分比到 100% 后，界面无法解释仍在等待什么 |
| 百分比计算 | 可四舍五入，但 UI 完成态依赖 success/complete flag | `Math.round`，99.5% 即可能显示 100% | 提前制造“应该完成”的预期 |
| 已接受进度 | tus-js-client 提供 `onChunkComplete` | 未使用 | UI 只有发送进度，没有服务端确认进度 |
| 后处理 | Uppy 使用 postprocessing；tusd 区分 pre-finish/post-finish | 页面只粗分 uploading/processing | 最后一个分片的确认阶段被归入 uploading，语义不够细 |
| 请求体读取 | tusd 边读边写并设置网络读超时 | `await request.body()` 完整缓冲 5 MB 分片 | 最终分片需要先完整缓冲，再同步写盘，增加响应尾延迟 |
| 存储 I/O | tusd 直接从 Reader 流式写入 | async endpoint 内同步读取 JSON、`stat`、写文件和写 metadata | 磁盘慢或并发高时会阻塞 event loop，放大 100% 停顿 |
| 断点恢复 | tus-js-client 支持指纹和 retry 配置 | 明确关闭 `storeFingerprintForResuming`，也未设置 retryDelays | 与 100% 停顿无直接关系，但网络失败恢复能力较弱 |

ToolHub 的具体表现：

- 出勤整理把两个文件的发送百分比取平均；只有两个上传 Promise 都在 `onSuccess` resolve 后，才从 uploading 切到 processing：
  - [出勤整理：显示两个发送进度的平均值](https://github.com/LumenMarch/ToolHub/blob/f9ebc063d7d7e260f37b42d64d0d2d4bf3461f80/frontend/src/pages/tools/attendance-organizer/index.tsx#L86-L124)
  - [出勤整理：等待两个 onSuccess 后才切到 processing](https://github.com/LumenMarch/ToolHub/blob/f9ebc063d7d7e260f37b42d64d0d2d4bf3461f80/frontend/src/pages/tools/attendance-organizer/index.tsx#L638-L669)
- 资产对比直接显示 `loaded / total`。最后一个文件发送完但响应未到时，界面会显示两个数相等，同时状态文案仍是“上传中”：
  - [资产对比：使用原始 onProgress](https://github.com/LumenMarch/ToolHub/blob/f9ebc063d7d7e260f37b42d64d0d2d4bf3461f80/frontend/src/pages/tools/asset-comparison/index.tsx#L87-L102)
  - [资产对比：逐个等待上传成功后才开始扫描](https://github.com/LumenMarch/ToolHub/blob/f9ebc063d7d7e260f37b42d64d0d2d4bf3461f80/frontend/src/pages/tools/asset-comparison/index.tsx#L156-L198)
  - [资产对比：进度条直接使用 loaded / total](https://github.com/LumenMarch/ToolHub/blob/f9ebc063d7d7e260f37b42d64d0d2d4bf3461f80/frontend/src/pages/tools/asset-comparison/index.tsx#L464-L478)
- 后端最后一个 `PATCH` 先完整读取请求体，再调用同步存储写入，写完 metadata 后才返回 `204`：
  - [ToolHub upload endpoint：完整缓冲并同步写入后返回](https://github.com/LumenMarch/ToolHub/blob/f9ebc063d7d7e260f37b42d64d0d2d4bf3461f80/backend/app/api/endpoints/upload.py#L199-L239)
  - [ToolHub UploadStore：同步文件与 metadata 写入](https://github.com/LumenMarch/ToolHub/blob/f9ebc063d7d7e260f37b42d64d0d2d4bf3461f80/backend/app/services/upload/store.py#L94-L131)

## 8. 建议

### 8.1 P0：增加“服务器确认中”状态

扩展共享 hook 的状态，例如：

```text
idle → uploading → confirming → completed
                   ↘ error
```

推荐语义：

- `uploading`：`bytesUploaded < bytesTotal`。
- `confirming`：`onProgress` 已报告全部字节发送完成，但 `onSuccess` 尚未触发。
- `completed`：仅由 `onSuccess` 设置。

页面在 `confirming` 时显示“文件已发送，等待服务器确认…”，使用不定进度动画或保持满进度条但不显示成功图标。出勤整理应对两个文件分别保留状态，只有两者均完成后才进入业务分析；资产对比应显示“第 N 个文件已发送，等待确认”。

### 8.2 P0：不要把修改舍入方式当作完整修复

可以把传输阶段的视觉百分比改为 `Math.floor`，或在 `onSuccess` 前最多显示 99%，但这只是降低误导感。即使使用 `Math.floor`，当浏览器真实报告全部字节发送完成时仍会到 100%；因此仍需独立的 `confirming` 状态。

### 8.3 P1：按需要暴露“已发送”和“已接受”两套进度

共享 hook 可以接入 tus-js-client 的 `onChunkComplete`：

- `sentBytes` 来自 `onProgress`，动画平滑但不是服务端确认。
- `acceptedBytes` 来自 `onChunkComplete`，按 5 MB 分片跳变但语义可靠。

简单 UI 只需使用 `sentBytes` 加 `confirming` 状态；需要精确诊断或更强可信度时，再展示 accepted 进度。不要把 `acceptedBytes` 与业务分析进度混成一个百分比。

### 8.4 P1：后端改为流式读取并隔离同步磁盘 I/O

参考 tusd 的 Reader 到存储层的路径，ToolHub 应避免在 async endpoint 中先 `await request.body()` 完整缓冲整个分片。可将请求流增量写入临时文件，并把同步文件操作放在线程池或采用明确的异步存储抽象。

这会降低内存峰值和 event loop 阻塞，但不会消除协议上“发送完后等待确认”的正常间隔；前端状态拆分仍然必要。

### 8.5 P2：将耗时后处理建模为独立阶段

当前出勤分析和资产扫描已经发生在 tus 上传成功之后，这一边界是合理的。若未来把病毒扫描、文件转换或校验加入上传端点：

- 必须影响上传是否有效的短校验放在最终响应前，并显示 confirming。
- 耗时任务在上传成功后异步执行，返回任务 ID，前端进入 processing 并轮询或订阅任务状态。

不要让长耗时业务处理阻塞最后一个 tus `PATCH`，否则用户会长期停留在传输 100%。

## 9. 推荐落地顺序

1. 先调整 `useTusUpload` 的状态模型和两个页面文案，解决用户对 100% 停顿的误判。
2. 增加前端埋点，分别记录“最后一次 sent=total”到 `onSuccess` 的确认耗时，以及后续业务接口耗时。
3. 再按观测结果优化后端请求流和同步磁盘 I/O。
4. 只有确认阶段仍频繁过长时，再评估将上传服务替换为 tusd 或对象存储直传；当前 100 MB 上限下，不必仅为 UI 停顿立即更换整个上传架构。
