import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MAX_NAME_LENGTH,
  defaultProfile,
  loadProfile,
  saveProfile,
  type PersonKey,
  type Profile,
} from "../lib/profile.ts";

export interface ProfileApi {
  profile: Profile;
  storageError: string | null;
  setName: (who: PersonKey, name: string) => void;
  setAvatar: (who: PersonKey, avatar: string | null) => void;
  reset: () => void;
}

/** 双方昵称 / 头像：改动即时生效，并写回 localStorage（防抖 200ms）。 */
export function useProfile(): ProfileApi {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const ok = saveProfile(profile);
      setStorageError(ok ? null : "资料没有保存到本机，可能是存储空间不足。");
    }, 200);
    return () => window.clearTimeout(timer);
  }, [profile]);

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
