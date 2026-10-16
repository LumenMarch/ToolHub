import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  // 刻意不设全局 timeout：attendance / retest-rate 是同步阻塞端点
  // （backend/app/api/endpoints/attendance.py、retest_rate.py），大文件分析
  // 可能远超 30 秒，一刀切会误杀正常请求。需要超时保护请按请求传 signal。
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.dispatchEvent(new Event('unauthorized'));
    }
    if (error.response?.status === 403) {
      window.dispatchEvent(new Event('forbidden'));
    }
    return Promise.reject(error);
  }
);

export default api;
