# Mobile architecture (frontend-main/mobile)

Expo SDK 57 + React Native 0.86 + TypeScript, Expo Go compatible. Same
dependency pins as apps/mobile - no navigation library, no state library: five
tabs and one sub-view do not justify either.

## Structure

    App.tsx                 tabs (Home · Month · Leave · Inbox · Profile),
                            session restore, queue flush on launch/foreground,
                            unread badge
    src/
      config.ts             API base from EXPO_PUBLIC_API_BASE (.env)
      api.ts                real API only - mock mode deleted, not disabled
      session.ts / auth.ts  tokens in SecureStore, silent refresh, install id
      queue.ts / sync.ts    offline punch queue - PRESERVED, do not regress
      format.ts             IST time formatting + status glyph map
      theme.ts              shared palette with the web app
      PunchScreen.tsx       home: one dominant action, camera, results, queue
      MonthScreen.tsx       month list + day detail + "request correction"
      CorrectionsScreen.tsx submit / list / withdraw
      LeaveScreen.tsx       balance, apply, cancel (pre-existing, real API)
      InboxScreen.tsx       notifications + mark read
      ProfileScreen.tsx     identity, set password, Survey, sign out
      LoginScreen.tsx       §6.2 redesign - HOLBOX shutter via RN Animated
      SurveyScreen.tsx      office-coordinate survey tool (preserved)

## Punch state machine

idle → camera → working → result. Photo and GPS captured in the same moment;
server order is device binding → presence → face. On network failure the punch
is enqueued (photo copied out of camera cache into the document directory)
and reported as **saved, not checked in** - queued and confirmed are different
words, different glyphs, different colours. Permanently refused queued punches
(too old) are dropped WITH their reason.

## Permissions

Camera and location each distinguish *not yet asked* (Allow button) from
*denied in Settings* (Open Settings via `Linking.openSettings()`), with copy
saying which capability cannot work and why.

## Environment

    cp .env.example .env    # EXPO_PUBLIC_API_BASE=http://<laptop-LAN-ip>:8000
    npm install
    npm start               # Expo Go

`localhost` on a phone means the phone; the fallback 127.0.0.1 works only in
the iOS simulator. Start the API with `./run.sh --lan`.

## Checks

    npx tsc --noEmit
    npx expo export --platform ios   # bundler validation
