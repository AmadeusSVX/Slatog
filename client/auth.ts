// D14: User identity — localStorage-based auth provider
// AuthProvider interface allows future migration to server-side auth (JWT, OAuth).

import { v4 as uuidv4 } from "uuid";

export interface UserIdentity {
  user_id: string; // UUID v4, persisted in localStorage
  display_name: string; // User-chosen name, default "Anonymous_" + user_id first 4 chars
}

export interface AuthProvider {
  getUserIdentity(): UserIdentity;
  isAuthenticated(): boolean;
  setDisplayName(name: string): void;
}

const STORAGE_KEY_USER_ID = "slatog_user_id";
const STORAGE_KEY_DISPLAY_NAME = "slatog_display_name";

export class LocalStorageAuthProvider implements AuthProvider {
  private identity: UserIdentity;

  constructor() {
    let userId = localStorage.getItem(STORAGE_KEY_USER_ID);
    if (!userId) {
      userId = uuidv4();
      localStorage.setItem(STORAGE_KEY_USER_ID, userId);
    }

    let displayName = localStorage.getItem(STORAGE_KEY_DISPLAY_NAME);
    if (!displayName || displayName.trim() === "") {
      displayName = `Anonymous_${userId.slice(0, 4)}`;
      localStorage.setItem(STORAGE_KEY_DISPLAY_NAME, displayName);
    }

    this.identity = { user_id: userId, display_name: displayName };
  }

  getUserIdentity(): UserIdentity {
    return { ...this.identity };
  }

  isAuthenticated(): boolean {
    return true; // Anonymous users are always "authenticated"
  }

  setDisplayName(name: string): void {
    const trimmed = name.trim();
    if (trimmed === "") return; // Reject empty names
    this.identity.display_name = trimmed;
    localStorage.setItem(STORAGE_KEY_DISPLAY_NAME, trimmed);
  }
}
