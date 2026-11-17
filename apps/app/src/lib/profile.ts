// 常在 · 本地资料（双方昵称 / 头像）
// Step 2 会把这份资料写进数据库；当前先落 localStorage，键名固定为 changzai.profile.v1。

export interface PersonProfile {
  name: string;
  avatar: string | null;
}

export interface Profile {
  her: PersonProfile;
  me: PersonProfile;
}

export type PersonKey = keyof Profile;

export const PROFILE_STORAGE_KEY = "changzai.profile.v1";
export const MAX_NAME_LENGTH = 12;
/** 旧版本默认名，读取时迁移为中性称呼 */
const LEGACY_DEFAULT_NAME = "小林";

export const DEFAULT_PROFILE: Profile = {
  her: { name: "ta", avatar: null },
  me: { name: "我", avatar: null },
};

/** 旧默认「小林」→ ta；用户自己改的名字不动 */
export function migrateDefaultName(name: string): string {
  return name.trim() === LEGACY_DEFAULT_NAME ? "ta" : name;
}

/** 深拷贝一份默认资料，避免调用方误改常量。 */
export function defaultProfile(): Profile {
  return {
    her: { ...DEFAULT_PROFILE.her },
    me: { ...DEFAULT_PROFILE.me },
  };
}

/** 界面上显示的名字：空名字时退回「ta / 我」，避免出现空标题。 */
export function displayName(person: PersonProfile, fallback: string): string {
  const name = person.name.trim();
  return name.length > 0 ? name : fallback;
}

function readPerson(value: unknown, fallback: PersonProfile): PersonProfile {
  if (typeof value !== "object" || value === null) return { ...fallback };
  const record = value as Record<string, unknown>;
  const rawName = typeof record.name === "string" ? record.name.slice(0, MAX_NAME_LENGTH) : "";
  const name = rawName.trim().length > 0 ? migrateDefaultName(rawName) : fallback.name;
  const rawAvatar = record.avatar;
  const avatar = typeof rawAvatar === "string" && rawAvatar.startsWith("data:image/") ? rawAvatar : null;
  return { name, avatar };
}

export function loadProfile(): Profile {
  const fallback = defaultProfile();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const record = parsed as Record<string, unknown>;
    return {
      her: readPerson(record.her, fallback.her),
      me: readPerson(record.me, fallback.me),
    };
  } catch {
    return fallback;
  }
}

/** 写入失败（例如头像太大超出存储配额）时返回 false，由界面提示。 */
export function saveProfile(profile: Profile): boolean {
  if (typeof window === "undefined") return false;
  try {
    const payload: Profile = {
      her: {
        name: profile.her.name.trim() || DEFAULT_PROFILE.her.name,
        avatar: profile.her.avatar,
      },
      me: {
        name: profile.me.name.trim() || DEFAULT_PROFILE.me.name,
        avatar: profile.me.avatar,
      },
    };
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
