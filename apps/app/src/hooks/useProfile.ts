import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MAX_NAME_LENGTH,
  defaultProfile,
  loadProfile,
  saveProfile,
  type PersonKey,
  type Profile,
} from "../lib/profile.ts";
import { api, isTauri } from "../lib/tauri.ts";

export interface ProfileApi {
  profile: Profile;
  storageError: string | null;
  setName: (who: PersonKey, name: string) => void;
  setAvatar: (who: PersonKey, avatar: string | null) => void;
  reset: () => void;
}

function toPayload(profile: Profile): { her: { name: string; avatar: string | null }; me: { name: string; avatar: string | null } } {
  return {
    her: { name: profile.her.name.trim() || "她", avatar: profile.her.avatar },
    me: { name: profile.me.name.trim() || "我", avatar: profile.me.avatar },
  };
}

/**
 * 双方昵称 / 头像。
 * 浏览器：localStorage；桌面端：数据库 profile 表 + localStorage 双写（DB 优先）。
 * DB 写入在数据库初始化完成后才开始，避免启动竞态。
 */
export function useProfile(dbReady = false): ProfileApi {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [storageError, setStorageError] = useState<string | null>(null);
  const [dbLoaded, setDbLoaded] = useState<boolean>(!isTauri());

  // 数据库就绪后读取已保存的资料（若有）
  useEffect(() => {
    if (!isTauri() || !dbReady) return;
    let alive = true;
    void (async () => {
      try {
        const loaded = await api.profileLoad();
        if (!alive) return;
        if (loaded !== null) {
          setProfile((previous) => ({
            her: {
              name: loaded.her.name.trim() || previous.her.name,
              avatar: loaded.her.avatar ?? previous.her.avatar,
            },
            me: {
              name: loaded.me.name.trim() || previous.me.name,
              avatar: loaded.me.avatar ?? previous.me.avatar,
            },
          }));
        }
      } catch {
        /* 读取失败则沿用 localStorage */
      } finally {
        if (alive) setDbLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dbReady]);

  // 保存：localStorage 永远写；桌面端在 DB 就绪且已读取后写 DB
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const localOk = saveProfile(profile);
      if (!localOk) {
        setStorageError("资料没有保存到本机，可能是存储空间不足。");
        return;
      }
      if (isTauri() && dbReady && dbLoaded) {
        void api
          .profileSave(toPayload(profile))
          .then(() => setStorageError(null))
          .catch(() => setStorageError("资料已存到本地缓存，但数据库写入失败。"));
      } else {
        setStorageError(null);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [profile, dbReady, dbLoaded]);

  const setName = useCallback((who: PersonKey, name: string) => {
    const value = name.slice(0, MAX_NAME_LENGTH);
    setProfile((previous) => ({ ...previous, [who]: { ...previous[who], name: value } }));
  }, []);

  const setAvatar = useCallback((who: PersonKey, avatar: string | null) => {
    setProfile((previous) => ({ ...previous, [who]: { ...previous[who], avatar } }));
  }, []);

  const reset = useCallback(() => {
    setProfile(defaultProfile());
  }, []);

  return useMemo(
    () => ({ profile, storageError, setName, setAvatar, reset }),
    [profile, storageError, setName, setAvatar, reset],
  );
}
