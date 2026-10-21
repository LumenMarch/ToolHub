import { QueryClient } from '@tanstack/react-query';

/**
 * 应用级 QueryClient 单例。
 *
 * 独立成模块而不是内联在 main.tsx：会话收口（登出 / 401 / 会话吊销）必须清空缓存，
 * 否则同机换人登录时，上一位用户的 admin/users、audit、notifications 会先作为初始数据
 * 渲染给下一位用户，随后才被 refetch 覆盖。
 */
export const queryClient = new QueryClient();
