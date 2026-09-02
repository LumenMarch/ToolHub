export const APP_TITLE = '工具'

export function pageTitle(page?: string): string {
  return page ? `${page} · ${APP_TITLE}` : APP_TITLE
}
