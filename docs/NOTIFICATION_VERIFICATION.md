# Alarm behavior and delivery verification

When Important (alarm) is checked, tasks use their due date and due time; manual timetable blocks use their date and start time. The separate reminder field is optional and overrides that time when filled. A task without a due time must supply one or a custom reminder. Changing the effective time rearms the alarm. The client saves the resolved UTC instant for the server, preserving the editing device's time zone and DST rules.

The server independently checks synced reminders every 10 seconds. It sends Web Push without an open application tab. Successful provider submissions are tracked separately for each subscription; a failed device retries even if another succeeds. Local display no longer cancels delivery to other devices. Provider acceptance is not a device-delivery receipt. Existing five-minute lateness/retry limits remain; outages longer than this can miss reminders. Multiple API replicas are not supported by the current dispatcher.

Background subscription errors now appear to the user. Permission alone is insufficient: the browser subscription must also be registered with the authenticated backend, and the item must finish syncing before the app is closed. The frontend and backend must both be deployed for these changes to apply.

## Verified locally

- Backend integration tests cover automatic task and timetable scheduling without custom reminders, per-device retry, expired subscriptions, duplicate ticks, custom reminders, time edits, completed and dismissed records.
- Frontend unit tests cover automatic times, custom overrides, midnight, missing task time and disabled alarms. Service worker tests simulate push, Arabic copy and notification clicks; they do not contact a real push provider.
- Browser tests exercise the actual task and timetable editors, persisted UTC values, and rearming after a time edit in Africa/Cairo.

## Production/device acceptance still required

1. Deploy both components; run a single continuously running backend with persistent storage and all three VAPID settings. Keep the key pair stable across restarts.
2. Sign in on the target browser and enable notifications. Confirm the success message and completed data sync.
3. Create a task and a time block several minutes ahead with Important checked and the reminder field empty. Close all TaskFlow tabs; verify actual OS notifications arrive and open TaskFlow when clicked.
4. Repeat on each supported device, with the browser window closed, with the device locked, and after a backend restart. Record expected time, observed time, browser/OS and outcome separately.
5. Verify rescheduling, completion before delivery, blocked permissions, network interruption and a failed device while another succeeds.

Web Push can run while the app is closed, but browser/OS background restrictions, connectivity, notification settings and power management affect delivery. Arbitrary looping alarm audio is available only while the page runs; background notification sounds are controlled by the OS. No web application can guarantee delivery while the device is powered off.

Reference: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
