/* Same-origin requests; never automatically retry a simulation-creating POST. */
(function (root) {
  "use strict";
  class ApiError extends Error {
    constructor(message, kind, status) {
      super(message);
      this.kind = kind;
      this.status = status;
    }
  }
  async function request(fetcher, url, options = {}) {
    const { timeoutMs = 20000, ...init } = options;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    let response;
    try {
      response = await fetcher(url, {
        ...init,
        signal,
        headers: { "Content-Type": "application/json", ...init.headers },
      });
    } catch (error) {
      throw new ApiError(
        timeout.aborted
          ? "Kết nối quá thời gian. Bạn có thể thử lại."
          : "Không kết nối được API. Kiểm tra ứng dụng và mạng.",
        timeout.aborted ? "timeout" : "network",
      );
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(
        "API trả dữ liệu không hợp lệ. Kiểm tra đúng ứng dụng/cổng đang chạy.",
        "invalid",
        response.status,
      );
    }
    if (!response.ok) {
      const message = Array.isArray(payload.message)
        ? payload.message.join("; ")
        : payload.message;
      const kind =
        response.status === 404
          ? "not-found"
          : response.status === 409
            ? "conflict"
            : [401, 403].includes(response.status)
              ? "permission"
              : response.status >= 500
                ? "server"
                : "validation";
      throw new ApiError(
        message || `API lỗi ${response.status}`,
        kind,
        response.status,
      );
    }
    return payload;
  }
  const api = { request, ApiError };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ViewerApi = api;
})(typeof window !== "undefined" ? window : globalThis);
