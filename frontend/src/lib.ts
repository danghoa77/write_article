export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown) {
    super(errorText(data));
    this.status = status;
    this.data = data;
  }
}
export function errorText(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object")
    return "Không thể hoàn tất yêu cầu. Vui lòng thử lại.";
  const value = data as Record<string, unknown>;
  if (value.code === "PROVIDER_QUOTA_OR_RATE_LIMIT")
    return value.failureKind === "rate_limit"
      ? `${value.provider ?? "Nhà cung cấp"} đang giới hạn tần suất. Chờ một lúc hoặc chọn công cụ khác; không tự chạy lại lô đã publish một phần.`
      : `${value.provider ?? "Nhà cung cấp"} đã hết quota/credit hoặc bị giới hạn. Mở Cài đặt hoặc Token tìm ảnh để cập nhật key, hoặc chọn công cụ khác.`;
  if (value.code === "PROVIDER_CREDENTIAL_INVALID")
    return `Thông tin kết nối ${value.provider ?? ""} không hợp lệ. Mở Cài đặt hoặc Token tìm ảnh để cập nhật key.`;
  if (value.code === "CHARACTER_REVIEW_REQUIRED")
    return `Cần kiểm tra dữ kiện để chọn nhân vật${value.character ? ` cho ${value.character}` : ""}. Hãy bổ sung hồ sơ hoặc điều chỉnh prompt.`;
  if (value.error && typeof value.error === "object")
    return errorText(value.error);
  if (value.message)
    return Array.isArray(value.message)
      ? value.message.join(", ")
      : String(value.message);
  if (value.results && Array.isArray(value.results))
    return value.results.map(errorText).join(" ");
  return "Không thể hoàn tất yêu cầu. Kiểm tra cấu hình và kết nối.";
}
export const hasExpired = (data: unknown) =>
  !!data &&
  typeof data === "object" &&
  (data as { sessionExpired?: boolean }).sessionExpired === true;
export async function api<T>(
  path: string,
  body?: unknown,
  method = "GET",
  timeout = 30000,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = "Máy chủ chưa phản hồi đúng định dạng. Vui lòng kiểm tra kết nối.";
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data as T;
}
export function load<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function dateTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
