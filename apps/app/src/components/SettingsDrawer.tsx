import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import type { ImportState } from "../hooks/useMediaImport.ts";
import { readAvatarFile } from "../lib/avatar.ts";
import { MAX_NAME_LENGTH, displayName, type PersonKey, type Profile } from "../lib/profile.ts";
import type { DbStats, MediaKind } from "../lib/tauri.ts";
import { Avatar } from "./Avatar.tsx";
import { Icon } from "./Icons.tsx";

export interface SettingsDrawerProps {
  onClose: () => void;
  profile: Profile;
  storageError: string | null;
  onNameChange: (who: PersonKey, name: string) => void;
  onAvatarChange: (who: PersonKey, avatar: string | null) => void;
  onReset: () => void;
  media: ImportState;
  canImport: boolean;
  onImport: (kind: MediaKind) => void;
  dbStats: DbStats | null;
  dbReady: boolean;
  dbError: string | null;
  onOpenImport: () => void;
}

/** 设置抽屉：双方昵称/头像、回忆素材导入、使用说明。 */
export function SettingsDrawer({
  onClose,
  profile,
  storageError,
  onNameChange,
  onAvatarChange,
  onReset,
  media,
  canImport,
  onImport,
  dbStats,
  dbReady,
  dbError,
  onOpenImport,
}: SettingsDrawerProps): ReactElement {
  const herInputRef = useRef<HTMLInputElement | null>(null);
  const meInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleAvatarFile = async (who: PersonKey, event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await readAvatarFile(file);
      onAvatarChange(who, dataUrl);
      setAvatarError(null);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "图片读取失败");
    }
  };

  const renderPerson = (who: PersonKey, label: string, inputRef: typeof herInputRef): ReactElement => {
    const person = profile[who];
    const fallback = who === "her" ? "她" : "我";
    return (
      <div className="profile-field" key={who}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="visually-hidden"
          tabIndex={-1}
          onChange={(event) => void handleAvatarFile(who, event)}
        />
        <button
          type="button"
          className="avatar-edit"
          title="更换头像"
          aria-label={`更换${label}的头像`}
          onClick={() => inputRef.current?.click()}
        >
          <Avatar name={displayName(person, fallback)} src={person.avatar} size={56} />
          <span className="avatar-edit-mask">更换</span>
        </button>
        <div className="field-body">
          <label className="field-label" htmlFor={`profile-name-${who}`}>
            {label}
          </label>
          <input
            id={`profile-name-${who}`}
            type="text"
            className="text-input"
            value={person.name}
            maxLength={MAX_NAME_LENGTH}
            placeholder={who === "her" ? "她的昵称" : "我的昵称"}
            onChange={(event) => onNameChange(who, event.target.value)}
          />
          {person.avatar !== null && (
            <button type="button" className="link-btn" onClick={() => onAvatarChange(who, null)}>
              移除头像
            </button>
          )}
        </div>
      </div>
    );
  };

  const herName = displayName(profile.her, "她");
  const importDisabled = !canImport || media.busy;

  return (
    <div
      className="drawer-root"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="drawer" role="dialog" aria-modal="true" aria-label="设置">
        <header className="drawer-head">
          <h2>设置</h2>
          <button type="button" className="icon-btn" title="关闭" aria-label="关闭设置" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="settings-section" aria-labelledby="settings-profile">
            <header className="settings-section-head">
              <h3 id="settings-profile">资料</h3>
              <button type="button" className="link-btn" onClick={onReset}>
                恢复默认
              </button>
            </header>
            <p className="settings-hint">名字改完立即生效，聊天列表和消息头像会一起更新。点头像可换成自己的图片，小于 2MB。</p>
            {renderPerson("her", "她的昵称", herInputRef)}
            {renderPerson("me", "我的昵称", meInputRef)}
            {avatarError !== null && <p className="settings-warn">{avatarError}</p>}
            {storageError !== null && <p className="settings-warn">{storageError}</p>}
          </section>

          <section className="settings-section" aria-labelledby="settings-data">
            <header className="settings-section-head">
              <h3 id="settings-data">数据</h3>
            </header>
            <p className="settings-hint">
              导入你和{herName}的微信聊天记录（txt / csv / json），会自动生成体检报告并加密保存在本机。
            </p>
            {dbError !== null && <p className="settings-warn">{dbError}</p>}
            {dbReady && dbStats?.ok ? (
              <p className="settings-note">
                已导入 {dbStats.messageCount.toLocaleString("zh-CN")} 条消息（她的{" "}
                {dbStats.herCount.toLocaleString("zh-CN")} 条，holdout {dbStats.holdoutCount} 条），跨度{" "}
                {dbStats.spanDays} 天。
              </p>
            ) : (
              <p className="settings-note">{dbReady ? "还没有导入聊天记录。" : "正在初始化本地数据库…"}</p>
            )}
            <div className="media-actions">
              <button type="button" className="btn primary" disabled={!dbReady} onClick={onOpenImport}>
                导入聊天记录
              </button>
            </div>
            <p className="settings-hint">导入完成后，Step 3 才会开始人格蒸馏；本版本先完成数据管道与体检。</p>
          </section>

          <section className="settings-section" aria-labelledby="settings-media">
            <header className="settings-section-head">
              <h3 id="settings-media">回忆素材</h3>
            </header>
            <p className="settings-hint">
              导入的图片和语音会出现在和{herName}的聊天里，只在本次打开时保留。
            </p>
            <div className="media-actions">
              <button
                type="button"
                className="btn primary"
                disabled={importDisabled}
                onClick={() => onImport("image")}
              >
                导入图片
              </button>
              <button
                type="button"
                className="btn"
                disabled={importDisabled}
                onClick={() => onImport("voice")}
              >
                导入语音
              </button>
            </div>
            {!canImport && <p className="settings-warn">请用桌面应用导入</p>}
            {canImport && media.busy && <p className="settings-note">正在导入…</p>}
            {media.message !== null && (
              <p className={`settings-message ${media.ok === true ? "ok" : "bad"}`}>{media.message}</p>
            )}
          </section>

          <section className="settings-section" aria-labelledby="settings-usage">
            <header className="settings-section-head">
              <h3 id="settings-usage">使用说明</h3>
            </header>
            <ul className="usage-list">
              <li>这里的消息由 AI 模拟生成，不是真人。</li>
              <li>她不是真人。但你可以当真一会儿。</li>
              <li>昵称和头像只改变显示，改动保存在这台电脑上。</li>
              <li>回忆素材只在本机读取，不会上传。</li>
            </ul>
          </section>
        </div>
      </section>
    </div>
  );
}
