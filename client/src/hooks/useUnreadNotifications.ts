import { useEffect, useState } from "react";
import { apiClient, type ApiResponse } from "../api/client";

const EVENT = "cx-notifications-changed";

/** Call after marking notices read so the bell and sidebar badge update straight away. */
export function announceNotificationsChanged(unread: number) {
  window.dispatchEvent(new CustomEvent<number>(EVENT, { detail: unread }));
}

/**
 * Unread notice count for the school portal. Read once when a page opens, again every two
 * minutes while the tab is open, and whenever the Notifications page marks notices read.
 */
export function useUnreadNotifications(enabled: boolean) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await apiClient.get<ApiResponse<{ unreadCount: number }>>("/school/notifications?pageSize=1");
        if (!cancelled && res.data.success) setUnread(res.data.data.unreadCount);
      } catch {
        // A failed count simply leaves the badge as it was.
      }
    };

    const onChanged = (event: Event) => setUnread((event as CustomEvent<number>).detail);

    void load();
    const timer = window.setInterval(load, 2 * 60 * 1000);
    window.addEventListener(EVENT, onChanged);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(EVENT, onChanged);
    };
  }, [enabled]);

  return unread;
}
