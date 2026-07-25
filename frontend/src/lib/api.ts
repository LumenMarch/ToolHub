export interface User {
  username: string;
}

export interface CsvChange {
  field: string;
  before: string;
  after: string;
}

export interface CsvComparisonResult {
  files: {
    source: string;
    target: string;
  };
  summary: {
    sourceRows: number;
    targetRows: number;
    added: number;
    deleted: number;
    modified: number;
    unchanged: number;
  };
  metadata: {
    sourceEncoding: string;
    targetEncoding: string;
    primaryKey: string;
    comparedColumns: string[];
    sourceOnlyColumns: string[];
    targetOnlyColumns: string[];
    resultLimit: number;
  };
  added: Array<{ key: string; row: Record<string, string> }>;
  deleted: Array<{ key: string; row: Record<string, string> }>;
  modified: Array<{ key: string; changes: CsvChange[] }>;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? "请求失败，请稍后重试");
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  getCurrentUser: () => request<User>("/api/auth/me"),
  login: (username: string, password: string) =>
    request<User>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  compareCsv: (payload: FormData) =>
    request<CsvComparisonResult>("/api/tools/csv-compare", {
      method: "POST",
      body: payload,
    }),
};
