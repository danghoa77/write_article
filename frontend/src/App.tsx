import { useCallback, useEffect, useState } from "react";
import Login from "./Login";
import Workspace from "./Workspace";
import { Brand, Notice } from "./components";
import { api, ApiError } from "./lib";
import type { Session } from "./types";
import "./App.css";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [initialError, setInitialError] = useState("");
  const expire = useCallback(() => {
    setMessage(
      "Phiên đăng nhập đã kết thúc. Đăng nhập lại để tiếp tục; lựa chọn đội và category vẫn được giữ.",
    );
    setSession(null);
  }, []);
  const restore = useCallback(() => {
    return api<Session>("auth/browser/session")
      .then((restored) => setSession(restored))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) setSession(null);
        else
          setInitialError(
            error instanceof Error
              ? error.message
              : "Không kết nối được máy chủ",
          );
      });
  }, []);
  useEffect(() => {
    void restore();
  }, [restore]);
  useEffect(() => {
    if (!session) return;
    const check = () => {
      void api<Session>("auth/browser/session").catch((error) => {
        if (error instanceof ApiError && error.status === 401) expire();
      });
    };
    const timer = window.setTimeout(
      expire,
      Math.max(0, Math.min(session.expiresAt - Date.now(), 2147483647)),
    );
    const interval = window.setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("focus", check);
    };
  }, [session, expire]);
  async function logout() {
    await api("auth/browser/logout", {}, "POST");
    setMessage("");
    setSession(null);
  }
  if (session === undefined)
    return (
      <main className="loading-screen">
        <Brand />
        {initialError ? (
          <>
            <Notice kind="danger">{initialError}</Notice>
            <button onClick={() => void restore()}>Thử kết nối lại</button>
          </>
        ) : (
          <p className="muted">Đang mở không gian làm việc…</p>
        )}
      </main>
    );
  if (!session)
    return (
      <Login
        signedIn={(value) => {
          setMessage("");
          setSession(value);
        }}
        message={message}
      />
    );
  return (
    <Workspace
      key={session.username.toLowerCase()}
      session={session}
      expire={expire}
      logout={logout}
    />
  );
}
