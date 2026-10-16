/**
 * 转义要拼进 HTML 上下文的用户数据。
 *
 * ECharts 的 tooltip formatter 返回字符串时按 innerHTML 写入且不做转义，
 * 而站名、Station ID、分箱标签都来自用户上传的 CSV——不转义就是一个
 * 「构造文件名/列值即可执行脚本」的注入点。
 */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => (
    ch === '&' ? '&amp;'
      : ch === '<' ? '&lt;'
      : ch === '>' ? '&gt;'
      : ch === '"' ? '&quot;'
      : '&#39;'
  ));
