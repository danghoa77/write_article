import { useState, type FormEvent } from "react";
import { api, load, save } from "./lib";
import { Brand, Icon, Notice } from "./components";
import type { Session } from "./types";

export default function Login({
  signedIn,
  message,
}: {
  signedIn: (session: Session) => void;
  message: string;
}) {
  const [username, setUsername] = useState(
    () => load("aw:remember", { username: "", remember: false }).username,
  );
  const [remember, setRemember] = useState(
    () => load("aw:remember", { username: "", remember: false }).remember,
  );
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await api<Session>(
        "auth/browser/login",
        { username, password, remember },
        "POST",
      );
      save("aw:remember", { username: remember ? username : "", remember });
      setPassword("");
      signedIn(session);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Không thể đăng nhập");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-screen">
      <section className="login-aside" aria-label="Giới thiệu AutoWrite">
        <Brand />
        <div className="login-story">
          <div className="eyebrow">ÍT THAO TÁC HƠN. NHIỀU CÂU CHUYỆN HƠN.</div>
          <h1>
            Một câu chuyện.
            <br />
            <span>Nhiều màu áo.</span>
          </h1>
          <p>
            Không gian viết nội dung thể thao của bạn. Từ ý tưởng đầu tiên đến
            bài viết sẵn sàng xuất bản và chuyển đến Trello.
          </p>
          <div className="login-steps">
            <div className="login-step">
              <span>
                <Icon name="pen" size={16} />
              </span>
              Nhập câu chuyện hoặc lấy từ Trello
            </div>
            <div className="login-step">
              <span>
                <Icon name="team" size={16} />
              </span>
              Chọn đội, lineup và giọng viết
            </div>
            <div className="login-step">
              <span>
                <Icon name="check" size={16} />
              </span>
              Viết và publish trong cùng một luồng
            </div>
          </div>
        </div>
        <div className="login-foot">
          <span className="tiny-dot" /> DARK NIGHT · MIDNIGHT INDIGO
        </div>
      </section>
      <section className="login-main">
        <form className="login-form" onSubmit={submit}>
          <div className="login-mobile-brand">
            <Brand />
          </div>
          <span className="roster-icon">
            <Icon name="lock" />
          </span>
          <h2>Chào mừng trở lại</h2>
          <p>Đăng nhập để bắt đầu viết.</p>
          {message && <Notice kind="warning">{message}</Notice>}
          {error && <Notice kind="danger">{error}</Notice>}
          <fieldset className="stack" disabled={busy}>
            <label>
              Tên đăng nhập
              <input
                name="username"
                autoComplete="username"
                placeholder="Nhập tên đăng nhập"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
            <div>
              <label htmlFor="password">Mật khẩu</label>
              <div className="password-field">
                <input
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  type={visible ? "text" : "password"}
                  placeholder="Nhập mật khẩu"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  className="icon-button"
                  type="button"
                  aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  <Icon name="eye" />
                </button>
              </div>
            </div>
            <div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                Ghi nhớ đăng nhập
              </label>
              <p className="field-hint">
                Giữ phiên và tên tài khoản trên máy này. Mật khẩu do trình duyệt
                quản lý.
              </p>
            </div>
            <button className="primary" type="submit">
              {busy ? <span className="spinner" /> : null}
              {busy ? "Đang đăng nhập…" : "Đăng nhập"}
              {!busy && <Icon name="arrow" size={17} />}
            </button>
          </fieldset>
          <footer>
            <Icon name="lock" size={12} /> Phiên đăng nhập của bạn được bảo vệ.
          </footer>
        </form>
      </section>
    </main>
  );
}
